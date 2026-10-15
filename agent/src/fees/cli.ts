/** `npm run fees` — check/claim creator fees once and print the 10/90 totals. */
import { LAMPORTS_PER_SOL, openDb, pendingDividendLamports } from "@copycow/shared";
import { attachLogDb } from "../log";
import { pollFees } from "./tracker";

const db = openDb();
attachLogDb(db);
await pollFees(db);
const t = db.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(holder_lamports),0) h, COALESCE(SUM(treasury_lamports),0) t FROM fee_receipts").get() as { a: number; h: number; t: number };
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);
console.log(`\nAll-time fees: ${sol(t.a)} SOL → holders ${sol(t.h)} (10%) / treasury ${sol(t.t)} (90%)`);
console.log(`Waiting for next weekly airdrop: ${sol(pendingDividendLamports(db))} SOL`);
