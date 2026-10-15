import "server-only";
import { NextResponse } from "next/server";
import { isLive, nextAirdropAt } from "@copycow/shared/dashboard-data";
import type { ProofData, Summary } from "@copycow/shared/dashboard-types";
import { readSnapshot, snapshotStoreConfigured, type SnapshotKey } from "@copycow/shared/snapshot-store";

/**
 * Where the website gets its data:
 *  • TURSO_DATABASE_URL set (e.g. on Vercel) → the copy COWBOT last published
 *  • otherwise (running next to COWBOT)       → COWBOT's local database, live
 */
export const hosted = snapshotStoreConfigured;

/**
 * On Vercel without Turso settings there is no data source at all (Vercel's disk
 * is read-only and has no database) — say so clearly instead of crashing.
 */
export function missingHostedSetup(): NextResponse | null {
  if (hosted() || !process.env.VERCEL) return null;
  return NextResponse.json(
    { error: "This site is on Vercel but has no data source yet: add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel → Settings → Environment Variables, then redeploy (see README)." },
    { status: 503 },
  );
}

/** Empty-but-valid answers for feeds COWBOT hasn't published yet. */
const EMPTY: Partial<Record<SnapshotKey, unknown>> = { positions: [], trades: [], logs: [] };

/** Hosted mode: answer a feed from the copy COWBOT published. */
export async function feed(key: SnapshotKey): Promise<NextResponse> {
  const snap = await readSnapshot<unknown>(key).catch((e: Error) => {
    console.error(`Turso read failed for ${key}:`, e.message);
    return undefined;
  });
  if (snap === undefined) return NextResponse.json({ error: "Couldn't reach COWBOT's published data (Turso). Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN." }, { status: 502 });
  if (snap === null) {
    if (key in EMPTY) return NextResponse.json(EMPTY[key]);
    return NextResponse.json({ error: "COWBOT hasn't published any data yet. Start the agent with TURSO_DATABASE_URL set." }, { status: 503 });
  }
  let body = snap.data;
  if (key === "summary") {
    // Recompute what depends on "now" so a stale copy can't claim COWBOT is live.
    const s = body as Summary;
    body = { ...s, live: isLive(s.heartbeat, s.agentStatus), nextAirdropAt: nextAirdropAt() };
  }
  if (key === "airdrops") body = { ...(body as object), nextAirdropAt: nextAirdropAt() };
  // Let Vercel's CDN serve the same copy for a few seconds (fewer Turso reads).
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30", "X-Data-Published-At": snap.updatedAt } });
}

/** The proof ledger is paged; the published copy holds the newest entries. */
export async function proofFeed(limit: number, offset: number): Promise<NextResponse> {
  const snap = await readSnapshot<ProofData>("proof").catch(() => undefined);
  if (snap === undefined) return NextResponse.json({ error: "Couldn't reach COWBOT's published data (Turso)." }, { status: 502 });
  if (snap === null) return NextResponse.json({ entries: [], total: 0, chain: { ok: true, checked: 0 } } satisfies ProofData);
  const p = snap.data;
  return NextResponse.json(
    { ...p, entries: p.entries.slice(offset, offset + limit), total: Math.min(p.total, p.entries.length) } satisfies ProofData,
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
  );
}
