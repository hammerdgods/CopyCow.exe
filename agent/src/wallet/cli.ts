/** `npm run wallet` — shows (or creates) COWBOT's wallet address and balance. */
import { openDb, setMeta } from "@copycow/shared";
import { loadOrCreateWallet, walletBalanceSol, walletFile } from "./wallet";

const db = openDb();
const { keypair, created } = loadOrCreateWallet(db);
console.log(created ? "🐄 New COWBOT wallet created!" : "🐄 COWBOT wallet:");
console.log(`   Address (public, safe to share): ${keypair.publicKey.toBase58()}`);
console.log(`   Secret key file (NEVER share):   ${walletFile()}`);
try {
  const bal = await walletBalanceSol(keypair.publicKey);
  setMeta(db, "wallet_balance_sol", bal);
  console.log(`   On-chain balance: ${bal} SOL`);
} catch (e) {
  console.log(`   (Couldn't read balance: ${(e as Error).message})`);
}
