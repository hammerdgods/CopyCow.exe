/**
 * `npm run airdrop`                 — PREVIEW the next airdrops (changes nothing)
 * `npm run airdrop -- --run`        — run this week's $COPYCOW profit airdrop now
 * `npm run airdrop -- --run-coins`  — run the daily launched-coin airdrops now
 * `npm run airdrop -- --resume`     — finish a real airdrop that was interrupted
 */
import { airdropPreview, LAMPORTS_PER_SOL, openDb, pendingCoinRewards } from "@copycow/shared";
import { config } from "../config";
import { attachLogDb } from "../log";
import { runCoinAirdrops, runWeeklyAirdrops } from "./epoch";
import { resumeAirdrops } from "./onchain";

const db = openDb();
attachLogDb(db);
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);

if (process.argv.includes("--resume")) {
  await resumeAirdrops(db);
} else if (process.argv.includes("--run")) {
  await runWeeklyAirdrops(db);
} else if (process.argv.includes("--run-coins")) {
  await runCoinAirdrops(db);
} else {
  console.log("🐄 Airdrop PREVIEW — nothing is changed. (`-- --run` = weekly profit airdrop now, `-- --run-coins` = coin airdrops now)\n");
  for (const mode of config.launchMode === "real" ? (["paper", "real"] as const) : (["paper"] as const)) {
    const p = airdropPreview(db, mode);
    console.log(`$COPYCOW holders — weekly (${mode}):`);
    console.log(`   since:            ${p.periodStart ?? "the beginning"}`);
    console.log(`   trading profit:   ${sol(p.tradingPnlLamports)} SOL`);
    console.log(`   launch-sale profit: ${sol(p.launchPnlLamports)} SOL${p.tradingPnlLamports + p.launchPnlLamports < 0 ? "  (losses are made back first)" : ""}`);
    console.log(`   copytrade fees:   ${sol(p.copytradeFeesLamports)} SOL`);
    console.log(`   would airdrop:    ${sol(p.poolLamports)} SOL\n`);
  }
  const coins = [...pendingCoinRewards(db, false).map((c) => ({ ...c, m: "real" })), ...pendingCoinRewards(db, true).map((c) => ({ ...c, m: "paper" }))];
  console.log("Launched-coin holders — daily:");
  if (!coins.length) console.log("   nothing waiting");
  for (const c of coins) console.log(`   $${c.ticker} (${c.m}): ${sol(c.lamports)} SOL for its holders`);
  if (!config.copycowMint) console.log("\n(COPYCOW_MINT not set yet — the $COPYCOW airdrop would skip and carry over)");
}
const rows = db.prepare("SELECT epoch_index, kind, token_mint, mode, status, total_lamports, wallets_paid, period_end FROM airdrop_epochs ORDER BY id DESC LIMIT 10").all() as {
  epoch_index: number; kind: string; token_mint: string; mode: string; status: string; total_lamports: number; wallets_paid: number; period_end: string;
}[];
if (rows.length) console.log("\nPast airdrops:");
for (const r of rows) console.log(`  #${r.epoch_index} ${r.period_end.slice(0, 10)} ${r.kind.padEnd(13)} ${r.mode.padEnd(5)} ${r.status.padEnd(11)} ${sol(r.total_lamports)} SOL → ${r.wallets_paid} wallets`);
