import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { openDb, recordCopycowReward, recordLaunchReward, owedToTeamLamports, MAX_LAUNCHES_PER_24H } from "@copycow/shared";
import { config } from "../src/config";
import { evaluateEntry, evaluateExit } from "../src/strategy/momentum";
import type { PoolInfo } from "../src/market/geckoterminal";
import { duplicateTickers, isTradeablePool } from "../src/market/universe";
import { isBlockedTerm, isMemeable, normalizeTerm, termsFromText } from "../src/trend-scanner/extract";
import { believableVolumeUsd } from "../src/fees/tracker";
import { aggregate, scoreTerm } from "../src/trend-scanner/score";
import { xBudgetStatus } from "../src/trend-scanner/sources/x";
import { makeTokenIdentity } from "../src/token-launcher/naming";
import { checkLaunchSafety } from "../src/token-launcher/safety";
import { planPayouts } from "../src/airdrop/epoch";
import { dailyStats, recapPost } from "../src/recap/daily";
import { manageLaunchPositions } from "../src/token-launcher/positions";
import { airdropPreview } from "@copycow/shared";

const pool = (over: Partial<PoolInfo> = {}): PoolInfo => ({
  mint: "M1", symbol: "MOO", quoteSymbol: "SOL", poolAddress: "P", dex: "raydium", priceUsd: 2,
  change: { m5: 0.3, m15: 2, m30: 3, h1: 4, h6: 5, h24: 6 },
  volume: { m5: 1, m15: 1, h1: 200_000, h6: 1, h24: 2_400_000 },
  liquidityUsd: 1_000_000, fdvUsd: 10_000_000, buyers24h: 2000, txM15: { buys: 60, sells: 40 }, poolAgeHours: 500, ...over,
});
const ctx = { heldMints: new Set<string>(), cooldownUntil: new Map<string, number>(), now: Date.now() };

test("enters on momentum + volume", () => {
  const s = evaluateEntry(pool(), config, ctx);
  assert.equal(s.enter, true, s.reason);
});

test("no FOMO: skips a parabolic 15m move", () => {
  const s = evaluateEntry(pool({ change: { m5: 3, m15: 15, m30: 20, h1: 25, h6: 30, h24: 40 } }), config, ctx);
  assert.equal(s.enter, false);
  assert.equal(s.fomo, true);
});

test("no revenge trades: respects cooldown after a loss", () => {
  const s = evaluateEntry(pool(), config, { ...ctx, cooldownUntil: new Map([["M1", Date.now() + 60_000]]) });
  assert.equal(s.enter, false);
});

test("needs volume confirmation", () => {
  const s = evaluateEntry(pool({ volume: { m5: 1, m15: 1, h1: 10_000, h6: 1, h24: 2_400_000 } }), config, ctx);
  assert.equal(s.enter, false);
});

test("exits at +3% / -1.5% / time", () => {
  const now = Date.now();
  const ts = new Date(now - 10 * 60_000).toISOString();
  assert.equal(evaluateExit(100, 103.01, ts, config, now).reason, "take_profit");
  assert.equal(evaluateExit(100, 98.5, ts, config, now).reason, "stop_loss");
  assert.equal(evaluateExit(100, 100.5, ts, config, now).exit, false);
  assert.equal(evaluateExit(100, 100.5, new Date(now - 999 * 60_000).toISOString(), config, now).reason, "time_exit");
});

test("pasture filter blocks scams and stables", () => {
  assert.equal(isTradeablePool(pool({ symbol: "ՍЅᎠТ" })).ok, false);
  assert.equal(isTradeablePool(pool({ symbol: "USDC", priceUsd: 1 })).ok, false);
  assert.equal(isTradeablePool(pool({ buyers24h: 1 })).ok, false);
  assert.equal(isTradeablePool(pool()).ok, true);
});

test("pasture filter blocks fresh wash-traded relaunches", () => {
  // e.g. ALLOX: 8h-old pool, $1.7M market cap, $51M daily volume
  assert.equal(isTradeablePool(pool({ poolAgeHours: 8 })).ok, false);
  assert.equal(isTradeablePool(pool({ fdvUsd: 1_700_000, volume: { m5: 1, m15: 1, h1: 2e6, h6: 1, h24: 51e6 } })).ok, false);
  const dupes = duplicateTickers([pool({ mint: "A", symbol: "PULT" }), pool({ mint: "B", symbol: "PULT" }), pool({ mint: "C", symbol: "SOL" })]);
  assert.deepEqual([...dupes], ["PULT"]);
});

test("bad-word filter blocks offensive trends but not innocent words", () => {
  for (const w of ["rape", "r4pe", "hitlercat", "porncoin", "coon"]) assert.equal(isBlockedTerm(w), true, w);
  for (const w of ["grape", "raccoon", "spicy", "method", "grasscat"]) assert.equal(isBlockedTerm(w), false, w);
  assert.equal(isMemeable("rape"), false);
});

test("paper reward estimate ignores wash-traded volume", () => {
  const pairs = [{ chainId: "solana", baseToken: { address: "x", symbol: "PULT", name: "Pult" }, volume: { h24: 50_000_000 }, liquidity: { usd: 348_000 }, marketCap: 1_700_000 }];
  assert.equal(believableVolumeUsd(pairs, "pult"), 1_044_000); // capped at 3× liquidity, not $50M
});

test("trend term extraction + memeability", () => {
  assert.equal(normalizeTerm("$MooDeng"), "moodeng");
  assert.ok(termsFromText("new $GRASSCAT just dropped on pump.fun #cowcoin").includes("grasscat"));
  assert.equal(isMemeable("grasscat"), true);
  assert.equal(isMemeable("the"), false);
  assert.equal(isMemeable("xkcdqzt"), false);
});

test("trend qualifies only with spike + memeable + solana + not large-cap", () => {
  const opts = { velocitySpikePct: 500, minMentions: 3, largeCapFdvUsd: 50_000_000 };
  const stats = aggregate([
    { term: "grasscat", source: "dexscreener", weight: 2, solanaAdjacent: true, fdvUsd: 300_000 },
    { term: "grasscat", source: "x", weight: 2, solanaAdjacent: true },
  ]).get("grasscat")!;
  assert.equal(scoreTerm(stats, 0, opts).qualified, true); // brand new → spike
  assert.equal(scoreTerm(stats, 3, opts).qualified, false); // 4 vs 3 avg → no spike
  const big = aggregate([{ term: "bonk", source: "dexscreener", weight: 9, solanaAdjacent: true }]).get("bonk")!;
  assert.equal(scoreTerm(big, 0, opts).qualified, false);
});

test("X budget guard never exceeds the monthly read budget", () => {
  const db = openDb(":memory:");
  assert.equal(xBudgetStatus(db).allowed, true);
  db.prepare("INSERT INTO x_api_usage (ts, endpoint, posts_read, ok) VALUES (?, 'search/recent', ?, 1)").run(new Date().toISOString(), config.xMonthlyPostBudget);
  assert.equal(xBudgetStatus(db).allowed, false);
});

test("token identity: ticker ≤ 8 chars", () => {
  const id = makeTokenIdentity("supercalifragilistic");
  assert.ok(id.ticker.length <= 8 && id.ticker.length >= 3);
  assert.equal(makeTokenIdentity("ai").ticker, "AIMOO");
});

test("launch safety: max 1 launch per 24h (paper too)", async () => {
  const db = openDb(":memory:");
  assert.equal(MAX_LAUNCHES_PER_24H, 1);
  assert.equal((await checkLaunchSafety(db, "paper", "grasscat")).ok, true);
  db.prepare(`INSERT INTO launched_tokens (trend_term, name, ticker, description, mode, status, launch_buy_sol, launched_at)
    VALUES ('other', 'Other', 'OTHER', 'x', 'paper', 'paper_launched', 0.5, ?)`).run(new Date().toISOString());
  const r = await checkLaunchSafety(db, "paper", "grasscat");
  assert.equal(r.ok, false);
  assert.match(r.reason, /24h/);
});

test("launch safety: wallet floor", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO treasury_ledger (ts, kind, amount_lamports, ref, simulated) VALUES (?, 'adjustment', ?, 'test', 1)")
    .run(new Date().toISOString(), -Math.round((config.paperTreasuryStartSol - config.walletFloorSol) * 1e9));
  assert.match((await checkLaunchSafety(db, "paper", "grasscat")).reason, /floor/);
});

test("airdrop: holders below the minimum payout are dropped and their share re-split", () => {
  const w = () => Keypair.generate().publicKey.toBase58();
  const plan = planPayouts([{ wallet: w(), tokens: 9_900_000 }, { wallet: w(), tokens: 100_000 }], 50_000_000n, {
    minTokens: 100_000, minPayoutLamports: 1_000_000n, exclude: new Set(),
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].amountLamports, 50_000_000n); // the small holder's 0.0005 SOL went back into the pot
});

test("airdrop: pro-rata, min balance, excludes, never over the pool", () => {
  const w = () => Keypair.generate().publicKey.toBase58();
  const [a, b, c, lp] = [w(), w(), w(), w()];
  const plan = planPayouts(
    [{ wallet: a, tokens: 3_000_000 }, { wallet: b, tokens: 1_000_000 }, { wallet: c, tokens: 50_000 }, { wallet: lp, tokens: 500_000_000 }],
    1_000_000_000n,
    { minTokens: 100_000, minPayoutLamports: 1_000_000n, exclude: new Set([lp]) },
  );
  assert.equal(plan.length, 2);
  assert.equal(plan[0].amountLamports, 750_000_000n);
  assert.equal(plan[1].amountLamports, 250_000_000n);
  assert.ok(plan.reduce((s, p) => s + p.amountLamports, 0n) <= 1_000_000_000n);
});

test("daily recap format", () => {
  const db = openDb(":memory:");
  recordCopycowReward(db, { amountLamports: 1_000_000_000, simulated: true });
  const lt = Number(db.prepare("INSERT INTO launched_tokens (trend_term,name,ticker,description,mode,status,launch_buy_sol,launched_at) VALUES ('moo','Moo','MOO','x','paper','paper_launched',0.5,?)").run(new Date().toISOString()).lastInsertRowid);
  recordLaunchReward(db, { launchedTokenId: lt, amountLamports: 200_000_000, simulated: true });
  assert.equal(owedToTeamLamports(db), 0); // simulated rewards never count as owed real SOL
  const post = recapPost(dailyStats(db, new Date().toISOString().slice(0, 10)));
  assert.match(post, /^🐄 COWBOT\.exe Daily Report — \d{4}-\d{2}-\d{2}/);
  assert.match(post, /\$COPYCOW creator rewards: 1\.0000 SOL \(10% → COWBOT: 0\.1000 \| 90% → team: 0\.9000\)/);
  assert.match(post, /Launched-coin rewards → their holders: 0\.2000 SOL/);
  assert.match(post, /Next \$COPYCOW airdrop \(all profit\): 0\.0000 SOL/);
  assert.match(post, /Open positions: 0 \| Status: /);
});

test("launch buy with no reference market closes flat after 24h; its P&L joins the $COPYCOW airdrop pool", async () => {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO trades (mint, symbol, kind, status, mode, size_sol, size_usd, entry_price, entry_ts)
    VALUES ('paper:MOO', 'MOO', 'launch', 'open', 'paper', 0.5, 75, 1, ?)`).run(new Date(Date.now() - 25 * 3_600_000).toISOString());
  await manageLaunchPositions(db);
  const t = db.prepare("SELECT status, exit_reason, pnl_sol FROM trades").get() as { status: string; exit_reason: string; pnl_sol: number };
  assert.deepEqual(t, { status: "closed", exit_reason: "launch_time_exit", pnl_sol: 0 });
  db.prepare("UPDATE trades SET pnl_sol = 0.5").run(); // pretend it doubled
  assert.equal(airdropPreview(db, "paper").launchPnlLamports, 500_000_000);
});

test("rug check: blocks freeze/mint authority, permanent delegate, pausable, high risk score; warns on concentration", async () => {
  const { judgeRugRisk } = await import("../src/market/rugcheck");
  const opts = { blockMintAuthority: true, maxRiskScore: 75, allowlist: ["BRIDGED"] };
  const clean = { mintAuthority: null, freezeAuthority: null, extensions: [] };
  const ok = judgeRugRisk("A", clean, { score_normalised: 54, risks: [{ name: "Top 10 holders high ownership", level: "danger" }] }, opts);
  assert.equal(ok.verdict, "pass");
  assert.ok(ok.warnings[0].includes("Top 10 holders"));
  // SPCX-style token: freeze + mint + permanent delegate + pausable
  const spcx = judgeRugRisk("B", {
    mintAuthority: "x", freezeAuthority: "x",
    extensions: [{ extension: "permanentDelegate", state: { delegate: "x" } }, { extension: "pausableConfig", state: { authority: "x" } }],
  }, { score_normalised: 81, risks: [] }, opts);
  assert.equal(spcx.verdict, "blocked");
  assert.equal(spcx.blocks.length, 5);
  assert.equal(judgeRugRisk("C", { ...clean, mintAuthority: "x" }, null, opts).verdict, "blocked");
  assert.equal(judgeRugRisk("BRIDGED", { ...clean, mintAuthority: "x" }, { score_normalised: 71 }, opts).verdict, "pass"); // allowlisted
  assert.equal(judgeRugRisk("D", clean, { score_normalised: 10, risks: [{ name: "Rugged", level: "danger" }] }, opts).verdict, "blocked");
  assert.ok(judgeRugRisk("E", clean, null, opts).warnings.includes("RugCheck unavailable — on-chain checks only"));
});
