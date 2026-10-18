/**
 * PUBLISHED DASHBOARD DATA (for hosting the website on Vercel).
 *
 * Vercel can't see COWBOT's local database file, so COWBOT publishes a
 * ready-made copy of every dashboard feed to a free Turso database, and the
 * website reads those copies:
 *     COWBOT ──writes──▶ Turso (table dashboard_snapshot) ◀──reads── Vercel site
 * The website only needs a READ-ONLY Turso token.
 *
 * Keys: one per feed ("summary", "wallets", …) plus one per wallet page
 * ("wallet:<address>"), written whenever COWBOT re-analyzes that wallet.
 *
 * Settings (both in .env for COWBOT, and in Vercel → Project → Environment Variables):
 *   TURSO_DATABASE_URL  e.g. libsql://copycow-yourname.turso.io
 *   TURSO_AUTH_TOKEN    full-access token for COWBOT, read-only token for Vercel
 */
import { createClient, type Client } from "@libsql/client";

export const SNAPSHOT_KEYS = ["summary", "wallets", "groups", "leaders", "copies", "performance", "proof", "logs", "rugchecks"] as const;
export type FeedKey = (typeof SNAPSHOT_KEYS)[number];
export type SnapshotKey = FeedKey | `wallet:${string}`;

export const walletKey = (address: string): SnapshotKey => `wallet:${address}`;

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
const UPSERT = "INSERT INTO dashboard_snapshot (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at";

/** COWBOT: publish many keys in one go. */
export async function writeSnapshot(data: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const entries = Object.entries(data);
  // Turso batches are best kept modest; wallet pages can be numerous.
  for (let i = 0; i < Math.max(1, entries.length); i += 200) {
    await store().batch(
      [CREATE, ...entries.slice(i, i + 200).map(([key, value]) => ({ sql: UPSERT, args: [key, JSON.stringify(value), now] }))],
      "write",
    );
  }
}

/** Website: read one key. Returns null if COWBOT hasn't published it yet. */
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
