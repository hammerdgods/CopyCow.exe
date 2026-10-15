import { test } from "node:test";
import assert from "node:assert/strict";
import { HOLDER_FEE_BPS, TREASURY_FEE_BPS } from "../src/constants";
import { splitFee, recordFeeReceipt, pendingDividendLamports } from "../src/split";
import { openDb } from "../src/db";
import { commitProof, verifyProofChain, type ProofEntry } from "../src/proof";
import { airdropLeaf, buildMerkleTree, verifyMerkleProof } from "../src/merkle";
import { tierForBalance } from "../src/tiers";
import { equityCurve, maxDrawdown, winRate } from "../src/stats";

test("FOUNDER RULE: holder share is exactly 10% and never more", () => {
  assert.equal(HOLDER_FEE_BPS, 1000);
  assert.equal(TREASURY_FEE_BPS, 9000);
  for (const amt of [1n, 9n, 10n, 999n, 1_000_000_001n, 123_456_789_012n]) {
    const { holders, treasury } = splitFee(amt);
    assert.equal(holders + treasury, amt);
    assert.ok(holders * 10n <= amt, "holders never above 10%");
  }
  assert.deepEqual(splitFee(1_000_000_000n), { holders: 100_000_000n, treasury: 900_000_000n });
});

test("fee receipts accumulate in the dividend pool", () => {
  const db = openDb(":memory:");
  recordFeeReceipt(db, { sourceType: "creator_fee", amountLamports: 2_000_000_000, simulated: true });
  recordFeeReceipt(db, { sourceType: "copytrade_fee", amountLamports: 500_000_000, simulated: true });
  assert.equal(pendingDividendLamports(db), 250_000_000);
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
