/** `npm run devnet:give -- <wallet> <amount>` — send TEST $COPYCOW (devnet) to a wallet so it gets airdrops. */
process.env.SOLANA_NETWORK = "devnet";
const { LAMPORTS_PER_SOL, PublicKey } = await import("@solana/web3.js");
const { getOrCreateAssociatedTokenAccount, transfer } = await import("@solana/spl-token");
const { openDb } = await import("@copycow/shared");
const { config } = await import("../config");
const { connection } = await import("../rpc");
const { loadOrCreateWallet } = await import("../wallet/wallet");

const [walletArg, amountArg] = process.argv.slice(2);
if (!walletArg || !amountArg) {
  console.log("Usage: npm run devnet:give -- <wallet address> <amount of test $COPYCOW>\n  e.g. npm run devnet:give -- 7xKX...abc 5000000");
  process.exit(1);
}
if (!config.copycowMint) {
  console.log("No COPYCOW_MINT in .env — run  npm run devnet:setup  first.");
  process.exit(1);
}
const to = new PublicKey(walletArg);
const amount = BigInt(Math.round(Number(amountArg) * 1e6));
const conn = connection();
const agent = loadOrCreateWallet(openDb()).keypair;
const mint = new PublicKey(config.copycowMint);
const from = await getOrCreateAssociatedTokenAccount(conn, agent, mint, agent.publicKey);
const dest = await getOrCreateAssociatedTokenAccount(conn, agent, mint, to);
const sig = await transfer(conn, agent, from.address, dest.address, agent, amount);
// A brand-new wallet needs a little SOL to exist; airdrops to it must cover rent anyway, so top it up slightly.
if ((await conn.getBalance(to)) === 0) {
  const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
  await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: to, lamports: 0.002 * LAMPORTS_PER_SOL })), [agent]);
}
console.log(`🐄 Sent ${Number(amountArg).toLocaleString()} test $COPYCOW to ${to.toBase58()}\n   https://solscan.io/tx/${sig}?cluster=devnet`);
process.exit(0);

export {};
