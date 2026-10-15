import "server-only";
import { openDb, type DB } from "@copycow/shared/db";

// One connection per server process (survives hot reloads in dev).
const g = globalThis as unknown as { __copycowDb?: DB };
export function db(): DB {
  if (!g.__copycowDb) g.__copycowDb = openDb();
  return g.__copycowDb;
}
