/**
 * `npm run scan` — runs ONE trend scan and prints what COWBOT found.
 * (Scanner only: it never launches tokens. The full agent does that.)
 * Add `-- --watch` to keep scanning on the SCAN_CRON schedule.
 */
import cron from "node-cron";
import { openDb } from "@copycow/shared";
import { config } from "../config";
import { attachLogDb } from "../log";
import { runTrendScan } from "./scanner";
import { xBudgetStatus } from "./sources/x";

const db = openDb();
attachLogDb(db);

async function once() {
  const r = await runTrendScan(db);
  const x = xBudgetStatus(db);
  console.log(`\nX budget: ${x.used}/${x.budget} posts this month.`);
  console.log("\nTOP TERMS (score · mentions · velocity · qualified?)");
  for (const t of r.scored.slice(0, 15)) {
    console.log(`  ${t.qualified ? "✅" : "  "} ${t.term.padEnd(16)} ${String(t.score).padStart(3)} · ${t.mentions.toFixed(1).padStart(5)} · ${t.velocityRatio.toFixed(1).padStart(5)}x  ${t.why.join("; ")}`);
  }
  if (r.launchCandidates.length) console.log(`\n🚀 Launch candidates (score ≥ ${config.launchScoreThreshold}): ${r.launchCandidates.map((c) => c.term.toUpperCase()).join(", ")}`);
}

await once();
if (process.argv.includes("--watch")) {
  console.log(`\nWatching on schedule "${config.scanCron}" (Ctrl+C to stop)…`);
  cron.schedule(config.scanCron, () => void once().catch((e) => console.error(e)), { timezone: "UTC" });
}
