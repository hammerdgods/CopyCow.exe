/**
 * PUBLISHED DASHBOARD DATA (for hosting the website on Vercel).
 *
 * Vercel can't see COWBOT's local database file, so COWBOT publishes a
 * ready-made copy of every dashboard feed to a free Turso database, and the
 * website reads those copies:
 *     COWBOT ──writes──▶ Turso (table dashboard_snapshot) ◀──reads── Vercel site
 * The website only needs a READ-ONLY Turso token.
 *
 * Settings (both in .env for COWBOT, and in Vercel → Project → Environment Variables):
 *   TURSO_DATABASE_URL  e.g. libsql://copycow-yourname.turso.io
 *   TURSO_AUTH_TOKEN    full-access token for COWBOT, read-only token for Vercel
 */
import { createClient, type Client } from "@libsql/client";

export const SNAPSHOT_KEYS = ["summary", "positions", "trades", "performance", "launches", "airdrops", "proof", "logs", "rugchecks"] as const;
export type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];

export function snapshotStoreConfigured(): boolean {
  return !!process.env.TURSO_DATABASE_URL?.trim();
}

let client: Client | null = null;
function store(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!.trim(),
      authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
    });
  }
  return client;
}

const CREATE = `CREATE TABLE IF NOT EXISTS dashboard_snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)`;

/** COWBOT: publish all feeds in one go. */
export async function writeSnapshot(data: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  await store().batch(
    [
      CREATE,
      ...Object.entries(data).map(([key, value]) => ({
        sql: "INSERT INTO dashboard_snapshot (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
        args: [key, JSON.stringify(value), now],
      })),
    ],
    "write",
  );
}

/** Website: read one feed. Returns null if COWBOT hasn't published it yet. */
export async function readSnapshot<T>(key: SnapshotKey): Promise<{ data: T; updatedAt: string } | null> {
  try {
    const res = await store().execute({ sql: "SELECT json, updated_at FROM dashboard_snapshot WHERE key = ?", args: [key] });
    const row = res.rows[0];
    if (!row) return null;
    return { data: JSON.parse(String(row.json)) as T, updatedAt: String(row.updated_at) };
  } catch (e) {
    // Table not created yet = nothing published yet.
    if (/no such table/i.test(String((e as Error).message))) return null;
    throw e;
  }
}
