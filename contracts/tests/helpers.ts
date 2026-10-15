import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

const envProvider = anchor.AnchorProvider.env();
export const provider = new anchor.AnchorProvider(envProvider.connection, envProvider.wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
anchor.setProvider(provider);

export async function fund(pk: PublicKey, sol: number): Promise<void> {
  const sig = await provider.connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  const latest = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
}

export async function newFundedKeypair(sol = 2): Promise<Keypair> {
  const kp = Keypair.generate();
  await fund(kp.publicKey, sol);
  return kp;
}

export const balance = (pk: PublicKey) => provider.connection.getBalance(pk, "confirmed");

/** Asserts that `fn` fails with the given Anchor error code name. */
export async function expectError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    const got = [e?.error?.errorCode?.code, e?.message, ...(e?.logs ?? e?.simulationResponse?.logs ?? [])].join(" ");
    expect(got).to.include(code);
    return;
  }
  throw new Error(`expected error ${code}, but the call succeeded`);
}
