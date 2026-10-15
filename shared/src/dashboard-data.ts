/**
 * Everything the public dashboard shows, computed from COWBOT's database.
 * Used two ways:
 *   • locally: the dashboard's API routes call these directly
 *   • hosted (Vercel): COWBOT runs these and publishes the results to Turso
 *     (see agent/src/publish/snapshot.ts); the website reads those copies.
 */
import { type DB, getMeta } from "./db";
import { HEARTBEAT_STALE_MINUTES, LAMPORTS_PER_SOL } from "./constants";
import { equityCurve, maxDrawdown, monthlyReturns, rollingWinRate, winRate } from "./stats";
import { verifyProofChain, type ProofEntry } from "./proof";
import { airdropPreview } from "./split";
import type { AirdropsData, LaunchesData, LogRow, Performance, ProofData, Summary, Trade } from "./dashboard-types";

const L = LAMPORTS_PER_SOL;
/** Which airdrop record to headline: real once COWBOT launches for real, otherwise the paper record. */
const airdropMode = (): "paper" | "real" => ((process.env.LAUNCH_MODE ?? "paper").trim().toLowerCase() === "real" ? "real" : "paper");
const num = (v: string | null, d: number) => (v === null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));

/** Next weekly airdrop: Monday 00:05 UTC (matches the default AIRDROP_CRON). */
export function nextAirdropAt(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 5, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((1 - d.getUTCDay() + 7) % 7)); // move to Monday
  if (d <= now) d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

export function getSummary(d: DB): Summary {
  const hb = getMeta(d, "heartbeat");
  const status = getMeta(d, "agent_status");
  const live = isLive(hb, status);
  // Win rate = COWBOT's trading signals; P&L = everything (trading + launch sales).
  const closed = d.prepare("SELECT pnl_sol, exit_ts FROM trades WHERE status='closed' AND kind='momentum'").all() as { pnl_sol: number; exit_ts: string }[];
  const allClosed = d.prepare("SELECT pnl_sol, exit_ts, kind FROM trades WHERE status='closed'").all() as { pnl_sol: number; exit_ts: string; kind: string }[];
  const today = new Date().toISOString().slice(0, 10);
  const rewards = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(agent_lamports),0) g, COALESCE(SUM(team_lamports),0) t FROM fee_receipts WHERE source_type='copycow_reward'").get() as { a: number; g: number; t: number };
  const coin = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a FROM fee_receipts WHERE source_type='launch_reward'").get() as { a: number };
  const preview = airdropPreview(d, airdropMode());
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
    totalPnlSol: allClosed.reduce((s, t) => s + t.pnl_sol, 0),
    todayPnlSol: allClosed.filter((t) => t.exit_ts.startsWith(today)).reduce((s, t) => s + t.pnl_sol, 0),
    launchPnlSol: allClosed.filter((t) => t.kind === "launch").reduce((s, t) => s + t.pnl_sol, 0),
    startingCapitalSol: num(getMeta(d, "paper_starting_capital_sol"), 100),
    openPositions: (d.prepare("SELECT COUNT(*) n FROM trades WHERE status='open' AND kind='momentum'").get() as { n: number }).n,
    airdropPoolSol: preview.poolLamports / L,
    airdropPeriodPnlSol: (preview.tradingPnlLamports + preview.launchPnlLamports) / L,
    creatorRewardsSol: rewards.a / L,
    agentShareSol: rewards.g / L,
    teamShareSol: rewards.t / L,
    coinRewardsSol: coin.a / L,
    tokensLaunched: (d.prepare("SELECT COUNT(*) n FROM launched_tokens WHERE status IN ('launched','paper_launched')").get() as { n: number }).n,
    airdroppedSol: airdropped.s / L,
    nextAirdropAt: nextAirdropAt(),
    cycleCount: num(getMeta(d, "cycle_count"), 0),
  };
}

export function getOpenPositions(d: DB): Trade[] {
  const rows = d
    .prepare(`SELECT t.*, p.hash AS entry_proof_hash FROM trades t LEFT JOIN proof_ledger p ON p.id = t.entry_proof_id
              WHERE t.status='open' ORDER BY t.entry_ts DESC`)
    .all() as Trade[];
  return rows.map((t) => {
    const last = t.last_price ?? t.entry_price;
    const u = (last / t.entry_price - 1) * 100;
    return { ...t, unrealized_pct: u, unrealized_sol: t.size_sol * (u / 100) };
  });
}

export function getClosedTrades(d: DB, limit = 2000): Trade[] {
  return d
    .prepare(`SELECT t.*, p.hash AS entry_proof_hash FROM trades t LEFT JOIN proof_ledger p ON p.id = t.entry_proof_id
              WHERE t.status='closed' ORDER BY t.exit_ts DESC LIMIT ?`)
    .all(limit) as Trade[];
}

export function getPerformance(d: DB): Performance {
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

export function getLaunches(d: DB): LaunchesData {
  const tokens = d
    .prepare(
      `SELECT lt.id, lt.trend_term, lt.name, lt.ticker, lt.mode, lt.status, lt.mint, lt.tx_signature, lt.launch_buy_sol, lt.launched_at,
              tr.score AS trend_score,
              COALESCE(SUM(f.amount_lamports),0) AS fees_lamports,
              COALESCE(SUM(CASE WHEN f.airdrop_epoch_id IS NOT NULL THEN f.amount_lamports ELSE 0 END),0) AS airdropped_lamports,
              COALESCE(MAX(f.simulated),0) AS simulated_fees,
              (SELECT pnl_sol FROM trades t WHERE t.launched_token_id = lt.id AND t.kind='launch' ORDER BY t.id DESC LIMIT 1) AS launch_pnl_sol,
              (SELECT status FROM trades t WHERE t.launched_token_id = lt.id AND t.kind='launch' ORDER BY t.id DESC LIMIT 1) AS launch_status
         FROM launched_tokens lt
         LEFT JOIN trends tr ON tr.id = lt.trend_id
         LEFT JOIN fee_receipts f ON f.launched_token_id = lt.id AND f.source_type='launch_reward'
        GROUP BY lt.id ORDER BY lt.launched_at DESC`,
    )
    .all() as LaunchesData["tokens"];
  const creator = d.prepare(`SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(agent_lamports),0) g, COALESCE(SUM(team_lamports),0) t,
      COALESCE(SUM(CASE WHEN team_status='sent' THEN team_lamports ELSE 0 END),0) sent FROM fee_receipts WHERE source_type='copycow_reward'`).get() as { a: number; g: number; t: number; sent: number };
  const coin = d.prepare(`SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(CASE WHEN airdrop_epoch_id IS NOT NULL THEN amount_lamports ELSE 0 END),0) dropped
      FROM fee_receipts WHERE source_type='launch_reward'`).get() as { a: number; dropped: number };
  const launchPnl = (d.prepare("SELECT COALESCE(SUM(pnl_sol),0) s FROM trades WHERE kind='launch' AND status='closed'").get() as { s: number }).s;
  const copy = d.prepare("SELECT COALESCE(SUM(amount_lamports),0) a FROM fee_receipts WHERE source_type='copytrade_fee'").get() as { a: number };
  const trends = d.prepare("SELECT * FROM trends ORDER BY detected_at DESC, score DESC LIMIT 40").all() as LaunchesData["trends"];
  return {
    tokens,
    totals: {
      coinRewardsSol: coin.a / L, coinRewardsAirdroppedSol: coin.dropped / L, launchPnlSol: launchPnl,
      copycowRewardsSol: creator.a / L, agentSol: creator.g / L, teamSol: creator.t / L, teamSentSol: creator.sent / L, copytradeFeesSol: copy.a / L,
    },
    trends,
    launchMode: getMeta(d, "launch_mode") ?? "paper",
  };
}

export function getAirdrops(d: DB): AirdropsData {
  const epochs = d.prepare(`SELECT e.*, lt.ticker FROM airdrop_epochs e LEFT JOIN launched_tokens lt ON lt.id = e.launched_token_id
      WHERE e.status != 'rolled_over' ORDER BY e.id DESC`).all() as AirdropsData["epochs"];
  const p = airdropPreview(d, airdropMode());
  return {
    epochs,
    pendingPoolSol: p.poolLamports / L,
    periodPnlSol: (p.tradingPnlLamports + p.launchPnlLamports) / L,
    copytradeFeesSol: p.copytradeFeesLamports / L,
    nextAirdropAt: nextAirdropAt(),
    totalAirdroppedSol: epochs.reduce((s, e) => s + e.total_lamports, 0) / L,
    mintConfigured: !!process.env.COPYCOW_MINT?.trim(),
  };
}

export function getProof(d: DB, limit = 50, offset = 0): ProofData {
  const all = d.prepare("SELECT * FROM proof_ledger ORDER BY id").all() as ProofEntry[];
  const entries = d.prepare("SELECT * FROM proof_ledger ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as ProofEntry[];
  return { entries, total: all.length, chain: verifyProofChain(all) };
}

export function getLogs(d: DB, limit = 40): LogRow[] {
  return d.prepare("SELECT * FROM agent_log ORDER BY id DESC LIMIT ?").all(limit) as LogRow[];
}

/** Is COWBOT alive, judged from its last heartbeat (works on a stored copy too). */
export function isLive(heartbeat: string | null, agentStatus: string | null, now = Date.now()): boolean {
  return !!heartbeat && agentStatus === "live" && now - new Date(heartbeat).getTime() < HEARTBEAT_STALE_MINUTES * 60_000;
}

/** How many proof-ledger entries a published copy keeps (newest first). */
export const SNAPSHOT_PROOF_ENTRIES = 500;

/** Every dashboard data feed, ready to publish. */
export function buildDashboardSnapshot(d: DB): Record<string, unknown> {
  return {
    summary: getSummary(d),
    positions: getOpenPositions(d),
    trades: getClosedTrades(d),
    performance: getPerformance(d),
    launches: getLaunches(d),
    airdrops: getAirdrops(d),
    proof: getProof(d, SNAPSHOT_PROOF_ENTRIES, 0),
    logs: getLogs(d, 40),
  };
}
