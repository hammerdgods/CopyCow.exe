/**
 * "Which tier is this wallet?" — reads the wallet's real $COPYCOW balance
 * from Solana (same thresholds as the on-chain Tier Access contract).
 * Before $COPYCOW exists (no COPYCOW_MINT yet), PAPER mode lets you register
 * a test wallet with a claimed balance; it's marked "unverified".
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { tierForBalance, type Tier } from "@copycow/shared/tiers";
import { engineConfig } from "./config";

export function isValidWallet(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export async function lookupTier(wallet: string, claimedPaperBalance?: number): Promise<{ tier: Tier; balance: number; verified: boolean }> {
  if (!engineConfig.copycowMint) {
    const balance = Math.max(0, Number(claimedPaperBalance ?? 0)) || 0;
    return { tier: tierForBalance(balance), balance, verified: false };
  }
  const conn = new Connection(engineConfig.rpcUrl, "confirmed");
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(wallet), { mint: new PublicKey(engineConfig.copycowMint) });
  const balance = res.value.reduce((s, a) => s + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
  return { tier: tierForBalance(balance), balance, verified: true };
}
