/**
 * COWBOT's strategy: MOMENTUM + VOLUME only.
 *
 * ENTER when, for a token in the top-10-by-volume pasture:
 *   • 15-minute price change ≥ threshold (default +1%)    ← momentum
 *   • …but NOT above the FOMO cap (default +8%)           ← no chasing pumps
 *   • last hour's volume is at least its 24h average pace  ← volume confirms
 *   • more buys than sells in the last 15 minutes          ← real demand
 *   • the last 5 minutes aren't already reversing
 *   • not in cooldown after a loss on this token           ← no revenge trades
 *
 * EXIT when: +3% take-profit, -1.5% stop-loss, or held too long.
 */
import type { Config } from "../config";
import type { PoolInfo } from "../market/geckoterminal";

export interface EntryContext {
  heldMints: Set<string>;
  cooldownUntil: Map<string, number>; // mint -> epoch ms
  now: number;
}

export interface EntrySignal {
  enter: boolean;
  reason: string;
  score: number;
  momentum15m: number;
  volumePace: number;
  buyPressure: number;
  fomo?: boolean;
}

export function volumePace(p: PoolInfo): number {
  const avgHourly = p.volume.h24 / 24;
  return avgHourly > 0 ? p.volume.h1 / avgHourly : 0;
}

export function buyPressure(p: PoolInfo): number {
  const total = p.txM15.buys + p.txM15.sells;
  return total > 0 ? p.txM15.buys / total : 0;
}

export function evaluateEntry(p: PoolInfo, cfg: Config, ctx: EntryContext): EntrySignal {
  const m15 = p.change.m15;
  const pace = volumePace(p);
  const bp = buyPressure(p);
  const base = { momentum15m: m15, volumePace: pace, buyPressure: bp, score: 0 };

  if (ctx.heldMints.has(p.mint)) return { ...base, enter: false, reason: "already holding" };
  const cd = ctx.cooldownUntil.get(p.mint);
  if (cd && cd > ctx.now) return { ...base, enter: false, reason: "cooldown after a loss (no revenge trades)" };
  if (m15 < cfg.momentumThresholdPct) return { ...base, enter: false, reason: `15m momentum ${m15.toFixed(2)}% below threshold` };
  if (m15 > cfg.maxMomentumPct) return { ...base, enter: false, fomo: true, reason: `15m move ${m15.toFixed(2)}% is a pump — not chasing` };
  if (pace < cfg.minVolumePace) return { ...base, enter: false, reason: `volume pace ${pace.toFixed(2)}x too low` };
  if (bp < cfg.minBuyPressure) return { ...base, enter: false, reason: `more sellers than buyers (${(bp * 100).toFixed(0)}% buys)` };
  if (p.change.m5 < -0.5) return { ...base, enter: false, reason: "momentum already reversing (5m red)" };

  // Rank candidates: stronger momentum backed by heavier volume wins.
  const score = m15 * Math.min(pace, 3) * (0.5 + bp);
  return { ...base, score, enter: true, reason: `15m ${m15.toFixed(2)}% · vol pace ${pace.toFixed(2)}x · ${(bp * 100).toFixed(0)}% buys` };
}

export type ExitReason = "take_profit" | "stop_loss" | "time_exit";

export function evaluateExit(
  entryPrice: number,
  currentPrice: number,
  entryTs: string,
  cfg: Config,
  now: number,
): { exit: boolean; reason?: ExitReason; pnlPct: number } {
  const pnlPct = (currentPrice / entryPrice - 1) * 100;
  if (pnlPct >= cfg.takeProfitPct) return { exit: true, reason: "take_profit", pnlPct };
  if (pnlPct <= -cfg.stopLossPct) return { exit: true, reason: "stop_loss", pnlPct };
  const heldMin = (now - new Date(entryTs).getTime()) / 60_000;
  if (heldMin >= cfg.maxHoldMinutes) return { exit: true, reason: "time_exit", pnlPct };
  return { exit: false, pnlPct };
}
