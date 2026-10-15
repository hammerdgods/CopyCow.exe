import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { DividendAirdrop } from "../target/types/dividend_airdrop";
import { balance, expectError, fund, newFundedKeypair, provider } from "./helpers";
import { leaf, tree } from "./merkle";

describe("dividend_airdrop", () => {
  const program = anchor.workspace.DividendAirdrop as Program<DividendAirdrop>;
  const relayer = provider.wallet; // the keeper
  const agentTreasury = Keypair.generate(); // the 90% destination (agent wallet)
  const [distributor] = PublicKey.findProgramAddressSync([Buffer.from("distributor")], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("dividend-vault")], program.programId);
  const epochPda = (i: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("epoch"), new BN(i).toArrayLike(Buffer, "le", 8)], program.programId)[0];

  before(async () => {
    await fund(agentTreasury.publicKey, 5);
  });

  it("hard-codes the FOUNDER RULE: holders get exactly 10% (1000 bps)", () => {
    const c = program.idl.constants?.find((k) => k.name === "holderFeeBps" || k.name === "HOLDER_FEE_BPS");
    expect(c, "HOLDER_FEE_BPS constant exported in IDL").to.exist;
    expect(Number(c!.value)).to.equal(1000);
  });

  it("initializes", async () => {
    await program.methods
      .initialize(relayer.publicKey, Keypair.generate().publicKey, new BN(0)) // epoch length 0 so tests needn't wait a week
      .accounts({ admin: relayer.publicKey, treasury: agentTreasury.publicKey })
      .rpc();
    const d = await program.account.distributor.fetch(distributor);
    expect(d.treasury.toBase58()).to.equal(agentTreasury.publicKey.toBase58());
    expect(d.relayer.toBase58()).to.equal(relayer.publicKey.toBase58());
  });

  it("deposit_fees splits exactly 10% to the holder vault and 90% to the treasury", async () => {
    const vaultBefore = await balance(vault);
    const treasuryBefore = await balance(agentTreasury.publicKey);
    await program.methods
      .depositFees(new BN(LAMPORTS_PER_SOL), { copytradeFee: {} })
      .accounts({ depositor: relayer.publicKey, treasury: agentTreasury.publicKey })
      .rpc();
    expect((await balance(vault)) - vaultBefore).to.equal(0.1 * LAMPORTS_PER_SOL);
    expect((await balance(agentTreasury.publicKey)) - treasuryBefore).to.equal(0.9 * LAMPORTS_PER_SOL);
  });

  it("odd amounts round down for holders (never above 10%)", async () => {
    const vaultBefore = await balance(vault);
    await program.methods
      .depositFees(new BN(19), { creatorFee: {} })
      .accounts({ depositor: relayer.publicKey, treasury: agentTreasury.publicKey })
      .rpc();
    expect((await balance(vault)) - vaultBefore).to.equal(1); // 10% of 19 = 1.9 → 1
  });

  it("rejects a deposit that names the wrong treasury", async () => {
    await expectError(
      () =>
        program.methods
          .depositFees(new BN(1000), { creatorFee: {} })
          .accounts({ depositor: relayer.publicKey, treasury: Keypair.generate().publicKey })
          .rpc(),
      "ConstraintHasOne",
    );
  });

  it("deposit_from_treasury: agent reports 2 SOL of creator fees, sends exactly 0.2 SOL to holders", async () => {
    const vaultBefore = await balance(vault);
    await program.methods
      .depositFromTreasury(new BN(2 * LAMPORTS_PER_SOL), { creatorFee: {} })
      .accounts({ treasury: agentTreasury.publicKey })
      .signers([agentTreasury])
      .rpc();
    expect((await balance(vault)) - vaultBefore).to.equal(0.2 * LAMPORTS_PER_SOL);
    const d = await program.account.distributor.fetch(distributor);
    expect(d.totalToHolders.toNumber()).to.equal(0.3 * LAMPORTS_PER_SOL + 1);
  });

  describe("weekly airdrop: publish root + push payouts (no claim button)", () => {
    const holders: Keypair[] = [];
    const amounts = [80_000_000, 60_000_000, 50_000_000, 40_000_000, 30_000_000].map(BigInt); // 0.26 SOL total
    let merkle: { root: Buffer; proofs: Buffer[][] };
    const epochIndex = 1;

    before(async () => {
      for (let i = 0; i < amounts.length; i++) holders.push(i === 4 ? Keypair.generate() : await newFundedKeypair(0.01)); // #4 is brand-new & empty
      merkle = tree(holders.map((h, i) => leaf(BigInt(epochIndex), i, h.publicKey, amounts[i])));
    });

    const payoutArg = (i: number, amount = amounts[i]) => ({
      index: i,
      amount: new BN(amount.toString()),
      proof: merkle.proofs[i].map((b) => Array.from(b)),
    });

    it("only the relayer can publish", async () => {
      const stranger = await newFundedKeypair(1);
      await expectError(
        () =>
          program.methods
            .distribute(Array.from(merkle.root), new BN(1), 5, new BN(1))
            .accounts({ relayer: stranger.publicKey, epoch: epochPda(epochIndex) })
            .signers([stranger])
            .rpc(),
        "ConstraintHasOne",
      );
    });

    it("cannot promise more than the vault holds", async () => {
      await expectError(
        () => program.methods.distribute(Array.from(merkle.root), new BN(10 * LAMPORTS_PER_SOL), 5, new BN(1)).accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) }).rpc(),
        "InsufficientVaultBalance",
      );
    });

    it("publishes the epoch root (snapshot slot = checkpoint)", async () => {
      const total = amounts.reduce((a, b) => a + b, 0n);
      const slot = await provider.connection.getSlot();
      await program.methods
        .distribute(Array.from(merkle.root), new BN(total.toString()), holders.length, new BN(slot))
        .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
        .rpc();
      const e = await program.account.epoch.fetch(epochPda(epochIndex));
      expect(e.index.toNumber()).to.equal(1);
      expect(e.holderCount).to.equal(5);
      expect(e.snapshotSlot.toNumber()).to.equal(slot);
      const d = await program.account.distributor.fetch(distributor);
      expect(d.reservedLamports.toString()).to.equal(total.toString());
    });

    it("relayer pushes SOL into holder wallets in batches", async () => {
      const before = await Promise.all(holders.map((h) => balance(h.publicKey)));
      for (const batch of [[0, 1], [2, 3], [4]]) {
        await program.methods
          .pushPayouts(new BN(epochIndex), batch.map((i) => payoutArg(i)))
          .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
          .remainingAccounts(batch.map((i) => ({ pubkey: holders[i].publicKey, isSigner: false, isWritable: true })))
          .rpc();
      }
      const after = await Promise.all(holders.map((h) => balance(h.publicKey)));
      after.forEach((a, i) => expect(a - before[i]).to.equal(Number(amounts[i])));
      const e = await program.account.epoch.fetch(epochPda(epochIndex));
      expect(e.paidCount).to.equal(5);
    });

    it("never pays the same holder twice", async () => {
      await expectError(
        () =>
          program.methods
            .pushPayouts(new BN(epochIndex), [payoutArg(0)])
            .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
            .remainingAccounts([{ pubkey: holders[0].publicKey, isSigner: false, isWritable: true }])
            .rpc(),
        "AlreadyPaid",
      );
    });

    it("closes the epoch and releases the reservation", async () => {
      await program.methods.closeEpoch(new BN(epochIndex)).accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) }).rpc();
      const d = await program.account.distributor.fetch(distributor);
      expect(d.reservedLamports.toNumber()).to.equal(0);
      expect(d.totalDistributed.toNumber()).to.equal(260_000_000);
    });
  });

  describe("a forged payout is rejected", () => {
    const epochIndex = 2;
    const holder = Keypair.generate();
    const attacker = Keypair.generate();
    let merkle: { root: Buffer; proofs: Buffer[][] };

    before(async () => {
      await fund(holder.publicKey, 0.01);
      await fund(attacker.publicKey, 0.01);
      merkle = tree([leaf(BigInt(epochIndex), 0, holder.publicKey, 1_000_000n), leaf(BigInt(epochIndex), 1, attacker.publicKey, 1_000_000n)]);
      await program.methods.distribute(Array.from(merkle.root), new BN(2_000_000), 2, new BN(0)).accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) }).rpc();
    });

    it("wrong amount → InvalidProof", async () => {
      await expectError(
        () =>
          program.methods
            .pushPayouts(new BN(epochIndex), [{ index: 1, amount: new BN(1_500_000), proof: merkle.proofs[1].map((b) => Array.from(b)) }])
            .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
            .remainingAccounts([{ pubkey: attacker.publicKey, isSigner: false, isWritable: true }])
            .rpc(),
        "InvalidProof",
      );
    });

    it("redirecting someone else's payout → InvalidProof", async () => {
      await expectError(
        () =>
          program.methods
            .pushPayouts(new BN(epochIndex), [{ index: 0, amount: new BN(1_000_000), proof: merkle.proofs[0].map((b) => Array.from(b)) }])
            .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
            .remainingAccounts([{ pubkey: attacker.publicKey, isSigner: false, isWritable: true }])
            .rpc(),
        "InvalidProof",
      );
    });
  });

  it("vault stays rent-exempt", async () => {
    const info = await provider.connection.getAccountInfo(vault);
    const rent = await provider.connection.getMinimumBalanceForRentExemption(info!.data.length);
    expect(info!.lamports).to.be.gte(rent);
    expect(SystemProgram.programId).to.exist;
  });
});
