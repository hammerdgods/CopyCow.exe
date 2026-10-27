/**
 * The pure part of `npm run preflight`: judges GodsEye's settings against the
 * wallet balance. No network, no files, so it is unit-tested.
 */
export type Level = "ok" | "warn" | "fail";

export interface Finding {
  level: Level;
  check: string;
  detail: string;
}

export interface ConfigLike {
  copyMode: "real" | "paper";
  copyBudgetSol: number;
  copyMinTradeSol: number;
  copyMaxTradeSol: number;
  maxPositions: number;
  dailyLossLimitSol: number;
  walletReserveSol: number;
  stopLossPct: number;
  takeProfitPct: number;
  slippageBps: number;
  priorityFeeMaxLamports: number;
  rugCheckEnabled: boolean;
  heliusApiKey: string;
  solanaRpcUrl: string;
  grpcUrl: string;
}

/** Balance far above budget + reserve is money no limit protects. */
const SURPLUS_FACTOR = 1.5;

export function checkConfig(c: ConfigLike, balanceSol: number | null): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, check: string, detail: string) => out.push({ level, check, detail });
  const real = c.copyMode === "real";

  add(real ? "warn" : "ok", "copy mode", real ? "COPY_MODE=real — copy trades spend REAL SOL" : "COPY_MODE=paper — nothing is sent");

  const positive: [string, number][] = [
    ["COPY_BUDGET_SOL", c.copyBudgetSol], ["COPY_MAX_TRADE_SOL", c.copyMaxTradeSol], ["COPY_MIN_TRADE_SOL", c.copyMinTradeSol],
    ["COPY_MAX_POSITIONS", c.maxPositions], ["COPY_DAILY_LOSS_LIMIT_SOL", c.dailyLossLimitSol],
  ];
  const bad = positive.filter(([, v]) => !(v > 0));
  if (bad.length) add("fail", "limits set", `${bad.map(([n]) => n).join(", ")} must be above 0 (a zero/negative limit disables its protection)`);

  if (c.copyMaxTradeSol > c.copyBudgetSol) add("fail", "trade size", `COPY_MAX_TRADE_SOL (${c.copyMaxTradeSol}) is above COPY_BUDGET_SOL (${c.copyBudgetSol})`);
  else if (c.copyMinTradeSol > c.copyMaxTradeSol) add("fail", "trade size", `COPY_MIN_TRADE_SOL (${c.copyMinTradeSol}) is above COPY_MAX_TRADE_SOL (${c.copyMaxTradeSol}) — nothing could ever be copied`);
  else add("ok", "trade size", `${c.copyMinTradeSol}–${c.copyMaxTradeSol} SOL per trade, ${c.copyBudgetSol} SOL budget`);

  if (c.maxPositions * c.copyMaxTradeSol > c.copyBudgetSol) add("warn", "position count", `${c.maxPositions} positions × ${c.copyMaxTradeSol} SOL exceeds the ${c.copyBudgetSol} SOL budget, so the budget (not the position cap) will be the limit`);
  if (c.dailyLossLimitSol > c.copyBudgetSol) add("fail", "daily loss limit", `COPY_DAILY_LOSS_LIMIT_SOL (${c.dailyLossLimitSol}) is above the whole budget (${c.copyBudgetSol}), so it can never stop anything`);
  else add("ok", "daily loss limit", `stops new buys after ${c.dailyLossLimitSol} SOL realized loss in a UTC day (unrealized losses don't count)`);

  if (!(c.stopLossPct > 0 && c.stopLossPct <= 100)) add("fail", "stop-loss", `COPY_STOP_LOSS_PCT=${c.stopLossPct} must be between 0 and 100`);
  else if (c.takeProfitPct <= 0) add("fail", "take-profit", `COPY_TAKE_PROFIT_PCT=${c.takeProfitPct} must be above 0`);
  else add("ok", "exits", `stop-loss ${c.stopLossPct}%, take-profit ${c.takeProfitPct}%`);

  if (c.slippageBps > 1000) add("fail", "slippage", `COPY_SLIPPAGE_BPS=${c.slippageBps} allows more than 10% slippage`);
  else if (c.slippageBps > 500) add("warn", "slippage", `COPY_SLIPPAGE_BPS=${c.slippageBps} allows more than 5% slippage`);
  else add("ok", "slippage", `${c.slippageBps} bps`);

  if (c.priorityFeeMaxLamports > 5_000_000) add("warn", "priority fee", `PRIORITY_FEE_MAX_LAMPORTS=${c.priorityFeeMaxLamports} is above 0.005 SOL per transaction`);
  if (!c.rugCheckEnabled) add(real ? "fail" : "warn", "rug checks", "RUG_CHECK_ENABLED=false — tokens are copied without any rug check");

  if (balanceSol === null) add(real ? "fail" : "warn", "wallet balance", "couldn't read the wallet balance");
  else if (real) {
    const usable = balanceSol - c.walletReserveSol;
    if (usable < c.copyMinTradeSol) add("fail", "wallet balance", `${balanceSol.toFixed(4)} SOL minus ${c.walletReserveSol} reserve leaves ${Math.max(0, usable).toFixed(4)} SOL — below one minimum trade`);
    else if (c.copyBudgetSol > usable) add("fail", "wallet balance", `COPY_BUDGET_SOL (${c.copyBudgetSol}) is more than the wallet can fund (${usable.toFixed(4)} SOL after the ${c.walletReserveSol} reserve)`);
    else add("ok", "wallet balance", `${balanceSol.toFixed(4)} SOL covers the ${c.copyBudgetSol} SOL budget + ${c.walletReserveSol} reserve`);
    if (balanceSol > (c.copyBudgetSol + c.walletReserveSol) * SURPLUS_FACTOR) {
      add("warn", "surplus SOL", `${(balanceSol - c.copyBudgetSol - c.walletReserveSol).toFixed(3)} SOL sits above budget + reserve in the same hot wallet; no limit protects it. Move it to a separate wallet`);
    }
  } else add("ok", "wallet balance", `${balanceSol.toFixed(4)} SOL (not used in paper mode)`);

  if (!c.solanaRpcUrl && !c.heliusApiKey) add("warn", "RPC", "using the public Solana RPC: slow, rate-limited, and often refuses history reads. Set HELIUS_API_KEY or SOLANA_RPC_URL");
  if (!c.grpcUrl) add("warn", "live stream", "GRPC_URL is empty: leaders are followed by websocket + polling, so copies arrive later");
  return out;
}

export const worst = (findings: Finding[]): Level => (findings.some((f) => f.level === "fail") ? "fail" : findings.some((f) => f.level === "warn") ? "warn" : "ok");
