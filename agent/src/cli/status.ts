/** `npm run status` — a quick health check of COWBOT from the database. */
import { airdropPreview, getMeta, HEARTBEAT_STALE_MINUTES, LAMPORTS_PER_SOL, openDb, owedToTeamLamports, pendingCoinRewards, winRate } from "@copycow/shared";

const db = openDb();
const hb = getMeta(db, "heartbeat");
const ageMin = hb ? (Date.now() - new Date(hb).getTime()) / 60_000 : Infinity;
const live = ageMin < HEARTBEAT_STALE_MINUTES && getMeta(db, "agent_status") === "live";
const closed = db.prepare("SELECT pnl_sol FROM trades WHERE status='closed' AND kind='momentum'").all() as { pnl_sol: number }[];
const open = db.prepare("SELECT symbol, entry_price, last_price FROM trades WHERE status='open' AND kind='momentum'").all() as { symbol: string; entry_price: number; last_price: number }[];
const launches = db.prepare("SELECT COUNT(*) n FROM trades WHERE status='open' AND kind='launch'").get() as { n: number };
const wr = winRate(closed);
console.log(`🐄 COWBOT is ${live ? "LIVE 🟢" : "OFFLINE 🔴"} (last heartbeat ${hb ?? "never"})`);
console.log(`   Wallet: ${getMeta(db, "wallet_pubkey") ?? "not created yet (run npm run wallet)"}`);
console.log(`   Closed trades: ${closed.length} · win rate ${wr === null ? "—" : wr.toFixed(1) + "%"} · P&L ${closed.reduce((s, t) => s + t.pnl_sol, 0).toFixed(4)} SOL`);
console.log(`   Open: ${open.map((o) => `${o.symbol} ${(((o.last_price ?? o.entry_price) / o.entry_price - 1) * 100).toFixed(2)}%`).join(", ") || "none"}`);
console.log(`   Launch buys still held: ${launches.n}`);
console.log(`   Next $COPYCOW airdrop (all COWBOT profit): ${(airdropPreview(db, "paper").poolLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL (paper)`);
const coins = pendingCoinRewards(db, false);
if (coins.length) console.log(`   Waiting for launched-coin holders: ${coins.map((c) => `$${c.ticker} ${(c.lamports / LAMPORTS_PER_SOL).toFixed(5)}`).join(", ")}`);
const owed = owedToTeamLamports(db);
if (owed > 0) console.log(`   ⚠️  Team share waiting to be sent: ${(owed / LAMPORTS_PER_SOL).toFixed(6)} SOL (check TEAM_WALLET)`);
