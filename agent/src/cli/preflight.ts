/**
 * `npm run preflight` — a read-only go/no-go before GodsEye trades.
 * Checks settings against the wallet balance, then talks to the RPC, Jupiter
 * and RugCheck, and runs one real Jupiter swap through GodsEye's own
 * pre-signing checks (static check + simulation) WITHOUT signing or sending
 * it. Nothing is spent. Exits 1 if anything fails.
 */
import fs from "node:fs";
import { VersionedTransaction } from "@solana/web3.js";
import { dataPath, getMeta, LAMPORTS_PER_SOL, openDb, SOL_MINT } from "@godseye/shared";
import { config, rpcUrl } from "../config";
import { connection } from "../rpc";
import { jupiterPrices, jupiterQuote, jupiterSwapTx } from "../market/jupiter";
import { rugCheck } from "../market/rugcheck";
import { simulateCheck, staticCheck } from "../copy/verify";
import { loadOrCreateWallet, walletBalanceSol, walletFile } from "../wallet/wallet";
import { checkConfig, type Finding, type Level, worst } from "./preflight-checks";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DRY_RUN_LAMPORTS = 1_000_000n; // 0.001 SOL, only ever simulated

const findings: Finding[] = [];
const add = (level: Level, check: string, detail: string) => findings.push({ level, check, detail });
const msg = (e: unknown) => (e as Error).message.slice(0, 200);
const ICON: Record<Level, string> = { ok: "✅", warn: "⚠️ ", fail: "❌" };

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    add("fail", name, msg(e));
  }
}

const db = openDb();

// ---- Wallet (never creates one) ----
let balance: number | null = null;
let keypair: ReturnType<typeof loadOrCreateWallet>["keypair"] | null = null;
const file = walletFile();
if (!fs.existsSync(file)) {
  add("fail", "wallet", `no key file at ${file} — run "npm run wallet" to create one, then fund it`);
} else {
  keypair = loadOrCreateWallet(db).keypair;
  const address = keypair.publicKey.toBase58();
  add("ok", "wallet", address);
  const mode = fs.statSync(file).mode & 0o777;
  if (mode & 0o077) add("warn", "key file permissions", `${file} is readable by other users (mode ${mode.toString(8)}); run: chmod 600 "${file}"`);
  const recorded = getMeta(db, "wallet_pubkey");
  if (recorded && recorded !== address) add("fail", "wallet identity", `database says ${recorded} but the key file is ${address}`);
}

// ---- RPC ----
await step("RPC", async () => {
  const t = Date.now();
  const slot = await connection().getSlot();
  const host = new URL(rpcUrl()).host;
  add("ok", "RPC", `${host} slot ${slot} in ${Date.now() - t} ms`);
  if (keypair) balance = await walletBalanceSol(keypair.publicKey);
});

// ---- Settings vs balance ----
findings.push(...checkConfig(config, balance));

// ---- Jupiter ----
await step("Jupiter prices", async () => {
  const p = await jupiterPrices([SOL_MINT]);
  const usd = p.get(SOL_MINT)?.usdPrice;
  if (!usd) throw new Error("no SOL price returned");
  add("ok", "Jupiter prices", `SOL = $${usd.toFixed(2)}`);
});

// ---- Dry-run swap through the pre-signing checks ----
if (keypair && balance !== null && balance >= 0.02) {
  const wallet = keypair.publicKey;
  await step("dry-run swap", async () => {
    const q = await jupiterQuote(SOL_MINT, USDC, DRY_RUN_LAMPORTS, config.slippageBps);
    const built = await jupiterSwapTx(q, wallet.toBase58());
    const tx = VersionedTransaction.deserialize(Buffer.from(built.swapTransaction, "base64"));
    const problem = staticCheck(tx, wallet, config.priorityFeeMaxLamports);
    if (problem) throw new Error(`static check would refuse to sign a normal Jupiter swap: ${problem}`);
    await simulateCheck(connection(), tx, wallet, { side: "buy", mint: USDC, inLamports: BigInt(q.inAmount), minTokensOut: BigInt(q.otherAmountThreshold) });
    add("ok", "dry-run swap", `0.001 SOL → USDC passed the static check and simulation (${Number(q.inAmount) / LAMPORTS_PER_SOL} SOL in, not signed, not sent)`);
  });
} else add("warn", "dry-run swap", "skipped: needs the wallet funded with at least 0.02 SOL");

// ---- RugCheck ----
await step("rug check", async () => {
  const v = await rugCheck(openDb(":memory:"), BONK, "BONK");
  if (!v) throw new Error("couldn't read a token from Solana");
  add("ok", "rug check", `working (BONK → ${v.verdict})`);
});

// ---- Database state ----
const paused = getMeta(db, "copy_paused") === "1" || fs.existsSync(dataPath("PAUSE"));
add(paused ? "warn" : "ok", "pause state", paused ? "copying is PAUSED (npm run resume to continue)" : "not paused");
const hb = getMeta(db, "heartbeat");
add("ok", "agent heartbeat", hb ? `${hb} (${getMeta(db, "agent_status") ?? "?"})` : "agent has never run");
const open = db.prepare("SELECT COUNT(*) n FROM positions WHERE status='open'").get() as { n: number };
const today = db.prepare("SELECT COALESCE(SUM(pnl_sol),0) s FROM positions WHERE status='closed' AND closed_at >= ?").get(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) as { s: number };
add(open.n > 0 ? "warn" : "ok", "open positions", `${open.n} open · realized today ${today.s.toFixed(4)} SOL (limit −${config.dailyLossLimitSol})`);

// ---- Report ----
console.log("\nGodsEye preflight\n");
for (const f of findings) console.log(`${ICON[f.level]} ${f.check.padEnd(22)} ${f.detail}`);
const w = worst(findings);
const count = (l: Level) => findings.filter((f) => f.level === l).length;
console.log(`\n${count("fail")} failed · ${count("warn")} warnings · ${count("ok")} ok`);
console.log(w === "fail" ? "NO-GO: fix the failures above before starting the agent.\n" : w === "warn" ? "GO, with warnings: read each ⚠️  line and decide.\n" : "GO.\n");
db.close();
process.exit(w === "fail" ? 1 : 0);
