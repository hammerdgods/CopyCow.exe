/**
 * CREATOR FEE TRACKER — runs every 30 minutes.
 *
 * REAL mode: checks pump.fun's creator vault for COWBOT's wallet; if there's
 *   enough waiting, claims it into the agent wallet, records the exact SOL
 *   received, and splits it 10% holders / 90% treasury. (If the on-chain
 *   dividend contract is configured, the 10% is deposited there too.)
 *
 * PAPER mode: paper-launched tokens don't exist, so fees are ESTIMATED from
 *   the real trading volume of the trend they rode (DexScreener), times
 *   pump.fun's creator fee rate, times the share of that volume our token
 *   might plausibly have captured. Every estimate is labelled "simulated".
 */
import { type DB, getMeta, LAMPORTS_PER_SOL, nowIso, recordFeeReceipt, setMeta } from "@copycow/shared";
import { config } from "../config";
import { fetchJson } from "../http";
import { say } from "../log";
import { getSolUsd } from "../market/prices";
import { claimCreatorFees, unclaimedCreatorFeesSol } from "../token-launcher/pumpfun";
import { loadOrCreateWallet, walletBalanceSol } from "../wallet/wallet";
import { depositToDividendContract } from "../airdrop/onchain";

interface LaunchedRow {
  id: number;
  ticker: string;
  trend_term: string;
  mint: string | null;
  launched_at: string;
}

async function trendVolumeUsd24h(term: string): Promise<number> {
  const res = await fetchJson<{ pairs?: { chainId: string; baseToken: { symbol: string; name: string }; volume?: { h24?: number } }[] }>(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`,
  );
  const t = term.toLowerCase();
  const matches = (res.pairs ?? []).filter(
    (p) => p.chainId === "solana" && (p.baseToken.symbol.toLowerCase() === t || p.baseToken.name.toLowerCase().replace(/[^a-z0-9]/g, "") === t),
  );
  return Math.max(0, ...matches.map((p) => p.volume?.h24 ?? 0));
}

async function simulatePaperFees(db: DB): Promise<void> {
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
      volUsd = await trendVolumeUsd24h(t.trend_term);
    } catch {
      continue;
    }
    setMeta(db, key, nowIso());
    const feeSol = (volUsd / solUsd) * (Math.min(hours, 24) / 24) * (config.creatorFeeBpsEstimate / 10_000) * (config.paperFeeCapturePct / 100);
    const lamports = Math.floor(feeSol * LAMPORTS_PER_SOL);
    if (lamports <= 0) continue;
    const r = recordFeeReceipt(db, {
      sourceType: "creator_fee",
      sourceRef: `$${t.ticker}`,
      launchedTokenId: t.id,
      amountLamports: lamports,
      simulated: true,
      note: `simulated: trend vol $${Math.round(volUsd).toLocaleString()}/24h × ${config.creatorFeeBpsEstimate}bps × ${config.paperFeeCapturePct}% capture`,
    });
    say("fee", `Chewing cud: +${(lamports / LAMPORTS_PER_SOL).toFixed(5)} SOL simulated creator fees from $${t.ticker} (10% → holders: ${(r.holders / LAMPORTS_PER_SOL).toFixed(5)} SOL)`);
  }
}

/** Splits a pooled claim across our live tokens by their 24h volume (estimate). */
async function attribute(tokens: LaunchedRow[], lamports: number): Promise<{ token: LaunchedRow; lamports: number }[]> {
  if (tokens.length === 1) return [{ token: tokens[0], lamports }];
  let weights = tokens.map(() => 1);
  try {
    const mints = tokens.map((t) => t.mint).filter(Boolean).join(",");
    const pairs = await fetchJson<{ baseToken: { address: string }; volume?: { h24?: number } }[]>(`https://api.dexscreener.com/tokens/v1/solana/${mints}`);
    weights = tokens.map((t) => Math.max(0, ...pairs.filter((p) => p.baseToken.address === t.mint).map((p) => p.volume?.h24 ?? 0)));
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

async function claimRealFees(db: DB): Promise<void> {
  const tokens = db.prepare("SELECT id, ticker, trend_term, mint, launched_at FROM launched_tokens WHERE mode='real' AND status='launched' AND mint IS NOT NULL").all() as LaunchedRow[];
  if (tokens.length === 0) return;
  const agent = loadOrCreateWallet(db).keypair;
  const pending = await unclaimedCreatorFeesSol(agent.publicKey);
  setMeta(db, "unclaimed_creator_fees_sol", pending);
  if (pending < config.creatorFeeClaimMinSol) return;
  const { signature, receivedLamports } = await claimCreatorFees(agent);
  if (receivedLamports <= 0) return;
  let holdersTotal = 0;
  for (const { token, lamports } of await attribute(tokens, receivedLamports)) {
    if (lamports <= 0) continue;
    const r = recordFeeReceipt(db, { sourceType: "creator_fee", sourceRef: `$${token.ticker}`, launchedTokenId: token.id, amountLamports: lamports, simulated: false, txSignature: signature,
      note: tokens.length > 1 ? "pooled claim, attributed by 24h volume" : null });
    holdersTotal += r.holders;
  }
  say("fee", `Claimed ${(receivedLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL creator fees (tx ${signature}). 10% → holders: ${(holdersTotal / LAMPORTS_PER_SOL).toFixed(5)} SOL`);
  await depositToDividendContract(db, receivedLamports, signature);
}

export async function pollFees(db: DB): Promise<void> {
  try {
    if (config.launchMode === "real") await claimRealFees(db);
    await simulatePaperFees(db);
  } catch (e) {
    say("warn", `Fee check hiccup: ${(e as Error).message}`);
  }
  // Keep the dashboard's wallet balance fresh (real on-chain balance).
  try {
    setMeta(db, "wallet_balance_sol", await walletBalanceSol(loadOrCreateWallet(db).keypair.publicKey));
    setMeta(db, "wallet_balance_checked_at", nowIso());
  } catch {
    /* RPC unavailable — fine */
  }
}
