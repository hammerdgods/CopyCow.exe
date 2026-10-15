/**
 * All of COWBOT's settings, read from the .env file in the project root.
 * Every setting has a safe default, so the agent runs even with an empty .env.
 */
import { envBool, envNum, envStr, loadEnv, HARD_MAX_LAUNCH_BUY_SOL } from "@copycow/shared";

loadEnv();

const launchMode = envStr("LAUNCH_MODE", "paper").toLowerCase() === "real" ? "real" : "paper";

export const config = {
  // ---- Mode ----
  /** "paper" (default) = simulate everything. "real" = real token launches, fee claims, airdrops. */
  launchMode: launchMode as "paper" | "real",

  // ---- API keys (all optional — COWBOT degrades gracefully) ----
  heliusApiKey: envStr("HELIUS_API_KEY"),
  solanaRpcUrl: envStr("SOLANA_RPC_URL"),
  birdeyeApiKey: envStr("BIRDEYE_API_KEY"),
  jupiterApiKey: envStr("JUPITER_API_KEY"),
  xBearerToken: envStr("X_BEARER_TOKEN"),
  openaiApiKey: envStr("OPENAI_API_KEY"),

  // ---- Trading strategy (always paper in this version) ----
  cycleCron: envStr("CYCLE_CRON", "*/5 * * * *"),
  universeSize: envNum("UNIVERSE_SIZE", 10),
  momentumThresholdPct: envNum("MOMENTUM_15M_THRESHOLD_PCT", 1.0),
  maxMomentumPct: envNum("MAX_MOMENTUM_15M_PCT", 8), // anything hotter = FOMO, skip
  minVolumePace: envNum("MIN_VOLUME_PACE", 1.0),
  minBuyPressure: envNum("MIN_BUY_PRESSURE", 0.5),
  takeProfitPct: envNum("TAKE_PROFIT_PCT", 3),
  stopLossPct: envNum("STOP_LOSS_PCT", 1.5),
  maxPositions: envNum("MAX_POSITIONS", 3),
  tradeSizeSol: envNum("TRADE_SIZE_SOL", 1),
  maxHoldMinutes: envNum("MAX_HOLD_MINUTES", 240),
  cooldownAfterLossMinutes: envNum("COOLDOWN_AFTER_LOSS_MINUTES", 120),
  rutAfterConsecutiveLosses: envNum("RUT_AFTER_CONSECUTIVE_LOSSES", 3),
  rutPauseMinutes: envNum("RUT_PAUSE_MINUTES", 60),
  minLiquidityUsd: envNum("MIN_LIQUIDITY_USD", 250_000),
  minUniqueBuyers24h: envNum("MIN_UNIQUE_BUYERS_24H", 300),
  // Scam / wash-trading filters (fresh relaunches trading 30x their own size)
  minPoolAgeHours: envNum("MIN_POOL_AGE_HOURS", 72),
  minMarketCapUsd: envNum("MIN_MARKET_CAP_USD", 5_000_000),
  maxVolumeToMarketCap: envNum("MAX_VOLUME_TO_MARKET_CAP", 3),
  paperSlippageBps: envNum("PAPER_SLIPPAGE_BPS", 30),
  paperStartingCapitalSol: envNum("PAPER_STARTING_CAPITAL_SOL", 100),

  // ---- Trend scanner ----
  scanCron: envStr("SCAN_CRON", "*/30 * * * *"),
  xMonthlyPostBudget: envNum("X_MONTHLY_POST_BUDGET", 100),
  xPostsPerScan: Math.min(100, Math.max(10, envNum("X_POSTS_PER_SCAN", 10))),
  xSearchQuery: envStr(
    "X_SEARCH_QUERY",
    '(solana OR pumpfun OR "pump.fun" OR from:pumpfun OR from:solana) (meme OR memecoin OR coin OR ca OR launch) -is:retweet lang:en',
  ),
  velocitySpikePct: envNum("VELOCITY_SPIKE_PCT", 500),
  minMentions: envNum("TREND_MIN_MENTIONS", 3),
  launchScoreThreshold: envNum("LAUNCH_SCORE_THRESHOLD", 75),
  scannerWarmupHours: envNum("SCANNER_WARMUP_HOURS", 6),
  largeCapFdvUsd: envNum("LARGE_CAP_FDV_USD", 50_000_000),

  // ---- Token launcher ----
  launchBuySol: Math.min(HARD_MAX_LAUNCH_BUY_SOL, envNum("LAUNCH_BUY_SOL", 0.5)),
  launchTotalBudgetSol: envNum("LAUNCH_TOTAL_BUDGET_SOL", 5),
  walletFloorSol: envNum("WALLET_FLOOR_SOL", 2),
  paperTreasuryStartSol: envNum("PAPER_TREASURY_START_SOL", 10),
  launchPriorityFeeSol: envNum("LAUNCH_PRIORITY_FEE_SOL", 0.0005),
  launchSlippagePct: envNum("LAUNCH_SLIPPAGE_PCT", 10),
  /** Sell COWBOT's launch buy when it's worth this many times what it cost… */
  launchTakeProfitX: envNum("LAUNCH_TAKE_PROFIT_X", 2),
  /** …or after this many hours, whichever comes first. */
  launchMaxHoldHours: envNum("LAUNCH_MAX_HOLD_HOURS", 24),
  tokenSocialX: envStr("TOKEN_SOCIAL_X", "https://x.com/copycowexe"),
  tokenWebsite: envStr("TOKEN_WEBSITE", "https://copycow.xyz"),

  // ---- Money split + airdrops ----
  /** Receives 90% of every creator reward (marketing). Required before any real claim. */
  teamWallet: envStr("TEAM_WALLET"),
  /** Daily airdrop of each launched coin's creator rewards to that coin's holders. */
  coinAirdropCron: envStr("COIN_AIRDROP_CRON", "20 0 * * *"),
  /** Minimum tokens of a launched coin to receive its rewards airdrop. */
  coinAirdropMinTokens: envNum("COIN_AIRDROP_MIN_TOKENS", 1),
  feePollCron: envStr("FEE_POLL_CRON", "*/30 * * * *"),
  creatorFeeBpsEstimate: envNum("CREATOR_FEE_BPS_ESTIMATE", 5),
  paperFeeCapturePct: envNum("PAPER_FEE_CAPTURE_PCT", 2),
  paperFeeSimDays: envNum("PAPER_FEE_SIM_DAYS", 7),
  creatorFeeClaimMinSol: envNum("CREATOR_FEE_CLAIM_MIN_SOL", 0.01),
  copycowMint: envStr("COPYCOW_MINT"),
  airdropCron: envStr("AIRDROP_CRON", "5 0 * * 1"),
  airdropMinTokens: envNum("AIRDROP_MIN_TOKENS", 100_000),
  airdropMinPayoutSol: envNum("AIRDROP_MIN_PAYOUT_SOL", 0.001),
  airdropExcludeWallets: envStr("AIRDROP_EXCLUDE_WALLETS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  dividendProgramId: envStr("DIVIDEND_PROGRAM_ID"),

  // ---- Daily recap ----
  recapCron: envStr("RECAP_CRON", "55 23 * * *"),

  // ---- Misc ----
  logToConsoleOnly: envBool("LOG_CONSOLE_ONLY", false),
};

export type Config = typeof config;

/** Which Solana RPC to use: your own URL > Helius (free key) > public RPC. */
export function rpcUrl(): string {
  if (config.solanaRpcUrl) return config.solanaRpcUrl;
  if (config.heliusApiKey) return `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
  return "https://api.mainnet-beta.solana.com";
}
