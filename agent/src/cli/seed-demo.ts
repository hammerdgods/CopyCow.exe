/**
 * `npm run seed:demo` — fills a SEPARATE database (data/demo.db) with
 * clearly-labelled sample data so you can preview the dashboard before
 * COWBOT has weeks of real paper trades. It never touches data/copycow.db.
 *
 * Preview it with:  COPYCOW_DB_PATH=data/demo.db npm run dashboard
 */
import fs from "node:fs";
import path from "node:path";
import {
  airdropLeaf, buildMerkleTree, commitProof, LAMPORTS_PER_SOL, nowIso, openDb, recordCopycowReward, recordCopytradeFee, recordLaunchReward, repoRoot, setMeta,
} from "@copycow/shared";
import { Keypair } from "@solana/web3.js";

const file = path.join(repoRoot(), "data", "demo.db");
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const db = openDb(file);

// Deterministic pseudo-random numbers so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const symbols = ["SOL", "JUP", "BONK", "WIF", "POPCAT", "RAY", "PENGU", "JTO", "PYTH", "FARTCOIN"];
const day = 86_400_000;
const start = Date.now() - 45 * day;

setMeta(db, "demo_data", "1");
setMeta(db, "wallet_pubkey", Keypair.generate().publicKey.toBase58());
setMeta(db, "launch_mode", "paper");
setMeta(db, "trading_mode", "paper");
setMeta(db, "paper_starting_capital_sol", 100);

const insertTrade = db.prepare(
  `INSERT INTO trades (mint, symbol, status, mode, size_sol, size_usd, entry_price, entry_ts, entry_reason, entry_fill_source,
     momentum_15m_pct, volume_pace, exit_price, exit_ts, exit_reason, exit_fill_source, last_price, last_price_ts, pnl_pct, pnl_sol, entry_proof_id, exit_proof_id)
   VALUES (?, ?, ?, 'paper', 1, 150, ?, ?, ?, 'demo', ?, ?, ?, ?, ?, 'demo', ?, ?, ?, ?, ?, ?)`,
);
let t = start;
while (t < Date.now() - 2 * 3_600_000) {
  t += (2 + rand() * 10) * 3_600_000;
  const sym = symbols[Math.floor(rand() * symbols.length)];
  const entry = 0.5 + rand() * 100;
  const win = rand() < 0.62;
  const pnlPct = win ? 3 + rand() * 0.4 : -(1.5 + rand() * 0.3);
  const exitTs = new Date(Math.min(t + (20 + rand() * 180) * 60_000, Date.now() - 60_000)).toISOString();
  const entryTs = new Date(t).toISOString();
  const m15 = 1 + rand() * 4;
  const p1 = commitProof(db, "trade_entry", { mode: "paper", symbol: sym, side: "buy", size_sol: 1, signal_price_usd: entry, demo: true });
  const p2 = commitProof(db, "trade_exit", { mode: "paper", symbol: sym, side: "sell", entry_price_usd: entry, demo: true });
  const exit = entry * (1 + pnlPct / 100);
  insertTrade.run(`DEMO${sym}`, sym, "closed", entry, entryTs, `15m ${m15.toFixed(2)}% · vol pace ${(1 + rand() * 2).toFixed(2)}x`, m15, 1.5,
    exit, exitTs, win ? "take_profit" : "stop_loss", exit, exitTs, pnlPct, pnlPct / 100, p1.id, p2.id);
}
for (const sym of ["JUP", "WIF"]) {
  const entry = 1 + rand();
  const p = commitProof(db, "trade_entry", { mode: "paper", symbol: sym, side: "buy", size_sol: 1, signal_price_usd: entry, demo: true });
  insertTrade.run(`DEMO${sym}`, sym, "open", entry, new Date(Date.now() - 40 * 60_000).toISOString(), "15m 1.8% · vol pace 1.9x", 1.8, 1.9,
    null, null, null, entry * (1 + (rand() - 0.4) / 50), nowIso(), null, null, p.id, null);
}

// Launched tokens + creator fees
const trends = ["moodeng2", "catwifcow", "grassfed", "hamsterhat"];
trends.forEach((term, i) => {
  const at = new Date(Date.now() - (30 - i * 7) * day).toISOString();
  const scan = db.prepare("INSERT INTO trend_scans (started_at, finished_at, sources, terms_seen, qualified) VALUES (?, ?, '[\"dexscreener\",\"geckoterminal\"]', 40, 1)").run(at, at).lastInsertRowid;
  const tr = db.prepare(`INSERT INTO trends (scan_id, term, score, mention_count, velocity_ratio, memeable, solana_adjacent, large_cap, qualified, sources, sample_posts, status, detected_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, 0, 1, '{"dexscreener":4,"geckoterminal":2}', '["DEMO sample post"]', 'launched', ?)`).run(scan, term, 78 + i * 3, 6 + i, 9 + i * 2, at).lastInsertRowid;
  const p = commitProof(db, "token_launch", { mode: "paper", trend_term: term, demo: true });
  const id = Number(db.prepare(`INSERT INTO launched_tokens (trend_id, trend_term, name, ticker, description, mode, status, launch_buy_sol, proof_id, launched_at)
    VALUES (?, ?, ?, ?, 'DEMO token', 'paper', 'paper_launched', 0.5, ?, ?)`).run(tr, term, term[0].toUpperCase() + term.slice(1), term.toUpperCase().slice(0, 8), p.id, at).lastInsertRowid);
  for (let d = 0; d < 7; d++) recordLaunchReward(db, { sourceRef: `$${term.toUpperCase().slice(0, 8)}`, launchedTokenId: id, amountLamports: Math.round((0.05 + rand() * 0.3) * LAMPORTS_PER_SOL), simulated: true, note: "DEMO" });
  // COWBOT's launch buy, sold at 2x or after 24h
  const win = rand() < 0.5;
  const pnlPct = win ? 100 : -(20 + rand() * 50);
  const exitTs = new Date(new Date(at).getTime() + (win ? 6 : 24) * 3_600_000).toISOString();
  db.prepare(`INSERT INTO trades (mint, symbol, kind, launched_token_id, status, mode, size_sol, size_usd, entry_price, entry_ts, entry_reason, exit_price, exit_ts, exit_reason, pnl_pct, pnl_sol)
    VALUES (?, ?, 'launch', ?, 'closed', 'paper', 0.5, 75, 1, ?, 'DEMO launch buy', ?, ?, ?, ?, ?)`)
    .run(`DEMO${term}`, term.toUpperCase().slice(0, 8), id, at, 1 + pnlPct / 100, exitTs, win ? "launch_take_profit" : "launch_time_exit", pnlPct, 0.5 * pnlPct / 100);
});
for (let d = 0; d < 20; d++) recordCopycowReward(db, { sourceRef: "$COPYCOW", amountLamports: Math.round((0.2 + rand() * 1.2) * LAMPORTS_PER_SOL), simulated: true, note: "DEMO" });
for (let i = 0; i < 12; i++) recordCopytradeFee(db, { sourceRef: `trade:${i}`, amountLamports: 1 + Math.round(rand() * 0.02 * LAMPORTS_PER_SOL), simulated: true, note: "DEMO" });

// Past airdrops
for (let e = 1; e <= 4; e++) {
  const wallets = Array.from({ length: 40 + e * 15 }, () => Keypair.generate().publicKey.toBase58());
  const amounts = wallets.map(() => BigInt(Math.round((0.001 + rand() * 0.004) * LAMPORTS_PER_SOL)));
  const tree = buildMerkleTree(wallets.map((w, i) => airdropLeaf(BigInt(e), { index: i, wallet: w, amountLamports: amounts[i] })));
  const total = amounts.reduce((a, b) => a + b, 0n);
  const end = new Date(Date.now() - (29 - e * 7) * day).toISOString();
  const p = commitProof(db, "airdrop_epoch", { mode: "paper", epoch_index: e, merkle_root: tree.root.toString("hex"), demo: true });
  db.prepare(`INSERT INTO airdrop_epochs (epoch_index, kind, merkle_epoch, period_end, mode, status, pool_lamports, trading_pnl_lamports, total_lamports, wallets_paid, merkle_root, snapshot_slot, tx_signatures, proof_id, notes, created_at)
    VALUES (?, 'cowbot_profit', ?, ?, 'paper', 'paper', ?, ?, ?, ?, ?, ?, '[]', ?, 'DEMO', ?)`).run(e, e, end, Number(total), Number(total), Number(total), wallets.length, tree.root.toString("hex"), 300_000_000 + e * 1_500_000, p.id, end);
}
const msgs = ["Moo-ving into JUP — 15m 1.80% · vol pace 1.90x", "Fresh grass: took profit on BONK at +3.12% (+0.0312 SOL)", "Rut: stopped out of WIF at -1.52%. No revenge trades — cooling off.", "Grazing complete: 2/2 positions green."];
msgs.forEach((m, i) => db.prepare("INSERT INTO agent_log (ts, level, message) VALUES (?, ?, ?)").run(new Date(Date.now() - (4 - i) * 60_000).toISOString(), "info", `[DEMO] ${m}`));
setMeta(db, "heartbeat", nowIso());
setMeta(db, "agent_status", "live");
console.log(`🐄 Demo data written to ${file}\n   Preview: COPYCOW_DB_PATH=data/demo.db npm run dashboard`);
