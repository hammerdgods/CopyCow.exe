/**
 * HOLDER AIRDROPS — holders never click "claim".
 *
 * Two kinds, one mechanism:
 *  • WEEKLY (AIRDROP_CRON, Monday 00:05 UTC) — ALL of COWBOT's profit since the
 *    last paid airdrop (momentum trading + selling its launch buys; a losing
 *    week pays nothing and must be made back first) + copytrade fees
 *    → $COPYCOW holders, by holdings.
 *  • DAILY (COIN_AIRDROP_CRON, 00:20 UTC) — each launched coin's creator
 *    rewards → that coin's holders, by holdings.
 *
 * For each airdrop: snapshot the coin's holders at a fixed slot (the
 * checkpoint), split pro-rata, build a Merkle tree, commit it to the proof
 * ledger. PAPER: record what WOULD be paid. REAL: deposit the SOL into the
 * contract, publish the root, push SOL to every wallet in batches.
 * COWBOT's own wallet, the team wallet and pool/vault accounts never receive.
 * Nothing to pay (no profit, no holders…) → nothing is written; it carries over.
 */
import {
  airdropLeaf, airdropPreview, buildMerkleTree, commitProof, type DB, LAMPORTS_PER_SOL, nowIso, pendingCoinRewards,
} from "@copycow/shared";
import { config } from "../config";
import { say } from "../log";
import { loadOrCreateWallet } from "../wallet/wallet";
import { isPersonalWallet, snapshotHolders } from "./holders";
import { type AirdropKind, depositForHolders, nextOnchainEpoch, publishAndPushEpoch } from "./onchain";

export interface PlannedPayout {
  index: number;
  wallet: string;
  tokens: number;
  amountLamports: bigint;
}

/**
 * Pure pro-rata math (easy to test). Holders whose share would be below the
 * minimum payout are dropped BEFORE splitting, so their share goes to everyone
 * else instead of being lost.
 */
export function planPayouts(
  holders: { wallet: string; tokens: number }[],
  poolLamports: bigint,
  opts: { minTokens: number; minPayoutLamports: bigint; exclude: Set<string> },
): PlannedPayout[] {
  let eligible = holders
    .filter((h) => h.tokens >= opts.minTokens && !opts.exclude.has(h.wallet))
    .sort((a, b) => b.tokens - a.tokens || a.wallet.localeCompare(b.wallet));
  if (poolLamports <= 0n) return [];
  for (;;) {
    // Integer micro-token units keep the math exact and deterministic.
    const units = eligible.map((h) => BigInt(Math.floor(h.tokens * 1e6)));
    const totalUnits = units.reduce((a, b) => a + b, 0n);
    if (totalUnits <= 0n) return [];
    const amounts = units.map((u) => (poolLamports * u) / totalUnits);
    const keep = eligible.filter((_, i) => amounts[i] >= opts.minPayoutLamports);
    if (keep.length === eligible.length) {
      return eligible.map((h, index) => ({ index, wallet: h.wallet, tokens: h.tokens, amountLamports: amounts[index] }));
    }
    eligible = keep; // drop the dust holders and re-split
  }
}

export interface AirdropResult {
  ran: boolean;
  reason: string;
}

const sol = (l: number | bigint) => (Number(l) / LAMPORTS_PER_SOL).toFixed(5);

interface HolderAirdrop {
  mode: "paper" | "real";
  kind: AirdropKind;
  /** Whose holders get paid. */
  tokenMint: string;
  label: string;
  poolLamports: number;
  minTokens: number;
  periodStart: string | null;
  launchedTokenId?: number;
  tradingPnlLamports?: number;
  copytradeFeesLamports?: number;
  /** Marks the money as used by this airdrop (called inside the DB transaction). */
  assign: (epochId: number) => void;
}

async function runHolderAirdrop(db: DB, a: HolderAirdrop): Promise<AirdropResult> {
  const simulated = a.mode === "paper";
  const skip = (why: string): AirdropResult => {
    say("info", `${a.label} airdrop skipped: ${why}. It carries over to the next run.`);
    return { ran: false, reason: why };
  };
  let snap;
  try {
    snap = await snapshotHolders(a.tokenMint);
  } catch (e) {
    return skip(`holder snapshot failed (${(e as Error).message.slice(0, 120)}) — a Helius key usually fixes this`);
  }
  const never = [loadOrCreateWallet(db).keypair.publicKey.toBase58(), config.teamWallet].filter(Boolean) as string[];
  const exclude = new Set([...config.airdropExcludeWallets, ...never, ...snap.holders.filter((h) => !isPersonalWallet(h.wallet)).map((h) => h.wallet)]);
  const payouts = planPayouts(snap.holders, BigInt(a.poolLamports), {
    minTokens: a.minTokens,
    minPayoutLamports: BigInt(Math.round(config.airdropMinPayoutSol * LAMPORTS_PER_SOL)),
    exclude,
  }).slice(0, 64_000);
  if (payouts.length === 0) return skip("no eligible holders would receive the minimum payout");

  const last = db.prepare("SELECT MAX(epoch_index) AS e FROM airdrop_epochs").get() as { e: number | null };
  const epochIndex = (last.e ?? 0) + 1;
  // On-chain, Merkle leaves must carry the contract's own epoch counter.
  let merkleEpoch = epochIndex;
  if (!simulated) {
    try {
      merkleEpoch = (await nextOnchainEpoch(db)) ?? epochIndex;
    } catch (e) {
      say("warn", `Couldn't read the money contract (${(e as Error).message.slice(0, 100)}); will re-check before publishing.`);
    }
  }
  const tree = buildMerkleTree(payouts.map((p) => airdropLeaf(BigInt(merkleEpoch), { index: p.index, wallet: p.wallet, amountLamports: p.amountLamports })));
  const total = payouts.reduce((s, p) => s + p.amountLamports, 0n);
  const root = tree.root.toString("hex");
  const proof = commitProof(db, "airdrop_epoch", {
    mode: a.mode, kind: a.kind, token_mint: a.tokenMint, epoch_index: epochIndex, merkle_epoch: merkleEpoch, merkle_root: root,
    total_lamports: total.toString(), wallets: payouts.length, snapshot_slot: snap.slot,
  });
  const epochId = Number(
    db.prepare(
      `INSERT INTO airdrop_epochs (epoch_index, kind, token_mint, launched_token_id, merkle_epoch, period_start, period_end, mode, status,
         pool_lamports, trading_pnl_lamports, copytrade_fees_lamports, total_lamports, wallets_paid, merkle_root, snapshot_slot, proof_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(epochIndex, a.kind, a.tokenMint, a.launchedTokenId ?? null, merkleEpoch, a.periodStart, nowIso(), a.mode, simulated ? "paper" : "pending",
      a.poolLamports, a.tradingPnlLamports ?? 0, a.copytradeFeesLamports ?? 0, Number(total), payouts.length, root, snap.slot, proof.id,
      simulated ? "PAPER: simulated, nothing sent on-chain" : null, nowIso()).lastInsertRowid,
  );
  const insertPayout = db.prepare(
    "INSERT INTO airdrop_payouts (epoch_id, leaf_index, wallet, token_balance, amount_lamports, proof, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    payouts.forEach((p, i) =>
      insertPayout.run(epochId, p.index, p.wallet, p.tokens, Number(p.amountLamports), JSON.stringify(tree.proofs[i].map((b) => b.toString("hex"))), simulated ? "paper" : "pending"));
    a.assign(epochId);
  })();

  if (simulated) {
    say("fee", `PAPER ${a.label} airdrop #${epochIndex}: ${sol(total)} SOL to ${payouts.length} holders (snapshot slot ${snap.slot}).`);
    return { ran: true, reason: "paper airdrop recorded" };
  }
  say("fee", `${a.label} airdrop #${epochIndex}: depositing ${sol(total)} SOL and pushing it to ${payouts.length} holders…`);
  try {
    const sig = await depositForHolders(db, Number(total), a.kind, a.tokenMint);
    db.prepare("UPDATE airdrop_epochs SET tx_signatures=? WHERE id=?").run(JSON.stringify([sig]), epochId);
  } catch (e) {
    db.prepare("UPDATE airdrop_epochs SET status='deposit_pending', notes=? WHERE id=?").run(`deposit failed: ${(e as Error).message.slice(0, 200)}`, epochId);
    say("error", `Deposit for the ${a.label} airdrop failed (${(e as Error).message.slice(0, 120)}). It's retried every 30 min (or run \`npm run airdrop -- --resume\`).`);
    return { ran: false, reason: "deposit failed" };
  }
  await publishAndPushEpoch(db, epochId);
  return { ran: true, reason: "real airdrop sent" };
}

/** WEEKLY: COWBOT's profit (trading + launch sales) + copytrade fees → $COPYCOW holders. */
export async function runProfitAirdrop(db: DB, mode: "paper" | "real"): Promise<AirdropResult> {
  const p = airdropPreview(db, mode);
  const label = `${mode === "paper" ? "" : "REAL "}$COPYCOW profit`;
  if (p.poolLamports <= 0) {
    const pnl = p.tradingPnlLamports + p.launchPnlLamports;
    const why = pnl < 0 ? `COWBOT is down ${sol(-pnl)} SOL since the last airdrop — losses get made back before anything is paid` : "no profit yet this period";
    say("info", `${label} airdrop skipped: ${why}.`);
    return { ran: false, reason: why };
  }
  if (!config.copycowMint) {
    say("info", `${label} airdrop skipped: no $COPYCOW mint set yet (COPYCOW_MINT in .env). ${sol(p.poolLamports)} SOL carries over.`);
    return { ran: false, reason: "no $COPYCOW mint" };
  }
  return runHolderAirdrop(db, {
    mode, kind: "cowbot_profit", tokenMint: config.copycowMint, label, poolLamports: p.poolLamports, minTokens: config.airdropMinTokens,
    periodStart: p.periodStart, tradingPnlLamports: p.tradingPnlLamports + p.launchPnlLamports, copytradeFeesLamports: p.copytradeFeesLamports,
    assign: (epochId) =>
      db.prepare("UPDATE fee_receipts SET airdrop_epoch_id = ? WHERE airdrop_epoch_id IS NULL AND source_type='copytrade_fee' AND simulated = ?")
        .run(epochId, mode === "paper" ? 1 : 0),
  });
}

/** The weekly job: paper profit always (the public paper record); real profit when LAUNCH_MODE=real. */
export async function runWeeklyAirdrops(db: DB): Promise<void> {
  await runProfitAirdrop(db, "paper");
  if (config.launchMode === "real") await runProfitAirdrop(db, "real");
}

/** DAILY: each launched coin's creator rewards → that coin's holders. */
export async function runCoinAirdrops(db: DB): Promise<void> {
  const paper = pendingCoinRewards(db, true);
  if (paper.length) {
    const total = paper.reduce((s, r) => s + r.lamports, 0);
    say("info", `Paper-launched coins don't exist, so their ${sol(total)} SOL of simulated rewards can't be airdropped (shown on the dashboard as "for coin holders").`);
  }
  for (const c of pendingCoinRewards(db, false)) {
    if (!c.mint) continue;
    await runHolderAirdrop(db, {
      mode: "real", kind: "coin_rewards", tokenMint: c.mint, label: `$${c.ticker} holders`, poolLamports: c.lamports,
      minTokens: config.coinAirdropMinTokens, periodStart: null, launchedTokenId: c.launched_token_id,
      assign: (epochId) =>
        db.prepare("UPDATE fee_receipts SET airdrop_epoch_id = ? WHERE airdrop_epoch_id IS NULL AND source_type='launch_reward' AND simulated = 0 AND launched_token_id = ?")
          .run(epochId, c.launched_token_id),
    });
  }
}
