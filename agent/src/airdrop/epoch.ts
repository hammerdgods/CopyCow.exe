/**
 * WEEKLY AIRDROP — holders never click "claim".
 *
 * Every week (AIRDROP_CRON, default Monday 00:05 UTC):
 *  1. take everything in the holder dividend pool (the 10% share of fees)
 *  2. snapshot every $COPYCOW holder at a fixed slot (the checkpoint)
 *  3. split the pool pro-rata to eligible holders (≥ AIRDROP_MIN_TOKENS)
 *  4. build a Merkle tree of (wallet, amount) and commit it to the proof ledger
 *  5. PAPER: record what WOULD be paid.
 *     REAL:  publish the root to the dividend contract and push SOL to every
 *            wallet in batches — COWBOT's relayer pays the network fees.
 * Amounts too small to be worth sending roll over to next week.
 */
import {
  airdropLeaf, buildMerkleTree, commitProof, type DB, LAMPORTS_PER_SOL, nowIso, pendingDividendLamports,
} from "@copycow/shared";
import { config } from "../config";
import { say } from "../log";
import { isPersonalWallet, snapshotHolders } from "./holders";
import { nextOnchainEpoch, publishAndPushEpoch } from "./onchain";

export interface PlannedPayout {
  index: number;
  wallet: string;
  tokens: number;
  amountLamports: bigint;
}

/** Pure pro-rata math (easy to test). */
export function planPayouts(
  holders: { wallet: string; tokens: number }[],
  poolLamports: bigint,
  opts: { minTokens: number; minPayoutLamports: bigint; exclude: Set<string> },
): PlannedPayout[] {
  const eligible = holders
    .filter((h) => h.tokens >= opts.minTokens && !opts.exclude.has(h.wallet))
    .sort((a, b) => b.tokens - a.tokens || a.wallet.localeCompare(b.wallet));
  const totalTokens = eligible.reduce((s, h) => s + h.tokens, 0);
  if (totalTokens <= 0 || poolLamports <= 0n) return [];
  // Work in integer micro-token units so the math is exact and deterministic.
  const units = eligible.map((h) => BigInt(Math.floor(h.tokens * 1e6)));
  const totalUnits = units.reduce((a, b) => a + b, 0n);
  return eligible
    .map((h, i) => ({ wallet: h.wallet, tokens: h.tokens, amountLamports: (poolLamports * units[i]) / totalUnits }))
    .filter((p) => p.amountLamports >= opts.minPayoutLamports)
    .map((p, index) => ({ ...p, index }));
}

export async function runAirdropEpoch(db: DB): Promise<void> {
  const mode = config.launchMode;
  const simulated = mode === "paper";
  const pool = pendingDividendLamports(db, simulated);
  const last = db.prepare("SELECT MAX(epoch_index) AS e, MAX(period_end) AS p FROM airdrop_epochs").get() as { e: number | null; p: string | null };
  const epochIndex = (last.e ?? 0) + 1;
  const periodEnd = nowIso();
  const insertEpoch = db.prepare(
    `INSERT INTO airdrop_epochs (epoch_index, merkle_epoch, period_start, period_end, mode, status, pool_lamports, total_lamports, wallets_paid,
       merkle_root, snapshot_slot, proof_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rollOver = (why: string) => {
    insertEpoch.run(epochIndex, null, last.p, periodEnd, mode, "rolled_over", pool, 0, 0, null, null, null, why, nowIso());
    say("info", `Airdrop epoch #${epochIndex}: ${why}. ${(pool / LAMPORTS_PER_SOL).toFixed(5)} SOL rolls over to next week.`);
  };

  if (pool <= 0) return rollOver("dividend pool is empty");
  if (!config.copycowMint) return rollOver("no $COPYCOW mint set yet (COPYCOW_MINT in .env)");

  let snap;
  try {
    snap = await snapshotHolders(config.copycowMint);
  } catch (e) {
    return rollOver(`holder snapshot failed (${(e as Error).message.slice(0, 120)}) — a Helius key usually fixes this`);
  }
  const exclude = new Set([...config.airdropExcludeWallets, ...snap.holders.filter((h) => !isPersonalWallet(h.wallet)).map((h) => h.wallet)]);
  const payouts = planPayouts(snap.holders, BigInt(pool), {
    minTokens: config.airdropMinTokens,
    minPayoutLamports: BigInt(Math.round(config.airdropMinPayoutSol * LAMPORTS_PER_SOL)),
    exclude,
  });
  if (payouts.length === 0) return rollOver("no eligible holders above the minimum payout");

  // On-chain, leaves must carry the contract's own epoch counter.
  let merkleEpoch = epochIndex;
  if (!simulated) {
    try {
      merkleEpoch = (await nextOnchainEpoch(db)) ?? epochIndex;
    } catch (e) {
      say("warn", `Couldn't read the dividend contract (${(e as Error).message.slice(0, 100)}); will re-check before publishing.`);
    }
  }
  const leaves = payouts.map((p) => airdropLeaf(BigInt(merkleEpoch), { index: p.index, wallet: p.wallet, amountLamports: p.amountLamports }));
  const tree = buildMerkleTree(leaves);
  const total = payouts.reduce((s, p) => s + p.amountLamports, 0n);
  const root = tree.root.toString("hex");
  const proof = commitProof(db, "airdrop_epoch", {
    mode, epoch_index: epochIndex, merkle_epoch: merkleEpoch, merkle_root: root, total_lamports: total.toString(), wallets: payouts.length, snapshot_slot: snap.slot,
  });

  const epochId = Number(
    insertEpoch.run(epochIndex, merkleEpoch, last.p, periodEnd, mode, simulated ? "paper" : "pending", pool, Number(total), payouts.length, root, snap.slot, proof.id,
      simulated ? "PAPER: nothing was sent on-chain" : null, nowIso()).lastInsertRowid,
  );
  const insertPayout = db.prepare(
    "INSERT INTO airdrop_payouts (epoch_id, leaf_index, wallet, token_balance, amount_lamports, proof, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    payouts.forEach((p, i) =>
      insertPayout.run(epochId, p.index, p.wallet, p.tokens, Number(p.amountLamports), JSON.stringify(tree.proofs[i].map((b) => b.toString("hex"))), simulated ? "paper" : "pending"));
    // These fees are now accounted for by this epoch; anything not paid (dust) is tracked as rollover next time.
    db.prepare(`UPDATE fee_receipts SET airdrop_epoch_id = ? WHERE airdrop_epoch_id IS NULL AND simulated = ?`).run(epochId, simulated ? 1 : 0);
  })();
  const dust = BigInt(pool) - total;
  if (dust > 0n) {
    // carry the rounding dust forward as a tiny receipt so it's not lost
    db.prepare(`INSERT INTO fee_receipts (source_type, source_ref, amount_lamports, holder_lamports, treasury_lamports, simulated, note, received_at)
      VALUES ('creator_fee', 'rollover', 0, ?, 0, ?, ?, ?)`).run(Number(dust), simulated ? 1 : 0, `dust rolled over from epoch #${epochIndex}`, nowIso());
  }

  const sol = (Number(total) / LAMPORTS_PER_SOL).toFixed(5);
  if (simulated) {
    say("fee", `PAPER airdrop epoch #${epochIndex}: ${sol} SOL to ${payouts.length} holders (snapshot slot ${snap.slot}). Root ${root.slice(0, 16)}…`);
    return;
  }
  say("fee", `Airdrop epoch #${epochIndex}: pushing ${sol} SOL to ${payouts.length} holders…`);
  await publishAndPushEpoch(db, epochId);
}
