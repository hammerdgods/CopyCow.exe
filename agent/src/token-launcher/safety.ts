/**
 * LAUNCH SAFETY RULES (checked before EVERY launch, paper or real):
 *   1. Max 1 launch per 24 hours            — hard-coded (MAX_LAUNCHES_PER_24H)
 *   2. Total launch spend ≤ LAUNCH_TOTAL_BUDGET_SOL (default 5 SOL)
 *   3. Wallet must stay above WALLET_FLOOR_SOL after the launch
 *   4. Never launch the same trend twice in 7 days
 * Paper launches follow the same rules so the paper record is realistic.
 */
import { type DB, LAMPORTS_PER_SOL, MAX_LAUNCHES_PER_24H } from "@copycow/shared";
import { config } from "../config";
import { loadOrCreateWallet, walletBalanceSol } from "../wallet/wallet";

/** Rough cost of creating a token on top of the launch buy (rent + fees). */
export const LAUNCH_OVERHEAD_SOL = 0.03;

export async function availableBalanceSol(db: DB, mode: "paper" | "real"): Promise<number> {
  if (mode === "real") return walletBalanceSol(loadOrCreateWallet().keypair.publicKey);
  const row = db.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS s FROM treasury_ledger WHERE simulated = 1").get() as { s: number };
  return config.paperTreasuryStartSol + row.s / LAMPORTS_PER_SOL;
}

export async function checkLaunchSafety(db: DB, mode: "paper" | "real", term: string): Promise<{ ok: boolean; reason: string }> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const recent = (db.prepare("SELECT COUNT(*) AS n FROM launched_tokens WHERE mode=? AND launched_at >= ? AND status IN ('launched','paper_launched','pending')").get(mode, dayAgo) as { n: number }).n;
  if (recent >= MAX_LAUNCHES_PER_24H) return { ok: false, reason: `already launched ${recent} token in the last 24h (max ${MAX_LAUNCHES_PER_24H})` };

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const dupe = db.prepare("SELECT id FROM launched_tokens WHERE trend_term=? AND launched_at >= ?").get(term, weekAgo);
  if (dupe) return { ok: false, reason: `already rode "${term}" this week` };

  const spent = (db.prepare("SELECT COALESCE(SUM(launch_buy_sol),0) AS s FROM launched_tokens WHERE mode=? AND status IN ('launched','paper_launched','pending')").get(mode) as { s: number }).s;
  if (spent + config.launchBuySol > config.launchTotalBudgetSol) {
    return { ok: false, reason: `launch budget used up (${spent.toFixed(2)}/${config.launchTotalBudgetSol} SOL)` };
  }

  let balance: number;
  try {
    balance = await availableBalanceSol(db, mode);
  } catch (e) {
    return { ok: false, reason: `couldn't read wallet balance: ${(e as Error).message}` };
  }
  const after = balance - config.launchBuySol - LAUNCH_OVERHEAD_SOL;
  if (after < config.walletFloorSol) {
    return { ok: false, reason: `wallet would drop to ${after.toFixed(3)} SOL, below the ${config.walletFloorSol} SOL floor` };
  }
  return { ok: true, reason: `ok (balance ${balance.toFixed(3)} SOL, budget used ${spent.toFixed(2)}/${config.launchTotalBudgetSol})` };
}
