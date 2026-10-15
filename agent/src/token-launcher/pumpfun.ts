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
/** PumpSwap: where pump.fun tokens trade after they "graduate". */
export const PUMPSWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export interface RealLaunchResult {
  mint: string;
  signature: string;
  metadataUri: string;
  /** Exact SOL that left COWBOT's wallet (dev buy + creation costs + fees). */
  costLamports: number;
  /** How many of the new coin COWBOT received from its first buy. */
  tokens: number;
}

/** How much COWBOT's SOL balance changed in a transaction (negative = spent). */
async function walletDelta(signature: string, wallet: PublicKey): Promise<{ net: number; fee: number }> {
  const tx = await connection().getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const idx = tx?.transaction.message.staticAccountKeys.findIndex((k) => k.equals(wallet)) ?? -1;
  if (!tx?.meta || idx < 0) return { net: 0, fee: 0 };
  return { net: tx.meta.postBalances[idx] - tx.meta.preBalances[idx], fee: idx === 0 ? tx.meta.fee : 0 };
}

/** COWBOT's balance of a given coin (whole tokens). */
export async function tokenBalance(owner: PublicKey, mint: PublicKey): Promise<number> {
  const res = await connection().getParsedTokenAccountsByOwner(owner, { mint });
  return res.value.reduce((s, a) => s + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
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
  const { net } = await walletDelta(signature, agent.publicKey);
  const tokens = await tokenBalance(agent.publicKey, mint.publicKey).catch(() => 0);
  return { mint: mint.publicKey.toBase58(), signature, metadataUri, costLamports: Math.max(0, -net), tokens };
}

/**
 * Sells ALL of COWBOT's holding of `mint` (its launch buy) back to SOL —
 * on pump.fun or PumpSwap, whichever the coin trades on. Returns the exact
 * SOL that came back into the wallet (after fees).
 */
export async function sellAllOnPumpFun(agent: Keypair, mint: string): Promise<{ signature: string; proceedsLamports: number }> {
  const signature = await buildAndSend(
    {
      publicKey: agent.publicKey.toBase58(),
      action: "sell",
      mint,
      denominatedInSol: "false",
      amount: "100%",
      slippage: config.launchSlippagePct,
      priorityFee: config.launchPriorityFeeSol,
      pool: "auto",
    },
    [agent],
  );
  const { net } = await walletDelta(signature, agent.publicKey);
  return { signature, proceedsLamports: Math.max(0, net) };
}

/** pump.fun keeps each creator's unclaimed rewards (bonding-curve phase) in a "creator vault" account. */
export function creatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), creator.toBuffer()], PUMP_PROGRAM_ID)[0];
}

/** After graduation, PumpSwap keeps the creator's rewards as wrapped SOL in this token account. */
export function pumpSwapCreatorVault(creator: PublicKey): { authority: PublicKey; ata: PublicKey } {
  const authority = PublicKey.findProgramAddressSync([Buffer.from("creator_vault"), creator.toBuffer()], PUMPSWAP_PROGRAM_ID)[0];
  const ata = PublicKey.findProgramAddressSync([authority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL_MINT.toBuffer()], ATA_PROGRAM_ID)[0];
  return { authority, ata };
}

/** Unclaimed creator rewards waiting in BOTH vaults (pump.fun + PumpSwap), in SOL. */
export async function unclaimedCreatorFeesSol(creator: PublicKey): Promise<{ pump: number; pumpSwap: number; total: number }> {
  const conn = connection();
  let pump = 0;
  const info = await conn.getAccountInfo(creatorVault(creator));
  if (info) {
    const rent = await conn.getMinimumBalanceForRentExemption(info.data.length);
    pump = Math.max(0, info.lamports - rent) / LAMPORTS_PER_SOL;
  }
  let pumpSwap = 0;
  try {
    const bal = await conn.getTokenAccountBalance(pumpSwapCreatorVault(creator).ata);
    pumpSwap = Number(bal.value.uiAmount ?? 0);
  } catch {
    /* no PumpSwap vault yet = nothing graduated */
  }
  return { pump, pumpSwap, total: pump + pumpSwap };
}

/**
 * Claims ALL accumulated creator rewards (pump.fun + PumpSwap) into the agent
 * wallet. PumpSwap rewards arrive as wrapped SOL and are unwrapped in the same
 * transaction, so the wallet's SOL change is the exact amount received.
 */
export async function claimCreatorFees(agent: Keypair): Promise<{ signature: string; receivedLamports: number }> {
  const signature = await buildAndSend(
    { publicKey: agent.publicKey.toBase58(), action: "collectCreatorFee", priorityFee: 0.000001, pool: "pump" },
    [agent],
  );
  const { net, fee } = await walletDelta(signature, agent.publicKey);
  return { signature, receivedLamports: Math.max(0, net + fee) };
}
