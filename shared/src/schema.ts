/**
 * The database layout. One SQLite file (data/copycow.db) is shared by the
 * agent (writes), the dashboard (reads) and the copytrade engine.
 * "CREATE TABLE IF NOT EXISTS" means it's safe to run every startup.
 */
export const SCHEMA_SQL = /* sql */ `
-- Key/value facts about the agent: heartbeat, wallet address, mode...
CREATE TABLE IF NOT EXISTS agent_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- COWBOT's diary (shown as the terminal feed on the dashboard)
CREATE TABLE IF NOT EXISTS agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_log_ts ON agent_log(ts);

-- Prices COWBOT saw each cycle (used for momentum + charts)
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  price_usd REAL NOT NULL,
  change_15m_pct REAL,
  volume_24h_usd REAL,
  liquidity_usd REAL,
  source TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap_mint_ts ON price_snapshots(mint, ts);

-- Every paper trade, open or closed
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'long',
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  mode TEXT NOT NULL DEFAULT 'paper',
  size_sol REAL NOT NULL,
  size_usd REAL NOT NULL,
  entry_price REAL NOT NULL,
  entry_ts TEXT NOT NULL,
  entry_reason TEXT,
  entry_fill_source TEXT,
  momentum_15m_pct REAL,
  volume_pace REAL,
  exit_price REAL,
  exit_ts TEXT,
  exit_reason TEXT,
  exit_fill_source TEXT,
  last_price REAL,
  last_price_ts TEXT,
  pnl_pct REAL,
  pnl_sol REAL,
  entry_proof_id INTEGER,
  exit_proof_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_exit_ts ON trades(exit_ts);

-- "We can't cheat" layer: a hash of every decision, written BEFORE it executes.
-- Each hash also covers the previous hash (a chain), so editing any old row
-- breaks every hash after it.
CREATE TABLE IF NOT EXISTS proof_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  committed_at TEXT NOT NULL
);

-- Trend scanner: raw mention counts per term per scan
CREATE TABLE IF NOT EXISTS trend_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  source TEXT NOT NULL,
  count REAL NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_term_ts ON trend_mentions(term, ts);

CREATE TABLE IF NOT EXISTS trend_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  sources TEXT NOT NULL,
  terms_seen INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

-- Trends worth remembering (qualified ones + near misses)
CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  term TEXT NOT NULL,
  score REAL NOT NULL,
  mention_count REAL NOT NULL,
  velocity_ratio REAL NOT NULL,
  memeable INTEGER NOT NULL,
  solana_adjacent INTEGER NOT NULL,
  large_cap INTEGER NOT NULL,
  qualified INTEGER NOT NULL,
  sources TEXT NOT NULL,
  sample_posts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'logged',
  status_reason TEXT,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trends_detected ON trends(detected_at);

-- X (Twitter) API reads, so we never blow the free-tier monthly budget
CREATE TABLE IF NOT EXISTS x_api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  posts_read INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT
);

-- Tokens COWBOT launched (or WOULD have launched, in paper mode)
CREATE TABLE IF NOT EXISTS launched_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trend_id INTEGER,
  trend_term TEXT NOT NULL,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('paper','real')),
  status TEXT NOT NULL,
  mint TEXT,
  metadata_uri TEXT,
  launch_buy_sol REAL NOT NULL,
  tx_signature TEXT,
  proof_id INTEGER,
  launched_at TEXT NOT NULL,
  error TEXT
);

-- Every fee that comes in, already split 10% holders / 90% treasury
CREATE TABLE IF NOT EXISTS fee_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL CHECK (source_type IN ('creator_fee','copytrade_fee')),
  source_ref TEXT,
  launched_token_id INTEGER,
  amount_lamports INTEGER NOT NULL,
  holder_lamports INTEGER NOT NULL,
  treasury_lamports INTEGER NOT NULL,
  simulated INTEGER NOT NULL,
  tx_signature TEXT,
  note TEXT,
  airdrop_epoch_id INTEGER,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fees_epoch ON fee_receipts(airdrop_epoch_id);

-- Treasury (the 90%) money in and out
CREATE TABLE IF NOT EXISTS treasury_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_lamports INTEGER NOT NULL,
  ref TEXT,
  simulated INTEGER NOT NULL
);

-- Weekly airdrops
CREATE TABLE IF NOT EXISTS airdrop_epochs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch_index INTEGER NOT NULL,
  merkle_epoch INTEGER,
  period_start TEXT,
  period_end TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  pool_lamports INTEGER NOT NULL,
  total_lamports INTEGER NOT NULL,
  wallets_paid INTEGER NOT NULL,
  merkle_root TEXT,
  snapshot_slot INTEGER,
  tx_signatures TEXT NOT NULL DEFAULT '[]',
  proof_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS airdrop_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch_id INTEGER NOT NULL,
  leaf_index INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  token_balance REAL NOT NULL,
  amount_lamports INTEGER NOT NULL,
  proof TEXT NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL
);

-- Copytrade subscribers (registered via the copytrade engine API)
CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  token_balance REAL NOT NULL,
  balance_verified INTEGER NOT NULL,
  max_size_sol REAL,
  api_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- What the copytrade engine WOULD execute (paper) for each subscriber
CREATE TABLE IF NOT EXISTS copy_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('buy','sell')),
  tier TEXT NOT NULL,
  queue_position INTEGER NOT NULL,
  delay_ms INTEGER NOT NULL,
  size_sol REAL NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL,
  pnl_sol REAL,
  fee_lamports INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (trade_id, subscriber_id, action)
);
`;
