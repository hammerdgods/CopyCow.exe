/**
 * `npm run devnet:setup` — one-time setup for DEVNET mode (Solana's free test network).
 *  1. makes sure COWBOT's wallet has test SOL
 *  2. connects the money contract to COWBOT's wallet + your TEAM_WALLET
 *  3. creates a TEST $COPYCOW token (COWBOT holds the supply)
 *  4. writes SOLANA_NETWORK=devnet, DIVIDEND_PROGRAM_ID and COPYCOW_MINT into .env
 * Safe to run again: it skips anything already done.
 */
process.env.SOLANA_NETWORK = "devnet"; // before config loads
const { LAMPORTS_PER_SOL, PublicKey } = await import("@solana/web3.js");
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = await import("@solana/spl-token");
const { openDb } = await import("@copycow/shared");
const { config } = await import("../config");
const { connection } = await import("../rpc");
const { loadOrCreateWallet } = await import("../wallet/wallet");
const { DEV_MONEY_PROGRAM_ID, initializeMoneyContract, moneyProgramAt, readDistributor } = await import("../airdrop/onchain");
const { setEnvValues } = await import("./env-file");

const db = openDb();
const conn = connection();
const agent = loadOrCreateWallet(db).keypair;
const me = agent.publicKey.toBase58();
const programId = config.dividendProgramId || DEV_MONEY_PROGRAM_ID;
const say = (s: string) => console.log(s);
const stop = (s: string): never => {
  console.log(`\n❌ ${s}`);
  process.exit(1);
};

say(`🐄 DEVNET setup\n   COWBOT wallet: ${me}\n   money contract: ${programId}\n`);

// 0) TEAM_WALLET
if (!config.teamWallet) stop("Set TEAM_WALLET in .env first (your team's wallet address — on devnet any wallet you control, e.g. Phantom).");
let team: InstanceType<typeof PublicKey>;
try {
  team = new PublicKey(config.teamWallet);
} catch {
  stop(`TEAM_WALLET "${config.teamWallet}" isn't a valid Solana address.`);
}
if (team!.toBase58() === me) stop("TEAM_WALLET must be a different wallet from COWBOT's.");

// 1) test SOL
let bal = (await conn.getBalance(agent.publicKey)) / LAMPORTS_PER_SOL;
say(`1) Test SOL: ${bal.toFixed(3)}`);
if (bal < 0.2) {
  say("   Asking the devnet faucet for 1 test SOL…");
  try {
    const sig = await conn.requestAirdrop(agent.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    bal = (await conn.getBalance(agent.publicKey)) / LAMPORTS_PER_SOL;
    say(`   ✅ now ${bal.toFixed(3)} test SOL`);
  } catch {
    stop(`The faucet said no (it rate-limits). Get free test SOL here instead:
   1. open https://faucet.solana.com
   2. paste COWBOT's address: ${me}
   3. pick "devnet", amount 5, confirm (sign in with GitHub if asked)
   Then run  npm run devnet:setup  again.`);
  }
}

// 2) money contract deployed?
const progInfo = await conn.getAccountInfo(new PublicKey(programId));
if (!progInfo?.executable) stop(`The money contract isn't deployed on devnet at ${programId} yet. Ask Claude to deploy it (or run: cd contracts && npm run deploy:devnet).`);

// 3) test $COPYCOW
let mint = config.copycowMint;
const existing = mint ? await conn.getAccountInfo(new PublicKey(mint)).catch(() => null) : null;
if (!existing) {
  say("2) Creating a TEST $COPYCOW token (1,000,000,000 supply, held by COWBOT)…");
  const m = await createMint(conn, agent, agent.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(conn, agent, m, agent.publicKey);
  await mintTo(conn, agent, m, ata.address, agent, 1_000_000_000n * 1_000_000n);
  mint = m.toBase58();
  say(`   ✅ test $COPYCOW: ${mint}`);
} else {
  say(`2) Test $COPYCOW already exists: ${mint}`);
}

// 4) initialize the money contract
const prog = moneyProgramAt(db, programId);
const state = await readDistributor(prog);
if (!state) {
  say("3) Connecting the money contract to COWBOT + team wallet…");
  const sig = await initializeMoneyContract(prog, team!.toBase58(), mint!);
  say(`   ✅ done · https://solscan.io/tx/${sig}?cluster=devnet`);
} else if (state.agent === me) {
  say(`3) Money contract already connected to COWBOT (team wallet ${state.teamWallet}).`);
  if (state.teamWallet !== team!.toBase58()) say("   ⚠ It points to a different TEAM_WALLET than your .env. Only the admin (COWBOT) can change it — ask Claude if needed.");
} else {
  stop(`This devnet contract was already set up by another wallet (${state.agent}). Ask Claude to deploy a fresh copy for you.`);
}

const file = setEnvValues({ SOLANA_NETWORK: "devnet", DIVIDEND_PROGRAM_ID: programId, COPYCOW_MINT: mint!, LAUNCH_MODE: "paper" });
say(`\n✅ Devnet ready. Saved to ${file}:
   SOLANA_NETWORK=devnet · DIVIDEND_PROGRAM_ID=${programId} · COPYCOW_MINT=${mint}

Next:
   • give test $COPYCOW to wallets that should receive airdrops (COWBOT's own wallet never does):
       npm run devnet:give -- <wallet address> 5000000
   • start COWBOT:  npm run agent
   Watch COWBOT on Solscan: https://solscan.io/account/${me}?cluster=devnet`);
process.exit(0);

export {};
