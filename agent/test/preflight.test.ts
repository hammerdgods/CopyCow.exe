import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConfig, type ConfigLike, worst } from "../src/cli/preflight-checks";

const good: ConfigLike = {
  copyMode: "real", copyBudgetSol: 1, copyMinTradeSol: 0.01, copyMaxTradeSol: 0.1, maxPositions: 5, dailyLossLimitSol: 0.5,
  walletReserveSol: 0.05, stopLossPct: 35, takeProfitPct: 300, slippageBps: 300, priorityFeeMaxLamports: 1_000_000,
  rugCheckEnabled: true, heliusApiKey: "k", solanaRpcUrl: "", grpcUrl: "https://grpc",
};
const levels = (c: ConfigLike, bal: number | null) => checkConfig(c, bal).filter((f) => f.level !== "ok").map((f) => `${f.level}:${f.check}`);

test("preflight: a sensible real-mode config with a funded wallet is GO (only the real-money warning)", () => {
  assert.deepEqual(levels(good, 1.2), ["warn:copy mode"]);
  assert.equal(worst(checkConfig(good, 1.2)), "warn");
});

test("preflight: paper mode needs no balance and has no warnings", () => {
  assert.equal(worst(checkConfig({ ...good, copyMode: "paper" }, 0)), "ok");
  assert.equal(worst(checkConfig({ ...good, copyMode: "paper" }, null)), "warn"); // unreadable balance is only a warning in paper mode
});

test("preflight: fails when the budget exceeds what the wallet can fund", () => {
  assert.ok(levels(good, 0.5).includes("fail:wallet balance"));
  assert.ok(levels(good, 1.04).includes("fail:wallet balance")); // 1.04 − 0.05 reserve < 1 budget
  assert.ok(levels(good, 0.05).includes("fail:wallet balance")); // nothing left after the reserve
  assert.ok(levels(good, null).includes("fail:wallet balance"));
});

test("preflight: warns about surplus SOL that no limit protects", () => {
  assert.ok(levels(good, 5).includes("warn:surplus SOL"));
  assert.ok(!levels(good, 1.2).includes("warn:surplus SOL"));
});

test("preflight: fails on limits that would silently disable a protection", () => {
  assert.ok(levels({ ...good, dailyLossLimitSol: 0 }, 2).includes("fail:limits set"));
  assert.ok(levels({ ...good, copyBudgetSol: -1 }, 2).includes("fail:limits set"));
  assert.ok(levels({ ...good, dailyLossLimitSol: 2 }, 3).includes("fail:daily loss limit"));
  assert.ok(levels({ ...good, copyMaxTradeSol: 2 }, 3).includes("fail:trade size"));
  assert.ok(levels({ ...good, copyMinTradeSol: 0.5, copyMaxTradeSol: 0.1 }, 2).includes("fail:trade size"));
  assert.ok(levels({ ...good, stopLossPct: 0 }, 2).includes("fail:stop-loss"));
  assert.ok(levels({ ...good, stopLossPct: 150 }, 2).includes("fail:stop-loss"));
  assert.ok(levels({ ...good, takeProfitPct: 0 }, 2).includes("fail:take-profit"));
});

test("preflight: slippage, priority fee, rug checks, RPC and stream", () => {
  assert.ok(levels({ ...good, slippageBps: 1500 }, 2).includes("fail:slippage"));
  assert.ok(levels({ ...good, slippageBps: 800 }, 2).includes("warn:slippage"));
  assert.ok(levels({ ...good, priorityFeeMaxLamports: 10_000_000 }, 2).includes("warn:priority fee"));
  assert.ok(levels({ ...good, rugCheckEnabled: false }, 2).includes("fail:rug checks"));
  assert.ok(levels({ ...good, rugCheckEnabled: false, copyMode: "paper" }, 2).includes("warn:rug checks"));
  assert.ok(levels({ ...good, heliusApiKey: "" }, 2).includes("warn:RPC"));
  assert.ok(levels({ ...good, grpcUrl: "" }, 2).includes("warn:live stream"));
  assert.ok(levels({ ...good, maxPositions: 20 }, 2).includes("warn:position count"));
});
