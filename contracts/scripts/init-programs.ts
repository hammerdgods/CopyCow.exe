/**
 * One-time setup after deploying: creates each program's settings account.
 *   npm run init:programs -- --cluster devnet
 * Reads from the project's .env:
 *   TEAM_WALLET                 (REQUIRED: receives 90% of all creator rewards — use a wallet the team controls)
 *   COPYCOW_MINT                (placeholder allowed until launch; tier contract can be updated later)
 *   TREASURY_DAILY_LIMIT_SOL    (default 2)
 *   LAUNCH_TOTAL_BUDGET_SOL     (default 5)
 * The agent wallet (data/wallet/cowbot-keypair.json) becomes:
 *   • COWBOT in the money contract (keeps max 10% of creator rewards, deposits weekly profit)
 *   • the relayer/keeper that publishes weekly roots and pushes airdrops
 *   • the only key allowed to spend from the treasury program (within limits)
 * Your deploy wallet (~/.config/solana/id.json) becomes the ADMIN.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const env: Record<string, string> = {};
const fromProcess = (k: string) => process.env[k]?.trim();
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

for (const k of ["TEAM_WALLET", "COPYCOW_MINT", "AGENT_KEYPAIR_PATH", "TREASURY_DAILY_LIMIT_SOL", "LAUNCH_TOTAL_BUDGET_SOL"]) {
  const v = fromProcess(k);
  if (v) env[k] = v;
}

const clusterArg = process.argv[process.argv.indexOf("--cluster") + 1] ?? "devnet";
const url = clusterArg === "localnet" ? "http://127.0.0.1:8899" : clusterApiUrl(clusterArg as "devnet" | "mainnet-beta");
const loadKp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main() {
  const admin = loadKp(process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));
  const agentPath = env.AGENT_KEYPAIR_PATH || path.join(ROOT, "data/wallet/cowbot-keypair.json");
  if (!fs.existsSync(agentPath)) throw new Error(`No agent wallet at ${agentPath}. Run "npm run wallet" in the project root first.`);
  const agent = loadKp(agentPath).publicKey;
  // Placeholder mint until $COPYCOW exists (System Program id = "nothing yet").
  const mint = new PublicKey(env.COPYCOW_MINT || "11111111111111111111111111111111");
  if (!env.TEAM_WALLET) throw new Error("Set TEAM_WALLET in .env first (the wallet that receives the team's 90%).");
  const team = new PublicKey(env.TEAM_WALLET);
  if (team.equals(agent)) throw new Error("TEAM_WALLET must be a different wallet from COWBOT's agent wallet.");
  const sol = (n: number) => new BN(Math.round(n * LAMPORTS_PER_SOL));

  const provider = new anchor.AnchorProvider(new Connection(url, "confirmed"), new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../target/idl/${name}.json`), "utf8"));
  const tier = new Program(idl("tier_access"), provider);
  const dividend = new Program(idl("dividend_airdrop"), provider);
  const treasury = new Program(idl("treasury"), provider);

  console.log(`🐄 Initializing on ${clusterArg}\n   admin: ${admin.publicKey}\n   agent: ${agent}\n   team:  ${team}\n   mint:  ${mint}`);

  const run = async (label: string, fn: () => Promise<string>) => {
    try {
      console.log(`   ✅ ${label}: ${await fn()}`);
    } catch (e: any) {
      if (String(e?.message ?? e).includes("already in use")) console.log(`   ↪︎  ${label}: already initialized`);
      else throw e;
    }
  };
  await run("tier_access", () => tier.methods.initialize(mint).accounts({ admin: admin.publicKey }).rpc());
  await run("dividend_airdrop", () =>
    // 7 days: how long an airdrop stays open before unpaid leftovers can be released
    // back to the pool. (WHEN airdrops run — weekly profit, daily coin rewards — is COWBOT's schedule.)
    dividend.methods.initialize(agent, mint, new BN(7 * 24 * 3600)).accounts({ admin: admin.publicKey, agent, teamWallet: team }).rpc());
  await run("treasury", () =>
    treasury.methods
      .initialize(agent, sol(Number(env.TREASURY_DAILY_LIMIT_SOL || 2)), sol(Number(env.LAUNCH_TOTAL_BUDGET_SOL || 5)))
      .accounts({ admin: admin.publicKey })
      .rpc());
  console.log(`\nPut this in .env:  DIVIDEND_PROGRAM_ID=${dividend.programId.toBase58()}`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
