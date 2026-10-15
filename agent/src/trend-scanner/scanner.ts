/**
 * One trend scan:
 *   1. ask every source (GeckoTerminal, DexScreener, X) what's buzzing
 *   2. count mentions per term and compare with the term's 24h average
 *      (per source, so a once-every-3-days X read doesn't fake a spike)
 *   3. score + log trends, flag launch candidates
 */
import { type DB, nowIso } from "@copycow/shared";
import { config } from "../config";
import { say } from "../log";
import { aggregate, scoreTerm, type ScoredTrend } from "./score";
import { scanDexScreener } from "./sources/dexscreener";
import { scanGeckoTerminal } from "./sources/geckoterminal";
import { scanX } from "./sources/x";
import type { SourceResult } from "./types";

const shownTodos = new Set<string>();

export interface LoggedTrend extends ScoredTrend {
  id: number;
}

export interface ScanResult {
  scanId: number;
  sources: SourceResult[];
  scored: ScoredTrend[];
  logged: LoggedTrend[];
  launchCandidates: LoggedTrend[];
  warmedUp: boolean;
}

function baselinePerScan(db: DB, term: string, scanId: number, sinceIso: string): number {
  const scans = db
    .prepare("SELECT sources FROM trend_scans WHERE id < ? AND started_at >= ? AND finished_at IS NOT NULL")
    .all(scanId, sinceIso) as { sources: string }[];
  const activeScans: Record<string, number> = {};
  for (const s of scans) for (const src of JSON.parse(s.sources) as string[]) activeScans[src] = (activeScans[src] ?? 0) + 1;
  const counts = db
    .prepare("SELECT source, SUM(count) AS c FROM trend_mentions WHERE term = ? AND scan_id < ? AND ts >= ? GROUP BY source")
    .all(term, scanId, sinceIso) as { source: string; c: number }[];
  return counts.reduce((sum, r) => sum + r.c / Math.max(1, activeScans[r.source] ?? 1), 0);
}

export async function runTrendScan(db: DB): Promise<ScanResult> {
  const startedAt = nowIso();
  const scanId = Number(db.prepare("INSERT INTO trend_scans (started_at, sources) VALUES (?, '[]')").run(startedAt).lastInsertRowid);

  const sources = await Promise.all([scanGeckoTerminal(), scanDexScreener(), scanX(db)]);
  for (const s of sources) {
    if (!s.note || (s.note.startsWith("TODO") && shownTodos.has(s.note))) continue;
    if (s.note.startsWith("TODO")) shownTodos.add(s.note); // say each TODO once per run
    say(s.ok ? "info" : "warn", `Trend source ${s.source}: ${s.note}`);
  }
  const activeSources = sources.filter((s) => s.ok && s.mentions.length > 0).map((s) => s.source);

  const stats = aggregate(sources.flatMap((s) => s.mentions));
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const opts = { velocitySpikePct: config.velocitySpikePct, minMentions: config.minMentions, largeCapFdvUsd: config.largeCapFdvUsd };
  const scored = [...stats.values()]
    .map((s) => scoreTerm(s, baselinePerScan(db, s.term, scanId, since), opts))
    .sort((a, b) => b.score - a.score);

  const insertMention = db.prepare("INSERT INTO trend_mentions (scan_id, term, source, count, ts) VALUES (?, ?, ?, ?, ?)");
  const insertTrend = db.prepare(
    `INSERT INTO trends (scan_id, term, score, mention_count, velocity_ratio, memeable, solana_adjacent, large_cap, qualified,
       sources, sample_posts, status, status_reason, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'logged', ?, ?)`,
  );
  const logged: LoggedTrend[] = [];
  db.transaction(() => {
    for (const s of scored) for (const [src, c] of Object.entries(s.sources)) insertMention.run(scanId, s.term, src, c, startedAt);
    // Log every qualified trend, plus the strongest near-misses for context.
    for (const s of scored.filter((t) => t.qualified || t.score >= 45).slice(0, 25)) {
      const info = insertTrend.run(scanId, s.term, s.score, s.mentions, s.velocityRatio, +s.memeable, +s.solanaAdjacent, +s.largeCap,
        +s.qualified, JSON.stringify(s.sources), JSON.stringify(s.samples), s.why.join("; ") || null, startedAt);
      logged.push({ ...s, id: Number(info.lastInsertRowid) });
    }
    db.prepare("UPDATE trend_scans SET finished_at=?, sources=?, terms_seen=?, qualified=? WHERE id=?").run(
      nowIso(), JSON.stringify(activeSources), scored.length, scored.filter((s) => s.qualified).length, scanId);
    db.prepare("DELETE FROM trend_mentions WHERE ts < ?").run(new Date(Date.now() - 7 * 86_400_000).toISOString());
  })();

  // Warm-up: COWBOT needs a few hours of history to know what "normal" looks like.
  const first = db.prepare("SELECT MIN(started_at) AS t FROM trend_scans WHERE finished_at IS NOT NULL").get() as { t: string | null };
  const warmedUp = !!first.t && Date.now() - new Date(first.t).getTime() >= config.scannerWarmupHours * 3_600_000;
  const launchCandidates = logged.filter((t) => t.qualified && t.score >= config.launchScoreThreshold);

  const q = scored.filter((s) => s.qualified);
  say("trend", `Trend scan #${scanId}: ${scored.length} terms from [${activeSources.join(", ") || "no sources"}], ${q.length} qualified` +
    (q.length ? ` — top: ${q.slice(0, 3).map((t) => `${t.term.toUpperCase()} (${t.score})`).join(", ")}` : ""));
  if (!warmedUp && launchCandidates.length) {
    say("info", `Still warming up (${config.scannerWarmupHours}h of history needed) — noting ${launchCandidates.length} candidate(s), no launches yet.`);
    for (const c of launchCandidates) db.prepare("UPDATE trends SET status='skipped', status_reason='scanner warm-up' WHERE id=?").run(c.id);
  }
  return { scanId, sources, scored, logged, launchCandidates: warmedUp ? launchCandidates : [], warmedUp };
}
