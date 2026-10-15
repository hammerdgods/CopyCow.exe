import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { TierAccess } from "../target/types/tier_access";
import { expectError, provider } from "./helpers";

describe("tier_access", () => {
  const program = anchor.workspace.TierAccess as Program<TierAccess>;
  const payer = (provider.wallet as anchor.Wallet).payer;
  let mint: PublicKey;
  const DECIMALS = 6; // pump.fun tokens use 6 decimals

  async function walletWith(wholeTokens: number) {
    const owner = Keypair.generate();
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, owner.publicKey);
    if (wholeTokens > 0) await mintTo(provider.connection, payer, mint, ata.address, payer, BigInt(wholeTokens) * 10n ** BigInt(DECIMALS));
    return { owner: owner.publicKey, ata: ata.address };
  }

  const tierOf = (w: { owner: PublicKey; ata: PublicKey }) =>
    program.methods.getTier().accounts({ mint, tokenAccount: w.ata, owner: w.owner }).view();

  before(async () => {
    mint = await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS); // placeholder $COPYCOW
    await program.methods.initialize(mint).accounts({ admin: payer.publicKey }).rpc();
  });

  const cases: [number, number, string][] = [
    [50_000, 0, "none"],
    [100_000, 1, "CALF"],
    [1_000_000, 2, "HEIFER"],
    [10_000_000, 3, "COW"],
    [50_000_000, 4, "MAD Cow"],
    [75_000_000, 4, "MAD Cow"],
  ];
  for (const [tokens, tier, name] of cases) {
    it(`${tokens.toLocaleString()} tokens → tier ${tier} (${name})`, async () => {
      expect(await tierOf(await walletWith(tokens))).to.equal(tier);
    });
  }

  it("a wallet with no token account is tier 0", async () => {
    const owner = Keypair.generate().publicKey;
    const empty = Keypair.generate().publicKey; // nonexistent account
    expect(await tierOf({ owner, ata: empty })).to.equal(0);
  });

  it("can't borrow someone else's token account", async () => {
    const whale = await walletWith(50_000_000);
    await expectError(() => tierOf({ owner: Keypair.generate().publicKey, ata: whale.ata }), "WrongOwner");
  });

  it("rejects a token account for a different mint", async () => {
    const otherMint = await createMint(provider.connection, payer, payer.publicKey, null, DECIMALS);
    const owner = Keypair.generate();
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, otherMint, owner.publicKey);
    await expectError(() => tierOf({ owner: owner.publicKey, ata: ata.address }), "WrongMint");
  });
});
