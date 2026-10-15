/**
 * TREND SIGNAL DETECTION. A trend QUALIFIES when ALL are true:
 *   • mention velocity spiked > VELOCITY_SPIKE_PCT (default 500%) vs its 24h average
 *   • the name is memeable
 *   • it's Solana-adjacent
 *   • it's not already a large-cap
 * Then it gets a 0–100 score. Score ≥ LAUNCH_SCORE_THRESHOLD → launch candidate.
 */
import type { Mention } from "./types";
import { hasMemeRoot, isLargeCap, isMemeable } from "./extract";

export interface TermStats {
  term: string;
  mentions: number;
  sources: Record<string, number>;
  solanaAdjacent: boolean;
  maxFdvUsd: number;
  samples: string[];
}

export function aggregate(mentions: Mention[]): Map<string, TermStats> {
  const map = new Map<string, TermStats>();
  for (const m of mentions) {
    const s = map.get(m.term) ?? { term: m.term, mentions: 0, sources: {}, solanaAdjacent: false, maxFdvUsd: 0, samples: [] };
    s.mentions += m.weight;
    s.sources[m.source] = (s.sources[m.source] ?? 0) + m.weight;
    s.solanaAdjacent ||= m.solanaAdjacent;
    s.maxFdvUsd = Math.max(s.maxFdvUsd, m.fdvUsd ?? 0);
    if (m.sample && s.samples.length < 3 && !s.samples.includes(m.sample)) s.samples.push(m.sample);
    map.set(m.term, s);
  }
  return map;
}

export interface ScoredTrend extends TermStats {
  velocityRatio: number;
  baselinePerScan: number;
  memeable: boolean;
  largeCap: boolean;
  qualified: boolean;
  score: number;
  why: string[];
}

export interface ScoreOptions {
  velocitySpikePct: number;
  minMentions: number;
  largeCapFdvUsd: number;
}

/** Minimum assumed "normal" mentions per scan, so brand-new words don't divide by zero. */
export const BASELINE_FLOOR = 0.5;

export function scoreTerm(stats: TermStats, baselinePerScan: number, opts: ScoreOptions): ScoredTrend {
  const velocityRatio = stats.mentions / Math.max(baselinePerScan, BASELINE_FLOOR);
  const spikeRatio = 1 + opts.velocitySpikePct / 100; // +500% → 6x
  const memeable = isMemeable(stats.term);
  const largeCap = isLargeCap(stats.term) || stats.maxFdvUsd >= opts.largeCapFdvUsd;
  const why: string[] = [];
  if (velocityRatio < spikeRatio) why.push(`velocity ${velocityRatio.toFixed(1)}x < ${spikeRatio}x`);
  if (stats.mentions < opts.minMentions) why.push(`only ${stats.mentions.toFixed(1)} mentions`);
  if (!memeable) why.push("not memeable");
  if (!stats.solanaAdjacent) why.push("not Solana-adjacent");
  if (largeCap) why.push("already a large-cap");
  const qualified = why.length === 0;

  const velocityPts = velocityRatio >= spikeRatio ? Math.min(40, 25 + (velocityRatio - spikeRatio) * 1.5) : Math.min(20, (velocityRatio / spikeRatio) * 20);
  const mentionPts = Math.min(20, stats.mentions * 3);
  const memePts = memeable ? 15 + (hasMemeRoot(stats.term) ? 10 : 0) : 0;
  const crossSourcePts = Math.min(15, (Object.keys(stats.sources).length - 1) * 7.5);
  const score = Math.round((velocityPts + mentionPts + memePts + crossSourcePts) * (largeCap || !stats.solanaAdjacent ? 0.5 : 1));

  return { ...stats, velocityRatio, baselinePerScan, memeable, largeCap, qualified, score, why };
}
