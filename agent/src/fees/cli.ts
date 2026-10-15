/** `npm run fees` — check/claim creator rewards once and print who gets what. */
import { LAMPORTS_PER_SOL, openDb, owedToTeamLamports } from "@copycow/shared";
import { attachLogDb } from "../log";
import { pollFees } from "./tracker";

const db = openDb();
attachLogDb(db);
await pollFees(db);
const t = db.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(agent_lamports),0) g, COALESCE(SUM(team_lamports),0) t FROM fee_receipts WHERE source_type='copycow_reward'").get() as { a: number; g: number; t: number };
const c = db.prepare("SELECT COALESCE(SUM(amount_lamports),0) a FROM fee_receipts WHERE source_type='launch_reward'").get() as { a: number };
const sol = (l: number) => (l / LAMPORTS_PER_SOL).toFixed(6);
console.log(`\n$COPYCOW creator rewards: ${sol(t.a)} SOL → COWBOT ${sol(t.g)} (10%) / team ${sol(t.t)} (90%)`);
console.log(`Launched-coin creator rewards: ${sol(c.a)} SOL → 100% to each coin's holders`);
console.log(`Team share not yet sent: ${sol(owedToTeamLamports(db))} SOL`);
