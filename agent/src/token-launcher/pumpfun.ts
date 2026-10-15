/**
 * REAL pump.fun launches — only ever called when LAUNCH_MODE=real.
 *
 * pump.fun has no official public SDK for creating tokens from a server, so
 * we use the widely-used, documented workaround:
 *   1. upload image + metadata to pump.fun's IPFS endpoint
 *   2. ask PumpPortal (https://pumpportal.fun/creation) to BUILD the
 *      "create token + dev buy" transaction for our wallet
 *   3. sign it OURSELVES (keys never leave this machine) and send it
 *
 * The signer = COWBOT's agent wallet = the token CREATOR, so pump.fun's
 * creator fees accrue to the agent wallet's creator vault automatically.
 */
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config";
import { connection } from "../rpc";

export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export interface RealLaunchResult {
  mint: string;
  signature: string;
  metadataUri: string;
}

async function uploadMetadata(args: { name: string; ticker: string; description: string; imagePath: string }): Promise<string> {
  if (!args.imagePath.endsWith(".png")) throw new Error("pump.fun needs a PNG image (install sharp or set OPENAI_API_KEY)");
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(args.imagePath)], { type: "image/png" }), path.basename(args.imagePath));
  form.append("name", args.name);
  form.append("symbol", args.ticker);
  form.append("description", args.description);
  form.append("twitter", config.tokenSocialX);
  form.append("telegram", "");
  form.append("website", config.tokenWebsite);
  form.append("showName", "true");
  const res = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`pump.fun IPFS upload failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { metadataUri?: string };
  if (!json.metadataUri) throw new Error("pump.fun IPFS upload returned no metadataUri");
  return json.metadataUri;
}

async function buildAndSend(body: Record<string, unknown>, signers: Keypair[]): Promise<string> {
  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200) throw new Error(`PumpPortal error ${res.status}: ${await res.text().catch(() => "")}`);
  const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  tx.sign(signers);
  const conn = connection();
  const signature = await conn.sendTransaction(tx, { maxRetries: 3 });
  const latest = await conn.getLatestBlockhash();
  const conf = await conn.confirmTransaction({ signature, ...latest }, "confirmed");
  if (conf.value.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(conf.value.err)}`);
  return signature;
}

export async function launchOnPumpFun(
  agent: Keypair,
  args: { name: string; ticker: string; description: string; imagePath: string; buySol: number },
): Promise<RealLaunchResult> {
  const metadataUri = await uploadMetadata(args);
  const mint = Keypair.generate();
  const signature = await buildAndSend(
    {
      publicKey: agent.publicKey.toBase58(), // creator = agent wallet → creator fees go here
      action: "create",
      tokenMetadata: { name: args.name, symbol: args.ticker, uri: metadataUri },
      mint: mint.publicKey.toBase58(),
      denominatedInSol: "true",
      amount: args.buySol,
      slippage: config.launchSlippagePct,
      priorityFee: config.launchPriorityFeeSol,
      pool: "pump",
    },
    [mint, agent],
  );
  return { mint: mint.publicKey.toBase58(), signature, metadataUri };
}

/** pump.fun keeps each creator's unclaimed fees in a "creator vault" account. */
export function creatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export async function unclaimedCreatorFeesSol(creator: PublicKey): Promise<number> {
  const conn = connection();
  const vault = creatorVault(creator);
  const info = await conn.getAccountInfo(vault);
  if (!info) return 0;
  const rent = await conn.getMinimumBalanceForRentExemption(info.data.length);
  return Math.max(0, info.lamports - rent) / LAMPORTS_PER_SOL;
}

/** Claims ALL accumulated creator fees into the agent wallet. Returns lamports received. */
export async function claimCreatorFees(agent: Keypair): Promise<{ signature: string; receivedLamports: number }> {
  const signature = await buildAndSend(
    { publicKey: agent.publicKey.toBase58(), action: "collectCreatorFee", priorityFee: 0.000001, pool: "pump" },
    [agent],
  );
  const tx = await connection().getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const idx = tx?.transaction.message.staticAccountKeys.findIndex((k) => k.equals(agent.publicKey)) ?? -1;
  let received = 0;
  if (tx?.meta && idx >= 0) received = tx.meta.postBalances[idx] - tx.meta.preBalances[idx] + (idx === 0 ? tx.meta.fee : 0);
  return { signature, receivedLamports: Math.max(0, received) };
}
