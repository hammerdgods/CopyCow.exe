/**
 * EXECUTION-PRIORITY QUEUE.
 * When COWBOT trades, every auto-copy subscriber gets a slot in line:
 *   1. higher tier first (MAD Cow → COW)
 *   2. within a tier, bigger $COPYCOW holders first
 *   3. ties → whoever subscribed earlier
 * Each slot also gets a simulated delay so the "faster execution" perk is visible.
 */
import { tierById } from "@copycow/shared/tiers";

export interface QueueSubscriber {
  id: number;
  wallet: string;
  tier: string;
  token_balance: number;
  max_size_sol: number | null;
  created_at: string;
}

export const SLOT_SPACING_MS = 250;

export interface QueueSlot {
  subscriber: QueueSubscriber;
  position: number;
  delayMs: number;
  sizeSol: number;
}

export function buildQueue(subs: QueueSubscriber[]): QueueSlot[] {
  return subs
    .filter((s) => tierById(s.tier).autoCopy)
    .sort((a, b) =>
      tierById(b.tier).rank - tierById(a.tier).rank ||
      b.token_balance - a.token_balance ||
      a.created_at.localeCompare(b.created_at))
    .map((s, i) => {
      const tier = tierById(s.tier);
      const sizeSol = Math.min(s.max_size_sol ?? tier.maxCopySizeSol, tier.maxCopySizeSol);
      return { subscriber: s, position: i + 1, delayMs: tier.executionDelayMs + i * SLOT_SPACING_MS, sizeSol };
    });
}
