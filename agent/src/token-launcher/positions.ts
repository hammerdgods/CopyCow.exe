/**
 * LAUNCH POSITIONS — COWBOT's first buy of every coin it launches.
 * Checked every trading cycle. Sold when worth ≥ LAUNCH_TAKE_PROFIT_X (2x) of
 * what it cost, or after LAUNCH_MAX_HOLD_HOURS (24h), whichever comes first.
 * The profit (or loss) counts toward the weekly $COPYCOW holder airdrop, exactly
 * like trading profit.
 *
 * PAPER: the coin doesn't exist, so its price is simulated by following the
 * REAL trending token it was modelled on (same trend, DexScreener). If there
 * is none, the position simply closes flat after 24h.
 * REAL:  sells the whole holding on pump.fun / PumpSwap via PumpPortal.
 */
import { commitProof, type DB, LAMPORTS_PER_SOL, nowIso, SOL_MINT } from "@copycow/shared";
import { PublicKey } from "@solana/web3.js";
import { config } from "../config";
import { fetchJson } from "../http";
import { fmtPct, fmtSol, say } from "../log";
import { getPrices, getSolUsd } from "../market/prices";
import { loadOrCreateWallet } from "../wallet/wallet";
import { sellAllOnPumpFun } from "./pumpfun";

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

/** The real token a paper launch is modelled on (most liquid exact match on Solana). */
export async function findReferenceToken(term: string): Promise<{ mint: string; priceUsd: number } | null> {
  try {
    const res = await fetchJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(term)}`);
    const t = term.toLowerCase();
    const best = (res.pairs ?? [])
      .filter((p) => p.chainId === "solana" && Number(p.priceUsd) > 0 &&
        (p.baseToken.symbol.toLowerCase() === t || p.baseToken.name.toLowerCase().replace(/[^a-z0-9]/g, "") === t))
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return best ? { mint: best.baseToken.address, priceUsd: Number(best.priceUsd) } : null;
  } catch {
    return null;
  }
}

export async function openLaunchPosition(
  db: DB,
  args: { launchedTokenId: number; ticker: string; term: string; mode: "paper" | "real"; proofId: number; mint?: string; costSol: number; tokens?: number },
): Promise<void> {
  let solUsd = 0;
  try {
    solUsd = await getSolUsd();
  } catch {
    /* sizing in USD is informational only */
  }
  let mint: string;
  let entryPrice: number;
  let reason: string;
  if (args.mode === "real") {
    mint = args.mint!;
    entryPrice = args.tokens && solUsd ? (args.costSol * solUsd) / args.tokens : 0;
    reason = `launch buy of $${args.ticker}: ${args.tokens?.toLocaleString() ?? "?"} tokens`;
  } else {
    const ref = await findReferenceToken(args.term);
    mint = ref?.mint ?? `paper:${args.ticker}`;
    entryPrice = ref?.priceUsd ?? 1;
    reason = ref ? `paper launch buy of $${args.ticker}, price follows real "${args.term}" token` : `paper launch buy of $${args.ticker}, no reference market (closes flat)`;
  }
  db.prepare(
    `INSERT INTO trades (mint, symbol, kind, launched_token_id, size_tokens, status, mode, size_sol, size_usd, entry_price, entry_ts, entry_reason,
       entry_fill_source, last_price, last_price_ts, entry_proof_id)
     VALUES (?, ?, 'launch', ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(mint, args.ticker, args.launchedTokenId, args.tokens ?? null, args.mode, args.costSol, args.costSol * solUsd, entryPrice, nowIso(), reason,
    args.mode === "real" ? "pump.fun dev buy" : "paper", entryPrice, nowIso(), args.proofId);
}

interface LaunchTrade {
  id: number;
  mint: string;
  symbol: string;
  mode: "paper" | "real";
  size_sol: number;
  size_tokens: number | null;
  entry_price: number;
  entry_ts: string;
}

export async function manageLaunchPositions(db: DB): Promise<void> {
  const open = db.prepare("SELECT * FROM trades WHERE kind='launch' AND status='open'").all() as LaunchTrade[];
  if (open.length === 0) return;
  const priced = open.filter((t) => !t.mint.startsWith("paper:"));
  const prices = priced.length ? await getPrices([...priced.map((t) => t.mint), SOL_MINT]).catch(() => new Map()) : new Map();
  const solUsd = prices.get(SOL_MINT)?.priceUsd ?? 0;

  for (const t of open) {
    const price = prices.get(t.mint)?.priceUsd as number | undefined;
    const ratio = price && t.entry_price > 0 ? price / t.entry_price : null;
    const ageH = (Date.now() - new Date(t.entry_ts).getTime()) / 3_600_000;
    if (price) db.prepare("UPDATE trades SET last_price=?, last_price_ts=? WHERE id=?").run(price, nowIso(), t.id);
    const hitTarget = ratio !== null && ratio >= config.launchTakeProfitX;
    const timeUp = ageH >= config.launchMaxHoldHours;
    if (!hitTarget && !timeUp) continue;
    const reason = hitTarget ? "launch_take_profit" : "launch_time_exit";
    const proof = commitProof(db, "trade_exit", { mode: t.mode, kind: "launch", trade_id: t.id, symbol: t.symbol, side: "sell", reason, signal_price_usd: price ?? null });

    let exitPrice: number;
    let pnlSol: number;
    let fill: string;
    if (t.mode === "real") {
      try {
        const agent = loadOrCreateWallet(db).keypair;
        const { signature, proceedsLamports } = await sellAllOnPumpFun(agent, new PublicKey(t.mint).toBase58());
        const proceeds = proceedsLamports / LAMPORTS_PER_SOL;
        pnlSol = proceeds - t.size_sol;
        exitPrice = t.size_tokens && solUsd ? (proceeds * solUsd) / t.size_tokens : price ?? 0;
        fill = `sold on-chain ${signature}`;
      } catch (e) {
        say("error", `Couldn't sell launch buy of $${t.symbol} (${(e as Error).message.slice(0, 120)}). Retrying next cycle.`);
        continue;
      }
    } else {
      const r = ratio === null ? 1 : ratio * (1 - config.paperSlippageBps / 10_000);
      pnlSol = t.size_sol * (r - 1);
      exitPrice = t.entry_price * r;
      fill = ratio === null ? "paper, no reference market" : "paper, follows reference token";
    }
    const pnlPct = t.size_sol > 0 ? (pnlSol / t.size_sol) * 100 : 0;
    db.prepare(
      `UPDATE trades SET status='closed', exit_price=?, exit_ts=?, exit_reason=?, exit_fill_source=?, pnl_pct=?, pnl_sol=?, exit_proof_id=? WHERE id=?`,
    ).run(exitPrice, nowIso(), reason, fill, pnlPct, pnlSol, proof.id, t.id);
    say(pnlSol >= 0 ? "win" : "loss",
      `${t.mode === "paper" ? "PAPER: " : ""}Sold launch buy of $${t.symbol} (${hitTarget ? `${config.launchTakeProfitX}x hit` : `${config.launchMaxHoldHours}h up`}) at ${fmtPct(pnlPct)} (${fmtSol(pnlSol)}) → goes to $COPYCOW holders' weekly airdrop`);
  }
}
