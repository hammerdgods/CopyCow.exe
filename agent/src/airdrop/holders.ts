/**
 * Snapshot of every $COPYCOW holder at a specific Solana slot (the
 * "checkpoint"). Reads all token accounts for the mint (works with both the
 * classic SPL Token program and Token-2022). Needs an RPC that allows
 * getProgramAccounts — Helius free tier does; the public RPC often doesn't.
 */
import { PublicKey } from "@solana/web3.js";
import { connection } from "../rpc";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export interface HolderSnapshot {
  slot: number;
  decimals: number;
  holders: { wallet: string; tokens: number }[];
}

export async function snapshotHolders(mintAddress: string): Promise<HolderSnapshot> {
  const conn = connection();
  const mint = new PublicKey(mintAddress);
  const slot = await conn.getSlot("finalized");
  const decimals = (await conn.getTokenSupply(mint)).value.decimals;
  const balances = new Map<string, bigint>();
  for (const program of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const accounts = await conn.getProgramAccounts(program, {
      commitment: "finalized",
      filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }, ...(program.equals(TOKEN_PROGRAM) ? [{ dataSize: 165 }] : [])],
      dataSlice: { offset: 32, length: 40 }, // owner (32 bytes) + amount (8 bytes)
    });
    for (const a of accounts) {
      const data = a.account.data;
      const owner = new PublicKey(data.subarray(0, 32)).toBase58();
      const amount = data.readBigUInt64LE(32);
      if (amount > 0n) balances.set(owner, (balances.get(owner) ?? 0n) + amount);
    }
  }
  const div = 10 ** decimals;
  return {
    slot,
    decimals,
    holders: [...balances.entries()].map(([wallet, amt]) => ({ wallet, tokens: Number(amt) / div })),
  };
}

/** Pool/vault accounts are "off-curve" program addresses — they can't receive airdrops meaningfully. */
export function isPersonalWallet(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}
