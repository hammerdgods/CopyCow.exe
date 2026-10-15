/**
 * ╔══════════════════════════════════════════╗
 * ║  COWBOT.exe — the main agent loop         ║
 * ╚══════════════════════════════════════════╝
 * `npm run agent` starts everything on a schedule (all times UTC):
 *   every 5 min   trading cycle (paper)          CYCLE_CRON
 *   every 30 min  trend scan → maybe launch      SCAN_CRON
 *   every 30 min  creator-reward claim: 10% COWBOT / 90% team   FEE_POLL_CRON
 *   Mondays 00:05 weekly airdrop: ALL COWBOT profit → $COPYCOW holders   AIRDROP_CRON
 *   daily 00:20   launched-coin creator rewards → that coin's holders  COIN_AIRDROP_CRON
 *   daily 23:55   daily recap post               RECAP_CRON
 * `npm run cycle` runs ONE trading cycle and exits.
 */
import cron from "node-cron";
import { openDb, setMeta } from "@copycow/shared";
import { config } from "./config";
import { attachLogDb, say } from "./log";
import { runTradingCycle, heartbeat } from "./trading/cycle";
import { runTrendScan } from "./trend-scanner/scanner";
import { considerLaunches } from "./token-launcher/launcher";
import { pollFees } from "./fees/tracker";
import { runCoinAirdrops, runWeeklyAirdrops } from "./airdrop/epoch";
import { resumeAirdrops } from "./airdrop/onchain";
import { writeDailyRecap } from "./recap/daily";
import { loadOrCreateWallet } from "./wallet/wallet";
import { publishSnapshot } from "./publish/snapshot";
import { snapshotStoreConfigured } from "@copycow/shared/snapshot-store";

const db = openDb();
attachLogDb(db);

const BANNER = `
   ^__^
   (oo)\\_______        C:\\> COWBOT.EXE
   (__)\\       )\\/\\     Copy the Smartest Cow in the Room
       ||----w |        trading: PAPER · launches: ${config.launchMode.toUpperCase()}
       ||     ||
`;

/** Runs a job unless the previous run of the same job is still going. */
const running = new Set<string>();
async function job(name: string, fn: () => Promise<void>): Promise<void> {
  if (running.has(name)) return;
  running.add(name);
  try {
    await fn();
  } catch (e) {
    say("error", `${name} failed: ${(e as Error).message}`);
  } finally {
    running.delete(name);
  }
  // Keep the hosted website (Vercel) in sync after every job.
  await publishSnapshot(db, { force: name !== "trading cycle" });
}

const tradingCycle = () => job("trading cycle", () => runTradingCycle(db));
const trendScan = () =>
  job("trend scan", async () => {
    const r = await runTrendScan(db);
    await considerLaunches(db, r.launchCandidates);
  });
const feePoll = () =>
  job("reward check", async () => {
    await pollFees(db);
    // A real airdrop that hit a snag gets retried every 30 min, not next week.
    if (config.launchMode === "real") await resumeAirdrops(db);
  });
const airdrop = () => job("weekly airdrop", () => runWeeklyAirdrops(db));
const coinAirdrop = () => job("coin airdrops", () => runCoinAirdrops(db));
const recap = () =>
  job("daily recap", async () => {
    const { file } = writeDailyRecap(db);
    say("info", `Daily report written to ${file}`);
  });

async function main() {
  const { keypair, created } = loadOrCreateWallet(db);
  if (process.argv.includes("--once")) {
    await runTradingCycle(db);
    await publishSnapshot(db, { force: true });
    return;
  }
  console.log(BANNER);
  say("info", `Waking up. Agent wallet ${keypair.publicKey.toBase58()}${created ? " (just created — back up data/wallet/!)" : ""}.`);
  if (config.launchMode === "real") {
    say("warn", "LAUNCH_MODE=real — launches, launch-buy sales, reward claims and holder airdrops use REAL SOL. Momentum trading stays paper.");
    if (config.copycowMint && !config.teamWallet) say("warn", "TODO: set TEAM_WALLET in .env — COWBOT won't claim creator rewards until it knows where the team's 90% of $COPYCOW rewards goes.");
  }
  else say("info", "Everything is PAPER. No real funds will move. Moo.");
  if (!config.heliusApiKey && !config.solanaRpcUrl) say("info", "TODO: add HELIUS_API_KEY to .env for a faster, more reliable Solana connection (using the public RPC for now).");
  if (snapshotStoreConfigured()) say("info", "Publishing dashboard data to Turso after every job (for the hosted website).");
  if (!config.xBearerToken) say("info", "TODO: add X_BEARER_TOKEN to .env to scan X. Using free sources (DexScreener + GeckoTerminal) meanwhile.");

  for (const [name, expr] of Object.entries({ CYCLE_CRON: config.cycleCron, SCAN_CRON: config.scanCron, FEE_POLL_CRON: config.feePollCron, AIRDROP_CRON: config.airdropCron, COIN_AIRDROP_CRON: config.coinAirdropCron, RECAP_CRON: config.recapCron })) {
    if (!cron.validate(expr)) throw new Error(`${name}="${expr}" in .env is not a valid schedule`);
  }
  const opts = { timezone: "UTC" };
  cron.schedule(config.cycleCron, tradingCycle, opts);
  cron.schedule(config.scanCron, trendScan, opts);
  cron.schedule(config.feePollCron, feePoll, opts);
  cron.schedule(config.airdropCron, airdrop, opts);
  cron.schedule(config.coinAirdropCron, coinAirdrop, opts);
  cron.schedule(config.recapCron, recap, opts);

  // Start grazing right away instead of waiting for the first tick.
  await tradingCycle();
  setTimeout(() => void trendScan(), 20_000);
  setTimeout(() => void feePoll(), 40_000);
}

function shutdown() {
  say("info", "Lying down for a nap (agent stopped).");
  heartbeat(db, "stopped");
  setMeta(db, "agent_status", "stopped");
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await main();
if (process.argv.includes("--once")) db.close();
