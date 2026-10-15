import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openDb, pendingDividendLamports } from "@copycow/shared";
import { buildQueue } from "../src/queue";
import { processSignals } from "../src/engine";

const wallet = () => Keypair.generate().publicKey.toBase58();
const t0 = "2026-01-01T00:00:00.000Z";

test("queue: higher tier first, then bigger holders; non-copy tiers excluded", () => {
  const q = buildQueue([
    { id: 1, wallet: "a", tier: "COW", token_balance: 20_000_000, max_size_sol: null, created_at: t0 },
    { id: 2, wallet: "b", tier: "MAD_COW", token_balance: 60_000_000, max_size_sol: 10, created_at: t0 },
    { id: 3, wallet: "c", tier: "COW", token_balance: 40_000_000, max_size_sol: 0.5, created_at: t0 },
    { id: 4, wallet: "d", tier: "HEIFER", token_balance: 5_000_000, max_size_sol: null, created_at: t0 },
  ]);
  assert.deepEqual(q.map((s) => s.subscriber.id), [2, 3, 1]);
  assert.equal(q[0].sizeSol, 5); // capped at MAD Cow max even though they asked for 10
  assert.equal(q[1].sizeSol, 0.5);
  assert.ok(q[0].delayMs < q[1].delayMs && q[1].delayMs < q[2].delayMs);
});

test("buy → sell copies, and the performance fee goes through the 10/90 split", () => {
  const db = openDb(":memory:");
  const sub = (tier: string, bal: number) =>
    db.prepare("INSERT INTO subscribers (wallet, tier, token_balance, balance_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)").run(wallet(), tier, bal, t0, t0);
  sub("MAD_COW", 60_000_000);
  sub("COW", 10_000_000);
  sub("CALF", 100_000);
  db.prepare(`INSERT INTO trades (mint, symbol, status, size_sol, size_usd, entry_price, entry_ts) VALUES ('MINT', 'MOO', 'open', 1, 150, 1, '2026-01-02T00:00:00.000Z')`).run();
  assert.deepEqual(processSignals(db, () => {}), { buys: 2, sells: 0 });
  assert.deepEqual(processSignals(db, () => {}), { buys: 0, sells: 0 }); // idempotent
  db.prepare("UPDATE trades SET status='closed', exit_price=1.03, exit_ts='2026-01-02T01:00:00.000Z', pnl_pct=3, pnl_sol=0.03").run();
  assert.deepEqual(processSignals(db, () => {}), { buys: 0, sells: 2 });
  // MAD Cow copied 5 SOL, COW 1 SOL → profits 0.15 + 0.03 SOL; 5% fee = 0.009 SOL; 10% of that to holders
  const fees = db.prepare("SELECT SUM(amount_lamports) a FROM fee_receipts WHERE source_type='copytrade_fee'").get() as { a: number };
  assert.equal(fees.a, 9_000_000);
  assert.equal(pendingDividendLamports(db), 900_000);
});
