import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, SOL_MINT } from "@godseye/shared";
import type { ParsedSwap } from "../src/chain/parse";
import type { Executor, Fill } from "../src/copy/executor";
import type { PriceQuote } from "../src/market/prices";
import { MINT } from "./helpers";

// A throwaway project root, so the PAUSE-file test never touches the real data/ folder.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "godseye-test-"));
fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "godseye" }));
process.env.GODSEYE_ROOT = root;
process.env.RUG_CHECK_ENABLED = "false";
process.env.COPY_BUDGET_SOL = "1";
process.env.COPY_MAX_TRADE_SOL = "0.1";
process.env.COPY_MAX_POSITIONS = "3";
process.env.COPY_DAILY_LOSS_LIMIT_SOL = "0.5";
process.env.COPY_STOP_LOSS_PCT = "35";
process.env.COPY_TAKE_PROFIT_PCT = "300";
process.env.COPY_MAX_HOLD_HOURS = "48";
const { CopyEngine, isPaused } = await import("../src/copy/engine");

class FakeExecutor implements Executor {
  mode = "paper" as const;
  calls: string[] = [];
  failBuy = false;
  failSell = false;
  async buy(_mint: string, sol: number): Promise<Fill> {
    if (this.failBuy) throw new Error("jupiter down");
    this.calls.push(`buy ${sol}`);
    return { signature: null, solAmount: sol, tokenAmount: sol * 1000, priceSol: 0.001 };
  }
  async sell(_mint: string, tokens: number): Promise<Fill> {
    if (this.failSell) throw new Error("no route");
    this.calls.push(`sell ${tokens}`);
    return { signature: null, solAmount: tokens * 0.001, tokenAmount: tokens, priceSol: 0.001 };
  }
}

const SOL_USD = 100;
/** Prices where the token is worth `priceSol` SOL (1 SOL = $100). `null` = no price available. */
const pricesAt = (priceSol: number | null) => async (): Promise<Map<string, PriceQuote>> => {
  const m = new Map<string, PriceQuote>([[SOL_MINT, { priceUsd: SOL_USD, source: "jupiter" }]]);
  if (priceSol !== null) m.set(MINT, { priceUsd: priceSol * SOL_USD, source: "jupiter" });
  return m;
};

function setup(weight = 0.5, priceFn: () => Promise<Map<string, PriceQuote>> = pricesAt(0.001)) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO wallets (address, first_seen_at, discovered_via, copy_weight) VALUES ('LEADER', ?, 'test', ?)").run(new Date().toISOString(), weight);
  db.prepare("INSERT INTO token_info (mint, symbol, decimals, pool_created_at, checked_at) VALUES (?, 'MOO', 6, '2026-01-01T00:00:00Z', ?)").run(MINT, new Date().toISOString());
  const ex = new FakeExecutor();
  return { db, ex, engine: new CopyEngine(db, ex, null, priceFn as never) };
}

const leaderSwap = (p: Partial<ParsedSwap>): ParsedSwap => ({
  wallet: "LEADER", signature: `sig${Math.random()}`, slot: 1, ts: new Date().toISOString(), mint: MINT, side: "buy",
  tokenAmount: 1000, tokenBalanceBefore: 0, solAmount: 1, priceSol: 0.001, venue: "jupiter", jitoTip: false, feeLamports: 5000, ...p,
});

/** Inserts a position directly. */
function seedPosition(db: ReturnType<typeof openDb>, p: { mint?: string; status?: "open" | "closed"; cost?: number; pnl?: number; openedAt?: string; closedAt?: string; tokens?: number }): void {
  const tokens = p.tokens ?? 100;
  db.prepare(
    `INSERT INTO positions (mint, symbol, leader, mode, status, token_amount, tokens_bought, cost_sol, entry_price_sol, last_price_sol, opened_at, closed_at, pnl_sol)
     VALUES (?, 'X', 'LEADER', 'paper', ?, ?, ?, ?, 0.001, 0.001, ?, ?, ?)`,
  ).run(p.mint ?? MINT, p.status ?? "open", p.status === "closed" ? 0 : tokens, tokens, p.cost ?? 0.1, p.openedAt ?? new Date().toISOString(), p.closedAt ?? null, p.pnl ?? null);
}

const lastSkip = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT status, reason FROM copy_trades ORDER BY id DESC LIMIT 1").get() as { status: string; reason: string });

test("limits: the daily loss limit blocks new buys; yesterday's losses don't count", async () => {
  const { db, ex, engine } = setup();
  seedPosition(db, { status: "closed", mint: "OLD", pnl: -5, closedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 1, "old loss ignored");

  const t = setup();
  seedPosition(t.db, { status: "closed", mint: "TODAY", pnl: -0.5, closedAt: new Date().toISOString() });
  await t.engine.onLeaderSwap(leaderSwap({}));
  assert.equal(t.ex.calls.length, 0);
  assert.match(lastSkip(t.db).reason, /daily loss limit reached/);
});

test("limits: the daily loss limit counts realized losses only (documented behaviour)", async () => {
  const { db, ex, engine } = setup();
  seedPosition(db, { mint: "UNDERWATER", cost: 0.9 }); // open, deep in the red — not realized
  db.prepare("UPDATE positions SET last_price_sol = 0.0001").run();
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 1);
});

test("limits: no more than COPY_MAX_POSITIONS open positions", async () => {
  const { db, ex, engine } = setup();
  for (const m of ["A", "B", "C"]) seedPosition(db, { mint: m, cost: 0.01 });
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 0);
  assert.match(lastSkip(db).reason, /already at 3 open positions/);
});

test("limits: the budget shrinks the trade, then blocks it", async () => {
  const { db, ex, engine } = setup(1); // weight 1 → wants the 0.1 max
  seedPosition(db, { mint: "A", cost: 0.95 }); // 0.05 SOL of budget left
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 1);
  assert.ok(Math.abs(Number(ex.calls[0].split(" ")[1]) - 0.05) < 1e-9, ex.calls[0]);

  const t = setup(1);
  seedPosition(t.db, { mint: "A", cost: 0.999 }); // 0.001 left, below the 0.01 minimum trade
  await t.engine.onLeaderSwap(leaderSwap({}));
  assert.equal(t.ex.calls.length, 0);
  assert.match(lastSkip(t.db).reason, /copy budget fully in use/);
});

test("limits: a partly sold position only holds the budget for what is left", async () => {
  const { db, ex, engine } = setup(1);
  seedPosition(db, { mint: "A", cost: 0.9, tokens: 100 });
  db.prepare("UPDATE positions SET token_amount = 10").run(); // 90% sold → 0.09 SOL still in use
  await engine.onLeaderSwap(leaderSwap({}));
  assert.deepEqual(ex.calls, ["buy 0.1"]);
});

test("limits: a token already held is never bought twice", async () => {
  const { ex, engine } = setup();
  await engine.onLeaderSwap(leaderSwap({}));
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 1);
});

test("limits: the data/PAUSE file pauses copying, and removing it resumes", async () => {
  const { db, ex, engine } = setup();
  const file = path.join(root, "data", "PAUSE");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  assert.equal(isPaused(db), true);
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 0);
  assert.match(lastSkip(db).reason, /paused/);

  fs.rmSync(file);
  assert.equal(isPaused(db), false);
  await engine.onLeaderSwap(leaderSwap({}));
  assert.equal(ex.calls.length, 1);
});

test("limits: pausing still lets the engine follow the leader out (sells keep working)", async () => {
  const { db, ex, engine } = setup();
  await engine.onLeaderSwap(leaderSwap({}));
  db.prepare("INSERT INTO agent_meta (key, value, updated_at) VALUES ('copy_paused', '1', '')").run();
  await engine.onLeaderSwap(leaderSwap({ side: "sell", tokenAmount: 1000, tokenBalanceBefore: 1000 }));
  assert.equal(ex.calls.length, 2);
  assert.equal((db.prepare("SELECT status FROM positions").get() as { status: string }).status, "closed");
});

test("limits: a failed buy is recorded, opens nothing and leaves the budget untouched", async () => {
  const { db, ex, engine } = setup();
  ex.failBuy = true;
  await engine.onLeaderSwap(leaderSwap({}));
  const row = db.prepare("SELECT status, error FROM copy_trades").get() as { status: string; error: string };
  assert.equal(row.status, "failed");
  assert.match(row.error, /jupiter down/);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM positions").get() as { n: number }).n, 0);
  ex.failBuy = false;
  await engine.onLeaderSwap(leaderSwap({}));
  assert.deepEqual(ex.calls, ["buy 0.1"]);
});

test("exits: stop-loss sells everything", async () => {
  const { db, ex, engine } = setup(0.5, pricesAt(0.00064)); // −36% vs 0.001 entry
  await engine.onLeaderSwap(leaderSwap({}));
  await engine.managePositions();
  assert.equal(ex.calls.length, 2);
  const pos = db.prepare("SELECT status, exit_reason, pnl_sol FROM positions").get() as { status: string; exit_reason: string; pnl_sol: number };
  assert.equal(pos.status, "closed");
  assert.match(pos.exit_reason, /stop-loss/);
});

test("exits: take-profit sells everything", async () => {
  const { db, engine } = setup(0.5, pricesAt(0.004)); // +300%
  await engine.onLeaderSwap(leaderSwap({}));
  await engine.managePositions();
  assert.match((db.prepare("SELECT exit_reason r FROM positions").get() as { r: string }).r, /take-profit/);
});

test("exits: max-hold sells a position the leader never sold", async () => {
  const { db, engine } = setup();
  await engine.onLeaderSwap(leaderSwap({}));
  db.prepare("UPDATE positions SET opened_at = ?").run(new Date(Date.now() - 49 * 3_600_000).toISOString());
  await engine.managePositions();
  assert.match((db.prepare("SELECT exit_reason r FROM positions").get() as { r: string }).r, /held 48h/);
});

test("exits: nothing happens inside the stop/take range, or when no price is available", async () => {
  for (const priceFn of [pricesAt(0.0008), pricesAt(0.003), pricesAt(null)]) {
    const { db, ex, engine } = setup(0.5, priceFn);
    await engine.onLeaderSwap(leaderSwap({}));
    await engine.managePositions();
    assert.equal(ex.calls.length, 1, "only the buy");
    assert.equal((db.prepare("SELECT status FROM positions").get() as { status: string }).status, "open");
  }
});

test("exits: a failed exit is retried later, not hammered every minute", async () => {
  const { db, ex, engine } = setup(0.5, pricesAt(0.0005));
  await engine.onLeaderSwap(leaderSwap({}));
  ex.failSell = true;
  await engine.managePositions(); // fails, backs off 2 minutes
  await engine.managePositions(); // inside the back-off window: no second attempt
  const failed = db.prepare("SELECT COUNT(*) n FROM copy_trades WHERE side='sell' AND status='failed'").get() as { n: number };
  assert.equal(failed.n, 1);
  assert.equal((db.prepare("SELECT status FROM positions").get() as { status: string }).status, "open");
});

test("proof: every executed decision is committed to the ledger before it runs", async () => {
  const { db, engine } = setup(0.5, pricesAt(0.0005));
  await engine.onLeaderSwap(leaderSwap({})); // copy_buy
  await engine.managePositions(); // copy_sell (stop-loss)
  const kinds = (db.prepare("SELECT kind FROM proof_ledger ORDER BY id").all() as { kind: string }[]).map((r) => r.kind);
  assert.deepEqual(kinds, ["copy_buy", "copy_sell"]);
});
