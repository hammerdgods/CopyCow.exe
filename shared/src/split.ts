/**
 * MONEY IN — who gets what.
 *
 * $COPYCOW creator rewards (pump.fun):
 *   10% → COWBOT (trading capital)   — hard-coded, rounds DOWN, never more
 *   90% → team wallet (marketing)    — sent straight away, untouched by COWBOT
 *
 * Creator rewards of a coin COWBOT LAUNCHED:
 *   100% → that coin's holders, airdropped daily.
 *
 * COWBOT's PROFIT (momentum trading + selling its launch buys) + copytrade fees:
 *   100% → $COPYCOW holders, airdropped weekly by holdings. A losing week pays
 *   nothing; losses are made back first so COWBOT's capital never shrinks.
 *
 * Math is in whole lamports (1 SOL = 1,000,000,000 lamports).
 */
import { AGENT_SHARE_BPS, BPS_DENOMINATOR, LAMPORTS_PER_SOL } from "./constants";
import { type DB, nowIso } from "./db";

export function splitCreatorReward(amountLamports: number | bigint): { agent: bigint; team: bigint } {
  const total = BigInt(amountLamports);
  if (total < 0n) throw new Error("amount cannot be negative");
  const agent = (total * BigInt(AGENT_SHARE_BPS)) / BigInt(BPS_DENOMINATOR);
  return { agent, team: total - agent };
}

export interface RewardInput {
  sourceRef?: string | null;
  amountLamports: number;
  simulated: boolean;
  txSignature?: string | null;
  note?: string | null;
}

/**
 * Records $COPYCOW creator rewards, split 10/90. The team's 90% starts as
 * "pending" (real) or "simulated" (paper); markTeamShareSent() once the
 * transfer to the team wallet has landed.
 */
export function recordCopycowReward(db: DB, input: RewardInput): { id: number; agent: number; team: number } {
  const amount = Math.floor(input.amountLamports);
  if (amount <= 0) throw new Error("reward amount must be positive");
  const { agent, team } = splitCreatorReward(amount);
  const ts = nowIso();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO fee_receipts (source_type, source_ref, amount_lamports, agent_lamports, team_lamports,
           holder_lamports, team_status, simulated, tx_signature, note, received_at)
         VALUES ('copycow_reward', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(input.sourceRef ?? "$COPYCOW", amount, Number(agent), Number(team),
        input.simulated ? "simulated" : "pending", input.simulated ? 1 : 0, input.txSignature ?? null, input.note ?? null, ts);
    // Only COWBOT's 10% joins its capital.
    db.prepare("INSERT INTO treasury_ledger (ts, kind, amount_lamports, ref, simulated) VALUES (?, 'reward_in', ?, ?, ?)").run(
      ts, Number(agent), `fee_receipt:${info.lastInsertRowid}`, input.simulated ? 1 : 0);
    return Number(info.lastInsertRowid);
  });
  return { id: tx(), agent: Number(agent), team: Number(team) };
}

/** Records creator rewards of a coin COWBOT launched — 100% for that coin's holders. */
export function recordLaunchReward(db: DB, input: RewardInput & { launchedTokenId: number }): number {
  const amount = Math.floor(input.amountLamports);
  if (amount <= 0) throw new Error("reward amount must be positive");
  return Number(
    db
      .prepare(
        `INSERT INTO fee_receipts (source_type, source_ref, launched_token_id, amount_lamports, agent_lamports, team_lamports,
           holder_lamports, team_status, simulated, tx_signature, note, received_at)
         VALUES ('launch_reward', ?, ?, ?, 0, 0, ?, 'n/a', ?, ?, ?, ?)`,
      )
      .run(input.sourceRef ?? null, input.launchedTokenId, amount, amount, input.simulated ? 1 : 0, input.txSignature ?? null, input.note ?? null, nowIso())
      .lastInsertRowid,
  );
}

/** Copytrade performance fees → $COPYCOW holders' weekly airdrop. */
export function recordCopytradeFee(db: DB, input: { sourceRef: string; amountLamports: number; simulated: boolean; note?: string }): number {
  const amount = Math.floor(input.amountLamports);
  if (amount <= 0) throw new Error("fee amount must be positive");
  return Number(
    db
      .prepare(
        `INSERT INTO fee_receipts (source_type, source_ref, amount_lamports, agent_lamports, team_lamports, holder_lamports,
           team_status, simulated, note, received_at)
         VALUES ('copytrade_fee', ?, ?, 0, 0, ?, 'n/a', ?, ?, ?)`,
      )
      .run(input.sourceRef, amount, amount, input.simulated ? 1 : 0, input.note ?? null, nowIso()).lastInsertRowid,
  );
}

export function markTeamShareSent(db: DB, receiptIds: number[], signature: string): void {
  const upd = db.prepare("UPDATE fee_receipts SET team_status='sent', team_tx_signature=? WHERE id=?");
  db.transaction(() => receiptIds.forEach((id) => upd.run(signature, id)))();
}

/** Real SOL sitting in COWBOT's wallet that belongs to the team (should be ~0). */
export function owedToTeamLamports(db: DB): number {
  return (db.prepare("SELECT COALESCE(SUM(team_lamports),0) s FROM fee_receipts WHERE team_status='pending'").get() as { s: number }).s;
}

/** Launched-coin rewards waiting for their daily airdrop, per coin. */
export function pendingCoinRewards(db: DB, simulated: boolean): { launched_token_id: number; ticker: string; mint: string | null; lamports: number }[] {
  return db
    .prepare(
      `SELECT f.launched_token_id, lt.ticker, lt.mint, SUM(f.holder_lamports) AS lamports
         FROM fee_receipts f JOIN launched_tokens lt ON lt.id = f.launched_token_id
        WHERE f.source_type='launch_reward' AND f.airdrop_epoch_id IS NULL AND f.simulated = ?
        GROUP BY f.launched_token_id HAVING lamports > 0`,
    )
    .all(simulated ? 1 : 0) as { launched_token_id: number; ticker: string; mint: string | null; lamports: number }[];
}

export interface AirdropPreview {
  mode: "paper" | "real";
  /** End of the last profit airdrop that actually paid out (null = never). */
  periodStart: string | null;
  /** Realized profit since then: momentum trading + selling launch buys. Losing weeks stay in here until made back. */
  tradingPnlLamports: number;
  launchPnlLamports: number;
  profitShareLamports: number;
  copytradeFeesLamports: number;
  poolLamports: number;
}

/** Airdrops that actually paid (or simulated paying) holders. */
export const PAID_EPOCH_STATUSES = "('paper','deposit_pending','pending','ready','published','partial','completed')";

/**
 * What the NEXT weekly $COPYCOW-holder airdrop would pay right now:
 * ALL of COWBOT's realized profit since the last paid profit airdrop
 * (trading + launch sales; only if positive) + copytrade fees.
 */
export function airdropPreview(db: DB, mode: "paper" | "real"): AirdropPreview {
  const last = db
    .prepare(`SELECT MAX(period_end) AS p FROM airdrop_epochs WHERE mode = ? AND kind = 'cowbot_profit' AND status IN ${PAID_EPOCH_STATUSES}`)
    .get(mode) as { p: string | null };
  const pnl = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind='launch' THEN 0 ELSE pnl_sol END),0) t, COALESCE(SUM(CASE WHEN kind='launch' THEN pnl_sol ELSE 0 END),0) l
         FROM trades WHERE status='closed' AND mode=? AND (? IS NULL OR exit_ts > ?)`,
    )
    .get(mode, last.p, last.p) as { t: number; l: number };
  const tradingPnlLamports = Math.round(pnl.t * LAMPORTS_PER_SOL);
  const launchPnlLamports = Math.round(pnl.l * LAMPORTS_PER_SOL);
  const fees = (
    db
      .prepare("SELECT COALESCE(SUM(holder_lamports),0) s FROM fee_receipts WHERE source_type='copytrade_fee' AND airdrop_epoch_id IS NULL AND simulated = ?")
      .get(mode === "paper" ? 1 : 0) as { s: number }
  ).s;
  const profitShare = Math.max(0, tradingPnlLamports + launchPnlLamports);
  return {
    mode, periodStart: last.p, tradingPnlLamports, launchPnlLamports, profitShareLamports: profitShare,
    copytradeFeesLamports: fees, poolLamports: profitShare + fees,
  };
}

/**
 * Real SOL in COWBOT's wallet that belongs to OTHER people right now: the
 * team's unsent 90%, launched-coin rewards waiting for their daily airdrop,
 * and this week's profit waiting for the $COPYCOW airdrop. COWBOT must never
 * spend it.
 */
export function owedToOthersLamports(db: DB): number {
  const coin = pendingCoinRewards(db, false).reduce((s, r) => s + r.lamports, 0);
  return owedToTeamLamports(db) + coin + airdropPreview(db, "real").poolLamports;
}
