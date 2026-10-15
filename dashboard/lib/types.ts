// Shapes returned by the dashboard's API routes (used by client components).

export interface Summary {
  live: boolean;
  heartbeat: string | null;
  agentStatus: string | null;
  tradingMode: string;
  launchMode: string;
  demo: boolean;
  wallet: { pubkey: string | null; balanceSol: number | null; checkedAt: string | null };
  winRate: number | null;
  closedTrades: number;
  wins: number;
  losses: number;
  totalPnlSol: number;
  todayPnlSol: number;
  startingCapitalSol: number;
  openPositions: number;
  dividendPoolSol: number;
  totalFeesSol: number;
  holdersTotalSol: number;
  tokensLaunched: number;
  airdroppedSol: number;
  nextAirdropAt: string;
  cycleCount: number;
}

export interface Trade {
  id: number;
  mint: string;
  symbol: string;
  status: "open" | "closed";
  size_sol: number;
  size_usd: number;
  entry_price: number;
  entry_ts: string;
  entry_reason: string | null;
  exit_price: number | null;
  exit_ts: string | null;
  exit_reason: string | null;
  last_price: number | null;
  last_price_ts: string | null;
  pnl_pct: number | null;
  pnl_sol: number | null;
  unrealized_pct?: number;
  unrealized_sol?: number;
  entry_proof_hash?: string | null;
}

export interface Performance {
  startingCapitalSol: number;
  equity: { ts: string; equity: number; cumPnl: number; drawdownPct: number }[];
  rollingWinRate: { day: string; winRate: number; trades: number }[];
  monthly: { month: string; pnlSol: number; returnPct: number }[];
  drawdown: { maxDrawdownPct: number; maxDrawdownSol: number; peakTs: string | null; troughTs: string | null };
  currentDrawdownPct: number;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
}

export interface LaunchedToken {
  id: number;
  trend_term: string;
  name: string;
  ticker: string;
  mode: "paper" | "real";
  status: string;
  mint: string | null;
  tx_signature: string | null;
  launch_buy_sol: number;
  launched_at: string;
  trend_score: number | null;
  fees_lamports: number;
  holder_lamports: number;
  treasury_lamports: number;
  simulated_fees: number;
}

export interface Trend {
  id: number;
  term: string;
  score: number;
  mention_count: number;
  velocity_ratio: number;
  qualified: number;
  status: string;
  status_reason: string | null;
  sources: string;
  sample_posts: string;
  detected_at: string;
}

export interface LaunchesData {
  tokens: LaunchedToken[];
  totals: { feesSol: number; holdersSol: number; treasurySol: number; copytradeFeesSol: number };
  trends: Trend[];
  launchMode: string;
}

export interface AirdropEpoch {
  id: number;
  epoch_index: number;
  merkle_epoch: number | null;
  period_start: string | null;
  period_end: string;
  mode: string;
  status: string;
  pool_lamports: number;
  total_lamports: number;
  wallets_paid: number;
  merkle_root: string | null;
  snapshot_slot: number | null;
  tx_signatures: string;
  notes: string | null;
}

export interface AirdropsData {
  epochs: AirdropEpoch[];
  pendingPoolSol: number;
  nextAirdropAt: string;
  totalAirdroppedSol: number;
  mintConfigured: boolean;
}

export interface ProofRow {
  id: number;
  kind: string;
  payload: string;
  prev_hash: string;
  hash: string;
  committed_at: string;
}

export interface ProofData {
  entries: ProofRow[];
  total: number;
  chain: { ok: boolean; checked: number; brokenAtId?: number };
}

export interface LogRow {
  id: number;
  ts: string;
  level: string;
  message: string;
}
