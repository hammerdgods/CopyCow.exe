/**
 * X (Twitter) API v2 — recent search.
 *
 * FREE TIER BUDGET: roughly 100 posts READ per month. COWBOT treats that as
 * a hard budget (X_MONTHLY_POST_BUDGET) and spreads it out: with the defaults
 * (10 posts per scan) X is only queried about every 3 days. Every read is
 * recorded in the x_api_usage table so the budget survives restarts.
 * The free sources (DexScreener / GeckoTerminal) cover the gaps in between.
 *
 * TODO(founder): get a bearer token at https://developer.x.com and put it in
 * .env as X_BEARER_TOKEN. Without it, this source is skipped automatically.
 */
import { type DB, nowIso } from "@copycow/shared";
import { config } from "../../config";
import { HttpError, fetchJson } from "../../http";
import { isMemeable, looksSolanaAdjacent, termsFromText } from "../extract";
import type { Mention, SourceResult } from "../types";

interface XSearch {
  data?: {
    id: string;
    text: string;
    created_at?: string;
    public_metrics?: { like_count: number; retweet_count: number };
    entities?: { cashtags?: { tag: string }[]; hashtags?: { tag: string }[] };
  }[];
  meta?: { result_count: number };
}

export function xBudgetStatus(db: DB, now = new Date()): { used: number; budget: number; nextAllowedAt: Date | null; allowed: boolean } {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const used = (db.prepare("SELECT COALESCE(SUM(posts_read),0) AS s FROM x_api_usage WHERE ts >= ?").get(monthStart) as { s: number }).s;
  const budget = config.xMonthlyPostBudget;
  const scansPerMonth = Math.max(1, Math.floor(budget / config.xPostsPerScan));
  const minGapMs = (30 * 86_400_000) / scansPerMonth; // spread reads evenly over the month
  const last = db.prepare("SELECT ts FROM x_api_usage ORDER BY id DESC LIMIT 1").get() as { ts: string } | undefined;
  const nextAllowedAt = last ? new Date(new Date(last.ts).getTime() + minGapMs) : null;
  const allowed = used + config.xPostsPerScan <= budget && (!nextAllowedAt || nextAllowedAt <= now);
  return { used, budget, nextAllowedAt, allowed };
}

export async function scanX(db: DB): Promise<SourceResult> {
  if (!config.xBearerToken) {
    return { source: "x", ok: false, mentions: [], note: "TODO: no X_BEARER_TOKEN in .env — X scanning skipped (free sources still used)" };
  }
  const budget = xBudgetStatus(db);
  if (!budget.allowed) {
    return {
      source: "x",
      ok: true,
      mentions: [],
      note: `X budget guard: ${budget.used}/${budget.budget} posts used this month; next X read after ${budget.nextAllowedAt?.toISOString() ?? "next month"}`,
    };
  }
  const params = new URLSearchParams({
    query: config.xSearchQuery,
    max_results: String(config.xPostsPerScan),
    "tweet.fields": "created_at,public_metrics,entities",
  });
  try {
    const res = await fetchJson<XSearch>(`https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { authorization: `Bearer ${config.xBearerToken}` },
      retries: 0,
    });
    const posts = res.data ?? [];
    db.prepare("INSERT INTO x_api_usage (ts, endpoint, posts_read, ok) VALUES (?, 'search/recent', ?, 1)").run(nowIso(), posts.length);
    const mentions: Mention[] = [];
    for (const p of posts) {
      const tagTerms = [...(p.entities?.cashtags ?? []), ...(p.entities?.hashtags ?? [])].map((t) => t.tag.toLowerCase());
      const terms = new Set([...tagTerms, ...termsFromText(p.text)].filter(isMemeable));
      const engagement = (p.public_metrics?.like_count ?? 0) + 2 * (p.public_metrics?.retweet_count ?? 0);
      for (const term of terms) {
        mentions.push({
          term,
          source: "x",
          weight: 1 + Math.min(2, engagement / 100),
          solanaAdjacent: looksSolanaAdjacent(p.text),
          sample: `X: ${p.text.replace(/\s+/g, " ").slice(0, 200)}`,
        });
      }
    }
    return { source: "x", ok: true, mentions, note: `read ${posts.length} posts (${budget.used + posts.length}/${budget.budget} this month)` };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    // Count a failed call as 0 posts so we still respect the spacing.
    db.prepare("INSERT INTO x_api_usage (ts, endpoint, posts_read, ok, note) VALUES (?, 'search/recent', 0, 0, ?)").run(nowIso(), (e as Error).message.slice(0, 300));
    const hint =
      status === 401 ? "bearer token rejected — re-copy it from developer.x.com" :
      status === 403 ? "your X plan doesn't allow search — TODO: upgrade X API tier or rely on free sources" :
      status === 429 ? "X rate limit hit — will retry on the next allowed window" : (e as Error).message;
    return { source: "x", ok: false, mentions: [], note: `X API: ${hint}` };
  }
}
