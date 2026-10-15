/**
 * Holder tiers. Hold more $COPYCOW → faster copy execution + bigger sizing.
 * These numbers are mirrored in the on-chain Tier Access contract
 * (contracts/programs/tier_access/src/lib.rs). Keep them in sync.
 */
export type TierId = "NONE" | "CALF" | "HEIFER" | "COW" | "MAD_COW";

export interface Tier {
  id: TierId;
  name: string;
  /** Minimum whole $COPYCOW tokens needed. */
  minTokens: number;
  /** Higher rank = earlier in the execution queue. */
  rank: number;
  emoji: string;
  benefits: string[];
  /** Can this tier auto-copy trades? */
  autoCopy: boolean;
  /** Largest copy trade allowed per signal, in SOL. */
  maxCopySizeSol: number;
  /** Simulated head start: how long after COWBOT's trade this tier executes. */
  executionDelayMs: number;
}

export const TIERS: Tier[] = [
  {
    id: "MAD_COW",
    name: "MAD Cow",
    minTokens: 50_000_000,
    rank: 4,
    emoji: "🐂",
    benefits: [
      "Everything in COW",
      "Vote on COWBOT's agent config (thresholds, sizing)",
      "Max copy sizing (up to 5 SOL per signal)",
      "First execution slot in the copy queue",
    ],
    autoCopy: true,
    maxCopySizeSol: 5,
    executionDelayMs: 0,
  },
  {
    id: "COW",
    name: "COW",
    minTokens: 10_000_000,
    rank: 3,
    emoji: "🐄",
    benefits: [
      "Everything in HEIFER",
      "Auto-copy API key",
      "Priority execution (right after MAD Cows)",
      "Copy sizing up to 1 SOL per signal",
    ],
    autoCopy: true,
    maxCopySizeSol: 1,
    executionDelayMs: 1500,
  },
  {
    id: "HEIFER",
    name: "HEIFER",
    minTokens: 1_000_000,
    rank: 2,
    emoji: "🐮",
    benefits: ["Everything in CALF", "Real-time Telegram trade alerts"],
    autoCopy: false,
    maxCopySizeSol: 0,
    executionDelayMs: 0,
  },
  {
    id: "CALF",
    name: "CALF",
    minTokens: 100_000,
    rank: 1,
    emoji: "🍼",
    benefits: ["Full dashboard access", "Trade alerts (delayed)", "Weekly SOL airdrop eligibility"],
    autoCopy: false,
    maxCopySizeSol: 0,
    executionDelayMs: 0,
  },
];

export const NO_TIER: Tier = {
  id: "NONE",
  name: "Grazer (no tier)",
  minTokens: 0,
  rank: 0,
  emoji: "🌱",
  benefits: ["Public dashboard"],
  autoCopy: false,
  maxCopySizeSol: 0,
  executionDelayMs: 0,
};

/** Which tier does a wallet holding `tokens` whole $COPYCOW belong to? */
export function tierForBalance(tokens: number): Tier {
  for (const t of TIERS) if (tokens >= t.minTokens) return t;
  return NO_TIER;
}

export function tierById(id: string): Tier {
  return TIERS.find((t) => t.id === id) ?? NO_TIER;
}
