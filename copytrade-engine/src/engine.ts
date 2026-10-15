/**
 * The copy engine loop (every ENGINE_POLL_SECONDS):
 *  • COWBOT opened a trade  → queue a BUY copy for every COW / MAD Cow subscriber
 *  • COWBOT closed a trade  → queue the matching SELL, compute the copier's P&L,
 *    and charge the performance fee on profits → 10/90 splitter
 * PAPER MODE ONLY: instructions are built and logged, never signed or sent.
 */
import { type DB, LAMPORTS_PER_SOL, nowIso, recordCopytradeFee, SOL_MINT, USDC_MINT } from "@copycow/shared";
import { engineConfig } from "./config";
import { buildQueue, type QueueSubscriber } from "./queue";

interface TradeRow {
  id: number;
  mint: string;
  symbol: string;
  status: string;
  size_sol: number;
  size_usd: number;
  entry_ts: string;
  pnl_pct: number | null;
}

/** What a real copy would send: a Jupiter swap request for the subscriber's wallet. */
export function buildInstruction(trade: TradeRow, action: "buy" | "sell", wallet: string, sizeSol: number) {
  const solUsd = trade.size_usd / trade.size_sol;
  const base = { router: "jupiter-swap-v1", userPublicKey: wallet, slippageBps: engineConfig.slippageBps, mode: "PAPER — not signed, not sent" };
  if (trade.mint === SOL_MINT) {
    return action === "buy"
      ? { ...base, inputMint: USDC_MINT, outputMint: SOL_MINT, amount: Math.round(sizeSol * solUsd * 1e6), note: `swap $${(sizeSol * solUsd).toFixed(2)} USDC → SOL` }
      : { ...base, inputMint: SOL_MINT, outputMint: USDC_MINT, amount: Math.round(sizeSol * LAMPORTS_PER_SOL), note: `swap ${sizeSol} SOL → USDC` };
  }
  return action === "buy"
    ? { ...base, inputMint: SOL_MINT, outputMint: trade.mint, amount: Math.round(sizeSol * LAMPORTS_PER_SOL), note: `swap ${sizeSol} SOL → ${trade.symbol}` }
    : { ...base, inputMint: trade.mint, outputMint: SOL_MINT, amount: "entire copied position", note: `swap all ${trade.symbol} → SOL` };
}

export function processSignals(db: DB, log: (msg: string) => void = console.log): { buys: number; sells: number } {
  const subs = db.prepare("SELECT id, wallet, tier, token_balance, max_size_sol, created_at FROM subscribers").all() as QueueSubscriber[];
  if (subs.length === 0) return { buys: 0, sells: 0 };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO copy_executions (trade_id, subscriber_id, action, tier, queue_position, delay_ms, size_sol, instruction, status, pnl_sol, fee_lamports, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paper_logged', ?, ?, ?)`,
  );
  let buys = 0;
  let sells = 0;

  // New BUY signals: open trades that started after the subscriber joined (no copying stale entries).
  const opens = db.prepare("SELECT * FROM trades WHERE status='open' AND kind='momentum' ORDER BY entry_ts").all() as TradeRow[];
  for (const t of opens) {
    const queue = buildQueue(subs.filter((s) => s.created_at <= t.entry_ts));
    for (const slot of queue) {
      const r = insert.run(t.id, slot.subscriber.id, "buy", slot.subscriber.tier, slot.position, slot.delayMs, slot.sizeSol,
        JSON.stringify(buildInstruction(t, "buy", slot.subscriber.wallet, slot.sizeSol)), null, null, nowIso());
      if (r.changes) {
        buys++;
        log(`📋 PAPER copy BUY #${slot.position} (${slot.subscriber.tier}, +${slot.delayMs}ms): ${slot.subscriber.wallet.slice(0, 6)}… ${slot.sizeSol} SOL → ${t.symbol}`);
      }
    }
  }

  // SELL signals: closed trades where a subscriber copied the buy but not yet the sell.
  const pending = db.prepare(
    `SELECT e.trade_id, e.subscriber_id, e.tier, e.queue_position, e.delay_ms, e.size_sol, t.mint, t.symbol, t.status, t.size_sol AS t_size_sol,
            t.size_usd, t.entry_ts, t.pnl_pct, s.wallet
       FROM copy_executions e JOIN trades t ON t.id = e.trade_id JOIN subscribers s ON s.id = e.subscriber_id
      WHERE e.action='buy' AND t.status='closed'
        AND NOT EXISTS (SELECT 1 FROM copy_executions x WHERE x.trade_id=e.trade_id AND x.subscriber_id=e.subscriber_id AND x.action='sell')`,
  ).all() as (TradeRow & { trade_id: number; subscriber_id: number; tier: string; queue_position: number; delay_ms: number; t_size_sol: number; wallet: string })[];
  for (const p of pending) {
    const trade = { ...p, id: p.trade_id, size_sol: p.t_size_sol };
    const pnlSol = p.size_sol * ((p.pnl_pct ?? 0) / 100);
    const feeLamports = pnlSol > 0 ? Math.floor(pnlSol * LAMPORTS_PER_SOL * (engineConfig.perfFeeBps / 10_000)) : 0;
    db.transaction(() => {
      insert.run(p.trade_id, p.subscriber_id, "sell", p.tier, p.queue_position, p.delay_ms, p.size_sol,
        JSON.stringify(buildInstruction(trade, "sell", p.wallet, p.size_sol)), pnlSol, feeLamports, nowIso());
      if (feeLamports > 0) {
        recordCopytradeFee(db, {
          sourceRef: `trade:${p.trade_id}/sub:${p.subscriber_id}`,
          amountLamports: feeLamports,
          simulated: true,
          note: `${engineConfig.perfFeeBps / 100}% performance fee on +${pnlSol.toFixed(5)} SOL copied profit`,
        });
      }
    })();
    sells++;
    log(`📋 PAPER copy SELL ${p.wallet.slice(0, 6)}… ${p.symbol}: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(5)} SOL${feeLamports ? ` · fee ${(feeLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL (→ holder airdrop)` : ""}`);
  }
  return { buys, sells };
}
