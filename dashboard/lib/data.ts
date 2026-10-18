import "server-only";
import { NextResponse } from "next/server";
import { filterWallets, isLive } from "@copycow/shared/dashboard-data";
import type { ProofData, Summary, WalletQuery, WalletRow } from "@copycow/shared/dashboard-types";
import { readSnapshot, snapshotStoreConfigured, walletKey, type FeedKey } from "@copycow/shared/snapshot-store";
import { TIERS, WALLET_KINDS } from "@copycow/shared/constants";

/**
 * Where the website gets its data:
 *  • TURSO_DATABASE_URL set (e.g. on Vercel) → the copy COWBOT last published
 *  • otherwise (running next to COWBOT)       → COWBOT's local database, live
 */
export const hosted = snapshotStoreConfigured;

const CACHE = { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" };

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
const EMPTY: Partial<Record<FeedKey, unknown>> = {
  wallets: [], groups: [], logs: [], rugchecks: [],
  copies: { open: [], closed: [], trades: [] },
  leaders: { leaders: [], changes: [], budgetSol: 0 },
};

async function read<T>(key: FeedKey) {
  return readSnapshot<T>(key).catch((e: Error) => {
    console.error(`Turso read failed for ${key}:`, e.message);
    return undefined;
  });
}
const unreachable = () => NextResponse.json({ error: "Couldn't reach COWBOT's published data (Turso). Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN." }, { status: 502 });

/** Hosted mode: answer a feed from the copy COWBOT published. */
export async function feed(key: FeedKey): Promise<NextResponse> {
  const snap = await read<unknown>(key);
  if (snap === undefined) return unreachable();
  if (snap === null) {
    if (key in EMPTY) return NextResponse.json(EMPTY[key]);
    return NextResponse.json({ error: "COWBOT hasn't published any data yet. Start the agent with TURSO_DATABASE_URL set." }, { status: 503 });
  }
  let body = snap.data;
  // Recompute "live" so a stale copy can't claim COWBOT is running.
  if (key === "summary") body = { ...(body as Summary), live: isLive((body as Summary).heartbeat, (body as Summary).agentStatus) };
  return NextResponse.json(body, { headers: { ...CACHE, "X-Data-Published-At": snap.updatedAt } });
}

/** Hosted mode: search the published wallet list. */
export async function walletsFeed(q: WalletQuery): Promise<NextResponse> {
  const snap = await read<WalletRow[]>("wallets");
  if (snap === undefined) return unreachable();
  return NextResponse.json(filterWallets(snap?.data ?? [], q), { headers: CACHE });
}

/** Hosted mode: one wallet's page. */
export async function walletFeed(address: string): Promise<NextResponse> {
  const snap = await readSnapshot<unknown>(walletKey(address)).catch(() => undefined);
  if (snap === undefined) return unreachable();
  if (snap === null) return NextResponse.json({ error: "COWBOT hasn't analyzed this wallet yet." }, { status: 404 });
  return NextResponse.json(snap.data, { headers: CACHE });
}

/** The proof ledger is paged; the published copy holds the newest entries. */
export async function proofFeed(limit: number, offset: number): Promise<NextResponse> {
  const snap = await read<ProofData>("proof");
  if (snap === undefined) return unreachable();
  if (snap === null) return NextResponse.json({ entries: [], total: 0, chain: { ok: true, checked: 0 } } satisfies ProofData);
  const p = snap.data;
  return NextResponse.json({ ...p, entries: p.entries.slice(offset, offset + limit), total: Math.min(p.total, p.entries.length) } satisfies ProofData, { headers: CACHE });
}

/** Reads ?q=&tier=&kind=&fresh=1&copied=1&sort=&limit=&offset= from a request URL. */
export function parseWalletQuery(sp: URLSearchParams): WalletQuery {
  const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | undefined => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
  return {
    q: sp.get("q")?.slice(0, 64) || undefined,
    tier: pick(sp.get("tier"), TIERS),
    kind: pick(sp.get("kind"), WALLET_KINDS),
    fresh: sp.get("fresh") === "1",
    copied: sp.get("copied") === "1",
    sort: pick(sp.get("sort"), ["pnl_30d", "pnl_7d", "weight", "ai_score", "last_activity", "first_seen"] as const),
    limit: Number(sp.get("limit") ?? 100) || 100,
    offset: Number(sp.get("offset") ?? 0) || 0,
  };
}
