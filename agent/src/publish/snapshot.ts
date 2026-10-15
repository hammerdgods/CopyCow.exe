/**
 * Publishes the dashboard's data to Turso so the website can run on Vercel
 * (Vercel can't see this computer's database file). Skipped entirely unless
 * TURSO_DATABASE_URL is set. Never stops COWBOT if Turso is unreachable.
 */
import { type DB } from "@copycow/shared";
import { buildDashboardSnapshot } from "@copycow/shared/dashboard-data";
import { snapshotStoreConfigured, writeSnapshot } from "@copycow/shared/snapshot-store";
import { say } from "../log";

let lastPublish = 0;
let lastWarn = 0;

export async function publishSnapshot(db: DB, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!snapshotStoreConfigured()) return false;
  if (!opts.force && Date.now() - lastPublish < 60_000) return false;
  try {
    await writeSnapshot(buildDashboardSnapshot(db));
    lastPublish = Date.now();
    return true;
  } catch (e) {
    if (Date.now() - lastWarn > 3_600_000) {
      lastWarn = Date.now();
      say("warn", `Couldn't publish dashboard data to Turso (${(e as Error).message.slice(0, 140)}). The website will show older data until this works.`);
    }
    return false;
  }
}
