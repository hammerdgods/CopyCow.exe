/**
 * The PAPER broker. It never touches real money. It asks Jupiter for a real
 * quote ("what would this swap give me right now?") so simulated fills
 * include real slippage/price impact. If Jupiter is unreachable it uses the
 * mid price minus a fixed slippage.
 *
 * Every entry/exit is hashed into the proof ledger BEFORE it is recorded.
 */
import { commitProof, type DB, nowIso, SOL_MINT, USDC_MINT, LAMPORTS_PER_SOL } from "@copycow/shared";
import { config } from "../config";
import { jupiterQuote } from "../market/jupiter";
import { tokenDecimals } from "../market/decimals";

export interface TradeRow {
  id: number;
  mint: string;
  symbol: string;
  status: "open" | "closed";
  size_sol: number;
  size_usd: number;
  entry_price: number;
  entry_ts: string;
  exit_price: number | null;
  exit_ts: string | null;
  exit_reason: string | null;
  pnl_pct: number | null;
  pnl_sol: number | null;
  last_price: number | null;
}

interface Fill {
  price: number;
  source: string;
}

/** Simulated BUY fill price (USD per token) for spending `sizeSol` SOL. */
async function simulateBuyFill(mint: string, midPrice: number, sizeSol: number, solUsd: number, decimals?: number): Promise<Fill> {
  const lamports = BigInt(Math.round(sizeSol * LAMPORTS_PER_SOL));
  try {
    if (mint === SOL_MINT) {
      // "Buying SOL" = swapping USDC into SOL. Effective price = USD spent / SOL received.
      const usdSpent = sizeSol * solUsd;
      const q = await jupiterQuote(USDC_MINT, SOL_MINT, BigInt(Math.round(usdSpent * 1e6)), 50);
      const solOut = Number(q.outAmount) / LAMPORTS_PER_SOL;
      if (solOut > 0) return { price: usdSpent / solOut, source: "jupiter_quote" };
    }
    decimals ??= await tokenDecimals(mint);
    if (decimals !== undefined) {
      const q = await jupiterQuote(SOL_MINT, mint, lamports, 100);
      const tokensOut = Number(q.outAmount) / 10 ** decimals;
      if (tokensOut > 0) return { price: (sizeSol * solUsd) / tokensOut, source: "jupiter_quote" };
    }
  } catch {
    /* fall through to mid price */
  }
  return { price: midPrice * (1 + config.paperSlippageBps / 10_000), source: "mid+slippage" };
}

/** Simulated SELL fill: mid price minus slippage (selling into the book). */
function simulateSellFill(midPrice: number): Fill {
  return { price: midPrice * (1 - config.paperSlippageBps / 10_000), source: "mid-slippage" };
}

export async function openPaperTrade(
  db: DB,
  args: { mint: string; symbol: string; midPrice: number; decimals?: number; solUsd: number; reason: string; momentum15m: number; volumePace: number },
): Promise<TradeRow> {
  const sizeSol = config.tradeSizeSol;
  // 1) PRE-COMMIT: hash the decision before "executing" it.
  const proof = commitProof(db, "trade_entry", {
    mode: "paper",
    mint: args.mint,
    symbol: args.symbol,
    side: "buy",
    size_sol: sizeSol,
    signal_price_usd: args.midPrice,
    reason: args.reason,
  });
  // 2) Execute (simulated).
  const fill = await simulateBuyFill(args.mint, args.midPrice, sizeSol, args.solUsd, args.decimals);
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO trades (mint, symbol, status, mode, size_sol, size_usd, entry_price, entry_ts, entry_reason,
         entry_fill_source, momentum_15m_pct, volume_pace, last_price, last_price_ts, entry_proof_id)
       VALUES (?, ?, 'open', 'paper', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(args.mint, args.symbol, sizeSol, sizeSol * args.solUsd, fill.price, ts, args.reason, fill.source,
      args.momentum15m, args.volumePace, args.midPrice, ts, proof.id);
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(info.lastInsertRowid) as TradeRow;
}

export function closePaperTrade(db: DB, trade: TradeRow, midPrice: number, reason: string): TradeRow {
  const proof = commitProof(db, "trade_exit", {
    mode: "paper",
    trade_id: trade.id,
    mint: trade.mint,
    symbol: trade.symbol,
    side: "sell",
    entry_price_usd: trade.entry_price,
    signal_price_usd: midPrice,
    reason,
  });
  const fill = simulateSellFill(midPrice);
  const pnlPct = (fill.price / trade.entry_price - 1) * 100;
  const pnlSol = trade.size_sol * (pnlPct / 100);
  db.prepare(
    `UPDATE trades SET status='closed', exit_price=?, exit_ts=?, exit_reason=?, exit_fill_source=?, pnl_pct=?, pnl_sol=?,
       last_price=?, last_price_ts=?, exit_proof_id=? WHERE id=?`,
  ).run(fill.price, nowIso(), reason, fill.source, pnlPct, pnlSol, midPrice, nowIso(), proof.id, trade.id);
  return db.prepare("SELECT * FROM trades WHERE id = ?").get(trade.id) as TradeRow;
}

export function markPrice(db: DB, tradeId: number, price: number): void {
  db.prepare("UPDATE trades SET last_price=?, last_price_ts=? WHERE id=?").run(price, nowIso(), tradeId);
}

export const openTrades = (db: DB): TradeRow[] =>
  db.prepare("SELECT * FROM trades WHERE status='open' ORDER BY entry_ts").all() as TradeRow[];
