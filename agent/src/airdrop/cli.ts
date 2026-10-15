/**
 * `npm run airdrop`             — run this week's airdrop epoch now (paper unless LAUNCH_MODE=real)
 * `npm run airdrop -- --resume` — finish a real airdrop that was interrupted
 * `npm run airdrop -- --status` — show the dividend pool and past epochs
 */
import { LAMPORTS_PER_SOL, openDb, pendingDividendLamports } from "@copycow/shared";
import { config } from "../config";
import { attachLogDb } from "../log";
import { runAirdropEpoch } from "./epoch";
import { resumeAirdrops } from "./onchain";

const db = openDb();
attachLogDb(db);
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);

if (process.argv.includes("--resume")) {
  await resumeAirdrops(db);
} else if (!process.argv.includes("--status")) {
  console.log(`🐄 Running airdrop epoch in ${config.launchMode.toUpperCase()} mode…`);
  await runAirdropEpoch(db);
}
console.log(`\nDividend pool waiting: ${sol(pendingDividendLamports(db, config.launchMode === "paper"))} SOL`);
const rows = db.prepare("SELECT epoch_index, mode, status, total_lamports, wallets_paid, period_end FROM airdrop_epochs ORDER BY id DESC LIMIT 10").all() as {
  epoch_index: number; mode: string; status: string; total_lamports: number; wallets_paid: number; period_end: string;
}[];
for (const r of rows) console.log(`  #${r.epoch_index} ${r.period_end.slice(0, 10)} ${r.mode.padEnd(5)} ${r.status.padEnd(11)} ${sol(r.total_lamports)} SOL → ${r.wallets_paid} wallets`);
