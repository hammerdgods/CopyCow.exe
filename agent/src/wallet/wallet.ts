/**
 * PHASE 4 — COWBOT's own Solana wallet.
 * Created automatically the first time the agent runs and saved to
 * data/wallet/cowbot-keypair.json (same format as the Solana CLI).
 *
 * ⚠️ That file IS the wallet. Anyone with it controls the funds.
 *    It is git-ignored. Back it up somewhere safe and never share it.
 */
import fs from "node:fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { dataPath, type DB, envStr, setMeta } from "@copycow/shared";
import { connection } from "../rpc";

export function walletFile(): string {
  return envStr("AGENT_KEYPAIR_PATH") || dataPath("wallet", "cowbot-keypair.json");
}

export function loadOrCreateWallet(db?: DB): { keypair: Keypair; created: boolean } {
  const file = walletFile();
  let keypair: Keypair;
  let created = false;
  if (fs.existsSync(file)) {
    keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
  } else {
    keypair = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
    created = true;
  }
  if (db) {
    setMeta(db, "wallet_pubkey", keypair.publicKey.toBase58());
    if (created) setMeta(db, "wallet_created_at", new Date().toISOString());
  }
  return { keypair, created };
}

export async function walletBalanceSol(pubkey: PublicKey): Promise<number> {
  return (await connection().getBalance(pubkey)) / LAMPORTS_PER_SOL;
}
