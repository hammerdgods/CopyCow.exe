/**
 * CREATOR REWARD TRACKER — runs every 30 minutes.
 *
 * pump.fun pays creator rewards for $COPYCOW and every coin COWBOT launches
 * (all created from COWBOT's wallet, so they land in one reward vault).
 *   • $COPYCOW's share:        10% → COWBOT (trading capital) · 90% → TEAM_WALLET
 *   • each launched coin's share: 100% → that coin's holders (daily airdrop)
 * One claim covers every coin, so the total is split per coin by each coin's
 * (believable) 24h trading volume — creator rewards are a % of volume.
 *
 * REAL mode: check both reward vaults (pump.fun + PumpSwap). If enough is
 *   waiting, claim it, record the exact SOL received, and IMMEDIATELY send the
 *   team's 90% of the $COPYCOW share to TEAM_WALLET. Failed transfers are
 *   retried every run; money owed to the team or to holders is never counted
 *   as COWBOT's. $COPYCOW launched but no TEAM_WALLET set → no claims at all.
 *
 * PAPER mode: paper-launched tokens don't exist, so rewards are ESTIMATED from
 *   the trend they rode — using a sanity-capped volume (wash-traded volume is
 *   ignored) × pump.fun's creator fee rate × a small capture share. Labelled
 *   "simulated" everywhere.
 */
import {
  type DB, getMeta, LAMPORTS_PER_SOL, markTeamShareSent, nowIso, recordCopycowReward, recordLaunchReward, setMeta,
} from "@copycow/shared";
import { config } from "../config";
import { fetchJson } from "../http";
import { say } from "../log";
import { getSolUsd } from "../market/prices";
import { claimCreatorFees, unclaimedCreatorFeesSol } from "../token-launcher/pumpfun";
import { loadOrCreateWallet, walletBalanceSol } from "../wallet/wallet";
import { routeTeamShare } from "../airdrop/onchain";

interface LaunchedRow {
  id: number | null;
  ticker: string;
  trend_term: string;
  mint: string | null;
  launched_at: string;
}

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string; name: string };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
}

/**
 * Believable 24h volume for a trend: the busiest matching Solana pair, but
 * capped at 1× its market cap and 3× its liquidity — fake wash volume
 * (e.g. $50M/day on a $1.7M token) would otherwise wildly inflate estimates.
 */
export function believableVolumeUsd(pairs: DexPair[], term: string): number {
  const t = term.toLowerCase();
  const matches = pairs.filter(
    (p) => p.chainId === "solana" && (p.baseToken.symbol.toLowerCase() === t || p.baseToken.name.toLowerCase().replace(/[^a-z0-9]/g, "") === t),
  );
  return Math.max(
    0,
    ...matches.map((p) => Math.min(p.volume?.h24 ?? 0, p.marketCap ?? p.fdv ?? 0, 3 * (p.liquidity?.usd ?? 0))),
  );
}

async function simulatePaperRewards(db: DB): Promise<void> {
  const since = new Date(Date.now() - config.paperFeeSimDays * 86_400_000).toISOString();
  const tokens = db.prepare("SELECT id, ticker, trend_term, mint, launched_at FROM launched_tokens WHERE mode='paper' AND status='paper_launched' AND launched_at >= ?").all(since) as LaunchedRow[];
  if (tokens.length === 0) return;
  const solUsd = await getSolUsd();
  for (const t of tokens) {
    const key = `paper_fee_last_${t.id}`;
    const last = getMeta(db, key) ?? t.launched_at;
    const hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
    if (hours < 0.25) continue;
    let volUsd = 0;
    try {
      const res = await fetchJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(t.trend_term)}`);
      volUsd = believableVolumeUsd(res.pairs ?? [], t.trend_term);
    } catch {
      continue;
    }
    setMeta(db, key, nowIso());
    const rewardSol = (volUsd / solUsd) * (Math.min(hours, 24) / 24) * (config.creatorFeeBpsEstimate / 10_000) * (config.paperFeeCapturePct / 100);
    const lamports = Math.floor(rewardSol * LAMPORTS_PER_SOL);
    if (lamports <= 0) continue;
    recordLaunchReward(db, {
      sourceRef: `$${t.ticker}`,
      launchedTokenId: t.id!,
      amountLamports: lamports,
      simulated: true,
      note: `simulated: capped trend vol $${Math.round(volUsd).toLocaleString()}/24h × ${config.creatorFeeBpsEstimate}bps × ${config.paperFeeCapturePct}% capture`,
    });
    say("fee", `Chewing cud: +${(lamports / LAMPORTS_PER_SOL).toFixed(5)} SOL simulated creator rewards from $${t.ticker} → all for $${t.ticker} holders`);
  }
}

/** Splits a pooled claim across our tokens by their (believable) 24h volume. */
async function attribute(tokens: LaunchedRow[], lamports: number): Promise<{ token: LaunchedRow; lamports: number }[]> {
  if (tokens.length === 1) return [{ token: tokens[0], lamports }];
  let weights = tokens.map(() => 1);
  try {
    const mints = tokens.map((t) => t.mint).filter(Boolean).join(",");
    const pairs = await fetchJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${mints}`);
    weights = tokens.map((t) => Math.max(0, ...pairs.filter((p) => p.baseToken.address === t.mint).map((p) => Math.min(p.volume?.h24 ?? 0, p.marketCap ?? p.fdv ?? 0))));
    if (weights.every((w) => w === 0)) weights = tokens.map(() => 1);
  } catch {
    /* even split */
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let given = 0;
  return tokens.map((token, i) => {
    const share = i === tokens.length - 1 ? lamports - given : Math.floor((lamports * weights[i]) / total);
    given += share;
    return { token, lamports: share };
  });
}

/** Sends any team share still sitting in COWBOT's wallet. Safe to call every run. */
export async function sendPendingTeamShares(db: DB): Promise<void> {
  const rows = db.prepare("SELECT id, amount_lamports, team_lamports FROM fee_receipts WHERE team_status='pending' ORDER BY id").all() as {
    id: number; amount_lamports: number; team_lamports: number;
  }[];
  if (rows.length === 0) return;
  if (!config.teamWallet) {
    say("warn", "TODO: set TEAM_WALLET in .env — the team's 90% is waiting in COWBOT's wallet (it will NOT be spent).");
    return;
  }
  const gross = rows.reduce((s, r) => s + r.amount_lamports, 0);
  const team = rows.reduce((s, r) => s + r.team_lamports, 0);
  try {
    const sig = await routeTeamShare(db, gross, team);
    markTeamShareSent(db, rows.map((r) => r.id), sig);
    say("fee", `Sent the team's 90% (${(team / LAMPORTS_PER_SOL).toFixed(5)} SOL) to the team wallet · tx ${sig}`);
  } catch (e) {
    say("error", `Couldn't send the team's share yet (${(e as Error).message.slice(0, 140)}). Will retry in 30 min; it stays untouched.`);
  }
}

async function claimRealRewards(db: DB): Promise<void> {
  if (config.copycowMint && !config.teamWallet) {
    say("warn", "TODO: set TEAM_WALLET in .env. COWBOT won't claim creator rewards until it knows where the team's 90% of $COPYCOW rewards goes.");
    return;
  }
  const tokens = db.prepare("SELECT id, ticker, trend_term, mint, launched_at FROM launched_tokens WHERE mode='real' AND status='launched' AND mint IS NOT NULL").all() as LaunchedRow[];
  // $COPYCOW itself (launched from COWBOT's wallet) shares the same reward vault.
  if (config.copycowMint) tokens.push({ id: null, ticker: "COPYCOW", trend_term: "copycow", mint: config.copycowMint, launched_at: "" });
  if (tokens.length === 0) return;
  const agent = loadOrCreateWallet(db).keypair;
  const pending = await unclaimedCreatorFeesSol(agent.publicKey);
  setMeta(db, "unclaimed_creator_fees_sol", pending.total);
  if (pending.total < config.creatorFeeClaimMinSol) return;
  const { signature, receivedLamports } = await claimCreatorFees(agent);
  if (receivedLamports <= 0) return;
  const note = tokens.length > 1 ? "pooled claim, split by 24h volume" : null;
  const parts: string[] = [];
  for (const { token, lamports } of await attribute(tokens, receivedLamports)) {
    if (lamports <= 0) continue;
    if (token.id === null) {
      const r = recordCopycowReward(db, { sourceRef: "$COPYCOW", amountLamports: lamports, simulated: false, txSignature: signature, note });
      parts.push(`$COPYCOW ${(lamports / LAMPORTS_PER_SOL).toFixed(5)} (COWBOT ${(r.agent / LAMPORTS_PER_SOL).toFixed(5)} / team ${(r.team / LAMPORTS_PER_SOL).toFixed(5)})`);
    } else {
      recordLaunchReward(db, { sourceRef: `$${token.ticker}`, launchedTokenId: token.id, amountLamports: lamports, simulated: false, txSignature: signature, note });
      parts.push(`$${token.ticker} ${(lamports / LAMPORTS_PER_SOL).toFixed(5)} (→ $${token.ticker} holders)`);
    }
  }
  say("fee", `Claimed ${(receivedLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL creator rewards (tx ${signature}): ${parts.join(" · ")}`);
}

export async function pollFees(db: DB): Promise<void> {
  try {
    if (config.launchMode === "real") {
      await sendPendingTeamShares(db); // retry anything that failed earlier
      await claimRealRewards(db);
      await sendPendingTeamShares(db); // send the new 90% straight away
    }
    await simulatePaperRewards(db);
  } catch (e) {
    say("warn", `Reward check hiccup: ${(e as Error).message}`);
  }
  // Keep the dashboard's wallet balance fresh (real on-chain balance).
  try {
    setMeta(db, "wallet_balance_sol", await walletBalanceSol(loadOrCreateWallet(db).keypair.publicKey));
    setMeta(db, "wallet_balance_checked_at", nowIso());
  } catch {
    /* RPC unavailable — fine */
  }
}
