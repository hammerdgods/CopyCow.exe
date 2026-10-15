import "server-only";
import { getMeta } from "@copycow/shared/db";
import { HEARTBEAT_STALE_MINUTES, LAMPORTS_PER_SOL } from "@copycow/shared/constants";
import { equityCurve, maxDrawdown, monthlyReturns, rollingWinRate, winRate } from "@copycow/shared/stats";
import { verifyProofChain, type ProofEntry } from "@copycow/shared/proof";
import { db } from "./db";
import type { AirdropsData, LaunchesData, LogRow, Performance, ProofData, Summary, Trade } from "./types";

const L = LAMPORTS_PER_SOL;
const num = (v: string | null, d: number) => (v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

/** Next weekly airdrop: Monday 00:05 UTC (matches the default AIRDROP_CRON). */
export function nextAirdropAt(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 5, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((1 - d.getUTCDay() + 7) % 7)); // move to Monday
  if (d <= now) d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

export function getSummary(): Summary {
  const d = db();
  const hb = getMeta(d, "heartbeat");
  const status = getMeta(d, "agent_status");
  const live = !!hb && status === "live" && Date.now() - new Date(hb).getTime() < HEARTBEAT_STALE_MINUTES * 60_000;
  const closed = d.prepare("SELECT pnl_sol, exit_ts FROM trades WHERE status='closed'").all() as { pnl_sol: number; exit_ts: string }[];
  const today = new Date().toISOString().slice(0, 10);
  const fees = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(holder_lamports),0) h FROM fee_receipts").get() as { a: number; h: number };
  const pool = d.prepare("SELECT COALESCE(SUM(holder_lamports),0) s FROM fee_receipts WHERE airdrop_epoch_id IS NULL").get() as { s: number };
  const airdropped = d.prepare("SELECT COALESCE(SUM(total_lamports),0) s FROM airdrop_epochs WHERE status IN ('paper','completed','partial','published')").get() as { s: number };
  return {
    live,
    heartbeat: hb,
    agentStatus: status,
    tradingMode: getMeta(d, "trading_mode") ?? "paper",
    launchMode: getMeta(d, "launch_mode") ?? "paper",
    demo: getMeta(d, "demo_data") === "1",
    wallet: {
      pubkey: getMeta(d, "wallet_pubkey"),
      balanceSol: getMeta(d, "wallet_balance_sol") === null ? null : Number(getMeta(d, "wallet_balance_sol")),
      checkedAt: getMeta(d, "wallet_balance_checked_at"),
    },
    winRate: winRate(closed),
    closedTrades: closed.length,
    wins: closed.filter((t) => t.pnl_sol > 0).length,
    losses: closed.filter((t) => t.pnl_sol <= 0).length,
    totalPnlSol: closed.reduce((s, t) => s + t.pnl_sol, 0),
    todayPnlSol: closed.filter((t) => t.exit_ts.startsWith(today)).reduce((s, t) => s + t.pnl_sol, 0),
    startingCapitalSol: num(getMeta(d, "paper_starting_capital_sol"), 100),
    openPositions: (d.prepare("SELECT COUNT(*) n FROM trades WHERE status='open'").get() as { n: number }).n,
    dividendPoolSol: pool.s / L,
    totalFeesSol: fees.a / L,
    holdersTotalSol: fees.h / L,
    tokensLaunched: (d.prepare("SELECT COUNT(*) n FROM launched_tokens WHERE status IN ('launched','paper_launched')").get() as { n: number }).n,
    airdroppedSol: airdropped.s / L,
    nextAirdropAt: nextAirdropAt(),
    cycleCount: num(getMeta(d, "cycle_count"), 0),
  };
}

export function getOpenPositions(): Trade[] {
  const rows = db()
    .prepare(`SELECT t.*, p.hash AS entry_proof_hash FROM trades t LEFT JOIN proof_ledger p ON p.id = t.entry_proof_id
              WHERE t.status='open' ORDER BY t.entry_ts DESC`)
    .all() as Trade[];
  return rows.map((t) => {
    const last = t.last_price ?? t.entry_price;
    const u = (last / t.entry_price - 1) * 100;
    return { ...t, unrealized_pct: u, unrealized_sol: t.size_sol * (u / 100) };
  });
}

export function getClosedTrades(limit = 2000): Trade[] {
  return db()
    .prepare(`SELECT t.*, p.hash AS entry_proof_hash FROM trades t LEFT JOIN proof_ledger p ON p.id = t.entry_proof_id
              WHERE t.status='closed' ORDER BY t.exit_ts DESC LIMIT ?`)
    .all(limit) as Trade[];
}

export function getPerformance(): Performance {
  const d = db();
  const start = num(getMeta(d, "paper_starting_capital_sol"), 100);
  const trades = d.prepare("SELECT exit_ts, pnl_sol, pnl_pct FROM trades WHERE status='closed' ORDER BY exit_ts").all() as {
    exit_ts: string; pnl_sol: number; pnl_pct: number;
  }[];
  const equity = equityCurve(trades, start);
  const wins = trades.filter((t) => t.pnl_sol > 0);
  const losses = trades.filter((t) => t.pnl_sol <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl_sol, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_sol, 0));
  return {
    startingCapitalSol: start,
    equity: [{ ts: trades[0]?.exit_ts ?? new Date().toISOString(), equity: start, cumPnl: 0, drawdownPct: 0 }, ...equity],
    rollingWinRate: rollingWinRate(trades, 30),
    monthly: monthlyReturns(trades, start),
    drawdown: maxDrawdown(equity, start),
    currentDrawdownPct: equity.at(-1)?.drawdownPct ?? 0,
    avgWinPct: wins.length ? wins.reduce((s, t) => s + t.pnl_pct, 0) / wins.length : null,
    avgLossPct: losses.length ? losses.reduce((s, t) => s + t.pnl_pct, 0) / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
  };
}

export function getLaunches(): LaunchesData {
  const d = db();
  const tokens = d
    .prepare(
      `SELECT lt.id, lt.trend_term, lt.name, lt.ticker, lt.mode, lt.status, lt.mint, lt.tx_signature, lt.launch_buy_sol, lt.launched_at,
              tr.score AS trend_score,
              COALESCE(SUM(f.amount_lamports),0) AS fees_lamports, COALESCE(SUM(f.holder_lamports),0) AS holder_lamports,
              COALESCE(SUM(f.treasury_lamports),0) AS treasury_lamports, COALESCE(MAX(f.simulated),0) AS simulated_fees
         FROM launched_tokens lt
         LEFT JOIN trends tr ON tr.id = lt.trend_id
         LEFT JOIN fee_receipts f ON f.launched_token_id = lt.id AND f.source_type='creator_fee'
        GROUP BY lt.id ORDER BY lt.launched_at DESC`,
    )
    .all() as LaunchesData["tokens"];
  const creator = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(holder_lamports),0) h, COALESCE(SUM(treasury_lamports),0) t FROM fee_receipts WHERE source_type='creator_fee'").get() as { a: number; h: number; t: number };
  const copy = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a FROM fee_receipts WHERE source_type='copytrade_fee'").get() as { a: number };
  const trends = d.prepare("SELECT * FROM trends ORDER BY detected_at DESC, score DESC LIMIT 40").all() as LaunchesData["trends"];
  return {
    tokens,
    totals: { feesSol: creator.a / L, holdersSol: creator.h / L, treasurySol: creator.t / L, copytradeFeesSol: copy.a / L },
    trends,
    launchMode: getMeta(d, "launch_mode") ?? "paper",
  };
}

export function getAirdrops(): AirdropsData {
  const d = db();
  const epochs = d.prepare("SELECT * FROM airdrop_epochs ORDER BY id DESC").all() as AirdropsData["epochs"];
  const pool = d.prepare("SELECT COALESCE(SUM(holder_lamports),0) s FROM fee_receipts WHERE airdrop_epoch_id IS NULL").get() as { s: number };
  return {
    epochs,
    pendingPoolSol: pool.s / L,
    nextAirdropAt: nextAirdropAt(),
    totalAirdroppedSol: epochs.filter((e) => e.status !== "rolled_over").reduce((s, e) => s + e.total_lamports, 0) / L,
    mintConfigured: !!process.env.COPYCOW_MINT?.trim(),
  };
}

export function getProof(limit = 50, offset = 0): ProofData {
  const d = db();
  const all = d.prepare("SELECT * FROM proof_ledger ORDER BY id").all() as ProofEntry[];
  const entries = d.prepare("SELECT * FROM proof_ledger ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as ProofEntry[];
  return { entries, total: all.length, chain: verifyProofChain(all) };
}

export function getLogs(limit = 40): LogRow[] {
  return db().prepare("SELECT * FROM agent_log ORDER BY id DESC LIMIT ?").all(limit) as LogRow[];
}
