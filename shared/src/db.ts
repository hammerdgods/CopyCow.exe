/** Opens the shared SQLite database (data/copycow.db by default). */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { repoRoot } from "./env";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

export function dbFilePath(): string {
  const custom = process.env.COPYCOW_DB_PATH?.trim();
  return custom ? path.resolve(repoRoot(), custom) : path.join(repoRoot(), "data", "copycow.db");
}

export function openDb(file = dbFilePath()): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL"); // lets the dashboard read while the agent writes
  db.pragma("busy_timeout = 5000");
  migrate(db);
  db.exec(SCHEMA_SQL);
  return db;
}

export const nowIso = (): string => new Date().toISOString();

export function getMeta(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM agent_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DB, key: string, value: string | number): void {
  db.prepare(
    `INSERT INTO agent_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, String(value), nowIso());
}

/** Upgrades databases created by older versions of copycow.exe. */
function migrate(db: DB): void {
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const addMissing = (table: string, defs: Record<string, string>) => {
    const have = cols(table);
    if (!have.length) return; // table doesn't exist yet — SCHEMA_SQL creates it
    for (const [col, def] of Object.entries(defs)) if (!have.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  // v1 → v2: money model changed ($COPYCOW rewards 10% COWBOT / 90% team; launched-coin rewards
  // to that coin's holders; profits to $COPYCOW holders). Old fee rows were paper-only and used
  // the old split, so they're set aside, not converted.
  const fee = cols("fee_receipts");
  if (fee.length && !fee.includes("agent_lamports")) {
    db.exec(`ALTER TABLE fee_receipts RENAME TO fee_receipts_v1_backup;
             DROP INDEX IF EXISTS idx_fees_epoch;
             DELETE FROM treasury_ledger WHERE kind = 'fee_in';`);
  }
  addMissing("trades", { kind: "TEXT NOT NULL DEFAULT 'momentum'", launched_token_id: "INTEGER", size_tokens: "REAL" });
  addMissing("airdrop_epochs", {
    kind: "TEXT NOT NULL DEFAULT 'cowbot_profit'", token_mint: "TEXT", launched_token_id: "INTEGER",
    trading_pnl_lamports: "INTEGER NOT NULL DEFAULT 0", copytrade_fees_lamports: "INTEGER NOT NULL DEFAULT 0",
  });
}
