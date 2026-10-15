// Shapes of the dashboard's data feeds (used by the website and by COWBOT when publishing).

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
  /** Next weekly $COPYCOW airdrop = ALL COWBOT profit (trading + launch sales) since the last paid airdrop + copytrade fees. */
  airdropPoolSol: number;
  /** Profit since the last paid airdrop (negative = must be made back first). */
  airdropPeriodPnlSol: number;
  launchPnlSol: number;
  /** $COPYCOW creator rewards and their 10/90 split. */
  creatorRewardsSol: number;
  agentShareSol: number;
  teamShareSol: number;
  /** Creator rewards of launched coins (100% for those coins' holders). */
  coinRewardsSol: number;
  tokensLaunched: number;
  airdroppedSol: number;
  nextAirdropAt: string;
  cycleCount: number;
}

export interface Trade {
  id: number;
  kind: "momentum" | "launch";
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
  airdropped_lamports: number;
  launch_pnl_sol: number | null;
  launch_status: string | null;
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
  totals: {
    coinRewardsSol: number; coinRewardsAirdroppedSol: number; launchPnlSol: number;
    copycowRewardsSol: number; agentSol: number; teamSol: number; teamSentSol: number; copytradeFeesSol: number;
  };
  trends: Trend[];
  launchMode: string;
}

export interface AirdropEpoch {
  id: number;
  epoch_index: number;
  kind: "cowbot_profit" | "coin_rewards";
  token_mint: string | null;
  ticker: string | null;
  merkle_epoch: number | null;
  period_start: string | null;
  period_end: string;
  mode: string;
  status: string;
  pool_lamports: number;
  trading_pnl_lamports: number;
  copytrade_fees_lamports: number;
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
  periodPnlSol: number;
  copytradeFeesSol: number;
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
