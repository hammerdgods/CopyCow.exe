/**
 * The 10/90 fee splitter. Every fee that comes in (pump.fun creator fees
 * and copytrade performance fees) goes through here:
 *   10% → holder dividend pool (airdropped weekly)
 *   90% → treasury (reinvested)
 * Math is done in whole lamports (1 SOL = 1,000,000,000 lamports) and
 * rounds DOWN for holders, so holders can never receive more than 10%.
 */
import { BPS_DENOMINATOR, HOLDER_FEE_BPS } from "./constants";
import { type DB, nowIso } from "./db";

export function splitFee(amountLamports: number | bigint): { holders: bigint; treasury: bigint } {
  const total = BigInt(amountLamports);
  if (total < 0n) throw new Error("fee amount cannot be negative");
  const holders = (total * BigInt(HOLDER_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  return { holders, treasury: total - holders };
}

export interface FeeReceiptInput {
  sourceType: "creator_fee" | "copytrade_fee";
  sourceRef?: string | null;
  launchedTokenId?: number | null;
  amountLamports: number;
  simulated: boolean;
  txSignature?: string | null;
  note?: string | null;
}

/** Records a fee, splits it 10/90, and books the 90% into the treasury ledger. */
export function recordFeeReceipt(db: DB, input: FeeReceiptInput): { id: number; holders: number; treasury: number } {
  const amount = Math.floor(input.amountLamports);
  if (amount <= 0) throw new Error("fee amount must be positive");
  const { holders, treasury } = splitFee(amount);
  const ts = nowIso();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO fee_receipts (source_type, source_ref, launched_token_id, amount_lamports, holder_lamports,
           treasury_lamports, simulated, tx_signature, note, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sourceType,
        input.sourceRef ?? null,
        input.launchedTokenId ?? null,
        amount,
        Number(holders),
        Number(treasury),
        input.simulated ? 1 : 0,
        input.txSignature ?? null,
        input.note ?? null,
        ts,
      );
    db.prepare(
      "INSERT INTO treasury_ledger (ts, kind, amount_lamports, ref, simulated) VALUES (?, 'fee_in', ?, ?, ?)",
    ).run(ts, Number(treasury), `fee_receipt:${info.lastInsertRowid}`, input.simulated ? 1 : 0);
    return Number(info.lastInsertRowid);
  });
  return { id: tx(), holders: Number(holders), treasury: Number(treasury) };
}

/** SOL waiting in the holder dividend pool for the next weekly airdrop. */
export function pendingDividendLamports(db: DB, simulated?: boolean): number {
  const where = simulated === undefined ? "" : ` AND simulated = ${simulated ? 1 : 0}`;
  const row = db
    .prepare(`SELECT COALESCE(SUM(holder_lamports),0) AS s FROM fee_receipts WHERE airdrop_epoch_id IS NULL${where}`)
    .get() as { s: number };
  return row.s;
}
