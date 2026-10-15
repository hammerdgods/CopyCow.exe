/**
 * Talks to the on-chain DIVIDEND AIRDROP contract (REAL mode only).
 *   • depositToDividendContract: after claiming creator fees, send exactly
 *     10% into the contract vault (the contract itself enforces the 10%).
 *   • publishAndPushEpoch: publish the weekly Merkle root, then push SOL to
 *     every holder in batches. COWBOT's wallet is the relayer and pays the fees.
 * If DIVIDEND_PROGRAM_ID isn't set yet, these skip with a clear TODO and the
 * holder share stays tracked in the database (nothing is lost).
 */
import anchor, { type Idl, type Program as ProgramT } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { airdropLeaf, buildMerkleTree, type DB, nowIso } from "@copycow/shared";
import { config } from "../config";
import { say } from "../log";
import { connection } from "../rpc";
import { loadOrCreateWallet } from "../wallet/wallet";
import idlJson from "./idl/dividend_airdrop.json" with { type: "json" };

// Anchor ships as CommonJS; pull the classes off the default export.
const { AnchorProvider, BN, Program, Wallet } = anchor;
type Program = ProgramT;

const BATCH_SIZE = Math.max(1, Number(process.env.AIRDROP_BATCH_SIZE ?? 3));

function program(db: DB): Program | null {
  if (!config.dividendProgramId) return null;
  const agent = loadOrCreateWallet(db).keypair;
  const provider = new AnchorProvider(connection(), new Wallet(agent), { commitment: "confirmed" });
  const idl = { ...(idlJson as Idl), address: config.dividendProgramId };
  return new Program(idl, provider);
}

const epochPda = (programId: PublicKey, index: number) =>
  PublicKey.findProgramAddressSync([Buffer.from("epoch"), new BN(index).toArrayLike(Buffer, "le", 8)], programId)[0];

/** The epoch number the contract will assign next (Merkle leaves must use it). */
export async function nextOnchainEpoch(db: DB): Promise<number | null> {
  const prog = program(db);
  if (!prog) return null;
  const [distributor] = PublicKey.findProgramAddressSync([Buffer.from("distributor")], prog.programId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await (prog.account as any).distributor.fetch(distributor);
  return Number(d.currentEpoch) + 1;
}

export async function depositToDividendContract(db: DB, grossLamports: number, ref: string): Promise<void> {
  if (config.launchMode !== "real") return;
  const prog = program(db);
  if (!prog) {
    say("warn", "TODO: DIVIDEND_PROGRAM_ID not set — the holders' 10% is tracked in the database and stays in the agent wallet until the contract is deployed.");
    return;
  }
  const agent = loadOrCreateWallet(db).keypair;
  const sig = await prog.methods
    .depositFromTreasury(new BN(grossLamports), { creatorFee: {} })
    .accounts({ treasury: agent.publicKey })
    .rpc();
  say("fee", `Deposited the holders' 10% of ${grossLamports / 1e9} SOL into the dividend contract (tx ${sig}, ref ${ref.slice(0, 12)}…)`);
}

interface EpochRow {
  id: number;
  merkle_epoch: number;
  merkle_root: string;
  total_lamports: number;
  wallets_paid: number;
  snapshot_slot: number;
  status: string;
  tx_signatures: string;
}
interface PayoutRow {
  id: number;
  leaf_index: number;
  wallet: string;
  amount_lamports: number;
  proof: string;
}

export async function publishAndPushEpoch(db: DB, epochId: number): Promise<void> {
  const prog = program(db);
  const epoch = db.prepare("SELECT * FROM airdrop_epochs WHERE id=?").get(epochId) as EpochRow;
  if (!prog) {
    db.prepare("UPDATE airdrop_epochs SET status='ready', notes=? WHERE id=?").run(
      "TODO: deploy the dividend contract and set DIVIDEND_PROGRAM_ID, then run `npm run airdrop -- --resume`", epochId);
    say("warn", "Airdrop is computed but the dividend contract isn't configured (DIVIDEND_PROGRAM_ID). Saved — run `npm run airdrop -- --resume` after deploying.");
    return;
  }
  const agent = loadOrCreateWallet(db).keypair;
  const sigs: string[] = JSON.parse(epoch.tx_signatures);

  if (epoch.status === "pending" || epoch.status === "ready") {
    // Merkle leaves include the contract's epoch number — make sure it still matches.
    const next = (await nextOnchainEpoch(db))!;
    if (next !== epoch.merkle_epoch) rebuildTree(db, epochId, next);
    Object.assign(epoch, db.prepare("SELECT * FROM airdrop_epochs WHERE id=?").get(epochId));
    const sig = await prog.methods
      .distribute(Array.from(Buffer.from(epoch.merkle_root, "hex")), new BN(epoch.total_lamports), epoch.wallets_paid, new BN(epoch.snapshot_slot))
      .accounts({ relayer: agent.publicKey, epoch: epochPda(prog.programId, epoch.merkle_epoch) })
      .rpc();
    sigs.push(sig);
    db.prepare("UPDATE airdrop_epochs SET status='published', tx_signatures=? WHERE id=?").run(JSON.stringify(sigs), epochId);
    say("fee", `Published airdrop root on-chain (epoch ${epoch.merkle_epoch}, tx ${sig})`);
  }

  const pending = db.prepare("SELECT * FROM airdrop_payouts WHERE epoch_id=? AND status='pending' ORDER BY leaf_index").all(epochId) as PayoutRow[];
  let size = BATCH_SIZE;
  for (let i = 0; i < pending.length; ) {
    const batch = pending.slice(i, i + size);
    try {
      const sig = await prog.methods
        .pushPayouts(
          new BN(epoch.merkle_epoch),
          batch.map((p) => ({ index: p.leaf_index, amount: new BN(p.amount_lamports), proof: (JSON.parse(p.proof) as string[]).map((h) => Array.from(Buffer.from(h, "hex"))) })),
        )
        .accounts({ relayer: agent.publicKey, epoch: epochPda(prog.programId, epoch.merkle_epoch) })
        .remainingAccounts(batch.map((p) => ({ pubkey: new PublicKey(p.wallet), isSigner: false, isWritable: true })))
        .rpc();
      const mark = db.prepare("UPDATE airdrop_payouts SET status='paid', tx_signature=? WHERE id=?");
      for (const p of batch) mark.run(sig, p.id);
      sigs.push(sig);
      i += batch.length;
    } catch (e) {
      // Transaction too big for long proofs? Retry one at a time.
      if (size > 1 && /too large|exceeded|encoding overruns/i.test(String((e as Error).message))) {
        size = 1;
        continue;
      }
      say("error", `Airdrop batch failed (${(e as Error).message.slice(0, 160)}). Re-run with \`npm run airdrop -- --resume\`.`);
      break;
    }
  }
  const left = (db.prepare("SELECT COUNT(*) AS n FROM airdrop_payouts WHERE epoch_id=? AND status='pending'").get(epochId) as { n: number }).n;
  db.prepare("UPDATE airdrop_epochs SET status=?, tx_signatures=?, notes=? WHERE id=?").run(
    left === 0 ? "completed" : "partial", JSON.stringify(sigs), left === 0 ? `completed ${nowIso()}` : `${left} payouts still pending`, epochId);
  if (left === 0) say("fee", `🐄 Airdrop epoch ${epoch.merkle_epoch} complete: SOL pushed to ${epoch.wallets_paid} wallets. Nobody had to click claim.`);
}

function rebuildTree(db: DB, epochId: number, merkleEpoch: number): void {
  const rows = db.prepare("SELECT * FROM airdrop_payouts WHERE epoch_id=? ORDER BY leaf_index").all(epochId) as PayoutRow[];
  const leaves = rows.map((p) => airdropLeaf(BigInt(merkleEpoch), { index: p.leaf_index, wallet: p.wallet, amountLamports: BigInt(p.amount_lamports) }));
  const tree = buildMerkleTree(leaves);
  db.transaction(() => {
    const upd = db.prepare("UPDATE airdrop_payouts SET proof=? WHERE id=?");
    rows.forEach((p, i) => upd.run(JSON.stringify(tree.proofs[i].map((b) => b.toString("hex"))), p.id));
    db.prepare("UPDATE airdrop_epochs SET merkle_epoch=?, merkle_root=? WHERE id=?").run(merkleEpoch, tree.root.toString("hex"), epochId);
  })();
}

/** Finish any airdrop that was interrupted. */
export async function resumeAirdrops(db: DB): Promise<void> {
  const rows = db.prepare("SELECT id FROM airdrop_epochs WHERE mode='real' AND status IN ('pending','ready','published','partial') ORDER BY id").all() as { id: number }[];
  for (const r of rows) await publishAndPushEpoch(db, r.id);
}
