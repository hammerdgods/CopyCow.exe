import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_SHARE_BPS, TEAM_SHARE_BPS } from "../src/constants";
import { splitCreatorReward, recordCopycowReward, recordLaunchReward, recordCopytradeFee, airdropPreview, owedToTeamLamports, owedToOthersLamports, pendingCoinRewards, markTeamShareSent } from "../src/split";
import { openDb } from "../src/db";
import { commitProof, verifyProofChain, type ProofEntry } from "../src/proof";
import { airdropLeaf, buildMerkleTree, verifyMerkleProof } from "../src/merkle";
import { tierForBalance } from "../src/tiers";
import { equityCurve, maxDrawdown, winRate } from "../src/stats";

test("FOUNDER RULE: COWBOT keeps exactly 10% of creator rewards and never more", () => {
  assert.equal(AGENT_SHARE_BPS, 1000);
  assert.equal(TEAM_SHARE_BPS, 9000);
  for (const amt of [1n, 9n, 10n, 999n, 1_000_000_001n, 123_456_789_012n]) {
    const { agent, team } = splitCreatorReward(amt);
    assert.equal(agent + team, amt);
    assert.ok(agent * 10n <= amt, "COWBOT never above 10%");
  }
  assert.deepEqual(splitCreatorReward(1_000_000_000n), { agent: 100_000_000n, team: 900_000_000n });
});

test("$COPYCOW creator rewards: team share tracked until sent; never enters the airdrop pool", () => {
  const db = openDb(":memory:");
  const r = recordCopycowReward(db, { amountLamports: 2_000_000_000, simulated: false });
  assert.equal(r.team, 1_800_000_000);
  assert.equal(owedToTeamLamports(db), 1_800_000_000);
  markTeamShareSent(db, [r.id], "sig");
  assert.equal(owedToTeamLamports(db), 0);
  assert.equal(airdropPreview(db, "real").poolLamports, 0);
});

test("launched-coin rewards: 100% for that coin's holders, never COWBOT's money", () => {
  const db = openDb(":memory:");
  const id = Number(db.prepare("INSERT INTO launched_tokens (trend_term,name,ticker,description,mode,status,mint,launch_buy_sol,launched_at) VALUES ('moo','Moo','MOO','x','real','launched','MINT',0.5,'t')").run().lastInsertRowid);
  recordLaunchReward(db, { launchedTokenId: id, amountLamports: 400_000_000, simulated: false });
  assert.deepEqual(pendingCoinRewards(db, false), [{ launched_token_id: id, ticker: "MOO", mint: "MINT", lamports: 400_000_000 }]);
  assert.equal(owedToOthersLamports(db), 400_000_000);
  assert.equal(airdropPreview(db, "real").poolLamports, 0); // not part of the $COPYCOW profit airdrop
});

test("airdrop pool = trading profit since last paid airdrop (losses made back first) + copytrade fees", () => {
  const db = openDb(":memory:");
  const closed = (pnl: number, ts: string) =>
    db.prepare("INSERT INTO trades (mint, symbol, status, size_sol, size_usd, entry_price, entry_ts, exit_ts, pnl_sol, pnl_pct) VALUES ('m','T','closed',1,1,1,?,?,?,0)")
      .run(ts, ts, pnl);
  closed(-0.5, "2026-01-01T00:00:00.000Z"); // a losing week (momentum trading)
  assert.equal(airdropPreview(db, "paper").poolLamports, 0);
  closed(0.8, "2026-01-08T00:00:00.000Z"); // next week: +0.8, but 0.5 must be made back
  recordCopytradeFee(db, { sourceRef: "t", amountLamports: 10_000_000, simulated: true });
  db.prepare("INSERT INTO trades (mint, symbol, kind, status, size_sol, size_usd, entry_price, entry_ts, exit_ts, pnl_sol, pnl_pct) VALUES ('m','LAUNCH','launch','closed',0.5,1,1,?,?,0.25,50)")
    .run("2026-01-08T01:00:00.000Z", "2026-01-08T01:00:00.000Z"); // sold a launch buy for +0.25
  const p = airdropPreview(db, "paper");
  assert.equal(p.tradingPnlLamports, 300_000_000);
  assert.equal(p.launchPnlLamports, 250_000_000);
  assert.equal(p.poolLamports, 560_000_000);
  // after a paid airdrop, only newer trades count
  db.prepare("INSERT INTO airdrop_epochs (epoch_index, kind, period_end, mode, status, pool_lamports, total_lamports, wallets_paid, created_at) VALUES (1, 'cowbot_profit', '2026-01-09T00:00:00.000Z', 'paper', 'paper', 1, 1, 1, 'x')").run();
  closed(0.1, "2026-01-10T00:00:00.000Z");
  assert.equal(airdropPreview(db, "paper").tradingPnlLamports, 100_000_000);
});

test("proof chain detects tampering", () => {
  const db = openDb(":memory:");
  commitProof(db, "entry", { symbol: "SOL", price: 100 });
  commitProof(db, "exit", { symbol: "SOL", price: 103 });
  const rows = db.prepare("SELECT * FROM proof_ledger ORDER BY id").all() as ProofEntry[];
  assert.equal(verifyProofChain(rows).ok, true);
  rows[0].payload = rows[0].payload.replace("100", "99");
  assert.deepEqual(verifyProofChain(rows), { ok: false, checked: 2, brokenAtId: rows[0].id });
});

test("merkle proofs verify for every leaf", () => {
  const wallets = [
    "So11111111111111111111111111111111111111112",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ];
  const leaves = wallets.map((w, i) => airdropLeaf(3n, { index: i, wallet: w, amountLamports: BigInt(1000 * (i + 1)) }));
  const tree = buildMerkleTree(leaves);
  leaves.forEach((l, i) => assert.ok(verifyMerkleProof(l, tree.proofs[i], tree.root)));
  assert.equal(verifyMerkleProof(leaves[0], tree.proofs[1], tree.root), false);
});

test("tiers", () => {
  assert.equal(tierForBalance(99_999).id, "NONE");
  assert.equal(tierForBalance(100_000).id, "CALF");
  assert.equal(tierForBalance(1_000_000).id, "HEIFER");
  assert.equal(tierForBalance(10_000_000).id, "COW");
  assert.equal(tierForBalance(50_000_000).id, "MAD_COW");
});

test("stats", () => {
  const trades = [
    { exit_ts: "2026-01-01T00:00:00Z", pnl_sol: 1, pnl_pct: 3 },
    { exit_ts: "2026-01-02T00:00:00Z", pnl_sol: -2, pnl_pct: -1.5 },
    { exit_ts: "2026-01-03T00:00:00Z", pnl_sol: 0.5, pnl_pct: 3 },
  ];
  assert.equal(winRate(trades)!.toFixed(2), "66.67");
  const curve = equityCurve(trades, 100);
  assert.equal(curve.at(-1)!.equity, 99.5);
  const dd = maxDrawdown(curve, 100);
  assert.equal(dd.maxDrawdownSol, -2);
});
