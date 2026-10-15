/**
 * ============================================================
 *  copycow.exe — MONEY RULES (shared by every part of the app)
 * ============================================================
 *
 * BPS = "basis points". 10,000 BPS = 100%. 1,000 BPS = 10%.
 */

/**
 * FOUNDER RULE: COWBOT keeps max 10% of creator rewards, do not change.
 * pump.fun creator rewards (from $COPYCOW AND from every token COWBOT
 * launches) are split the moment they're claimed:
 *   • 10% → COWBOT (its trading capital) — hard-coded, never more
 *   • 90% → the TEAM WALLET (marketing) — sent straight away, COWBOT never touches it
 * COWBOT's net trading PROFIT is what gets airdropped to $COPYCOW holders weekly.
 * The same number is hard-coded in the on-chain contract
 * (contracts/programs/dividend_airdrop/src/lib.rs → AGENT_SHARE_BPS).
 */
export const AGENT_SHARE_BPS = 1000 as const; // 10% — FOUNDER RULE: COWBOT KEEPS MAX 10%, DO NOT CHANGE

/** 100% expressed in basis points. */
export const BPS_DENOMINATOR = 10_000 as const;

/** The team's share of creator rewards (90%). */
export const TEAM_SHARE_BPS = BPS_DENOMINATOR - AGENT_SHARE_BPS; // 9000 = 90%

// Safety net: if someone ever edits the constant above to more than 10%,
// every program refuses to start.
if (AGENT_SHARE_BPS > 1000 || AGENT_SHARE_BPS < 0) {
  throw new Error("FOUNDER RULE VIOLATED: AGENT_SHARE_BPS must be <= 1000 (10%).");
}

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Well-known Solana token addresses. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Token launch safety rules — hard-coded, not configurable. */
export const MAX_LAUNCHES_PER_24H = 1 as const;
/** Absolute ceiling for a single launch buy, no matter what .env says. */
export const HARD_MAX_LAUNCH_BUY_SOL = 2 as const;

/** The agent counts as "live" if it checked in within this many minutes. */
export const HEARTBEAT_STALE_MINUTES = 12;

export const PROOF_GENESIS_HASH = "0".repeat(64);
