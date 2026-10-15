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
  const agent = Keypair.generate(); // COWBOT's wallet
  const team = Keypair.generate(); // team wallet: receives 90% of creator rewards
  const [distributor] = PublicKey.findProgramAddressSync([Buffer.from("distributor")], program.programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("dividend-vault")], program.programId);
  const epochPda = (i: number) =>
    PublicKey.findProgramAddressSync([Buffer.from("epoch"), new BN(i).toArrayLike(Buffer, "le", 8)], program.programId)[0];

  before(async () => {
    await fund(agent.publicKey, 10);
    await fund(team.publicKey, 0.01);
  });

  it("hard-codes the FOUNDER RULE: COWBOT keeps at most 10% (1000 bps) of creator rewards", () => {
    const c = program.idl.constants?.find((k) => k.name === "agentShareBps" || k.name === "AGENT_SHARE_BPS");
    expect(c, "AGENT_SHARE_BPS constant exported in IDL").to.exist;
    expect(Number(c!.value)).to.equal(1000);
  });

  it("initializes", async () => {
    await program.methods
      .initialize(relayer.publicKey, Keypair.generate().publicKey, new BN(0)) // epoch length 0 so tests needn't wait a week
      .accounts({ admin: relayer.publicKey, agent: agent.publicKey, teamWallet: team.publicKey })
      .rpc();
    const d = await program.account.distributor.fetch(distributor);
    expect(d.agent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(d.teamWallet.toBase58()).to.equal(team.publicKey.toBase58());
  });

  const route = (gross: number, signer = agent, teamWallet = team.publicKey) =>
    program.methods.routeCreatorRewards(new BN(gross)).accounts({ agent: signer.publicKey, teamWallet }).signers([signer]).rpc();

  it("route_creator_rewards: 90% goes straight to the team wallet, COWBOT keeps exactly 10%", async () => {
    const teamBefore = await balance(team.publicKey);
    const agentBefore = await balance(agent.publicKey);
    await route(2 * LAMPORTS_PER_SOL);
    expect((await balance(team.publicKey)) - teamBefore).to.equal(1.8 * LAMPORTS_PER_SOL);
    // the agent only loses the team's 90% (+ the tiny network fee)
    const agentLoss = agentBefore - (await balance(agent.publicKey));
    expect(agentLoss).to.be.gte(1.8 * LAMPORTS_PER_SOL).and.lte(1.8 * LAMPORTS_PER_SOL + 10_000);
  });

  it("odd amounts round DOWN for COWBOT (never above 10%)", async () => {
    const teamBefore = await balance(team.publicKey);
    await route(19);
    expect((await balance(team.publicKey)) - teamBefore).to.equal(18); // COWBOT keeps 1 of 19
  });

  it("COWBOT can't redirect the team's share to another wallet", async () => {
    await expectError(() => route(1000, agent, Keypair.generate().publicKey), "ConstraintHasOne");
  });

  it("only COWBOT's wallet can route rewards", async () => {
    const stranger = await newFundedKeypair(1);
    await expectError(() => route(1000, stranger), "ConstraintHasOne");
  });

  it("only the admin can change the team wallet", async () => {
    await expectError(
      () => program.methods.setTeamWallet(agent.publicKey).accounts({ admin: agent.publicKey }).signers([agent]).rpc(),
      "ConstraintHasOne",
    );
  });

  const copycowMint = Keypair.generate().publicKey;
  const launchedCoin = Keypair.generate().publicKey;

  it("deposit_for_holders: COWBOT deposits its profit (for $COPYCOW holders) and a launched coin's rewards (for that coin's holders)", async () => {
    const vaultBefore = await balance(vault);
    await program.methods.depositForHolders(new BN(0.3 * LAMPORTS_PER_SOL), { cowbotProfit: {} }, copycowMint).accounts({ agent: agent.publicKey }).signers([agent]).rpc();
    await program.methods.depositForHolders(new BN(0.002 * LAMPORTS_PER_SOL), { launchedCoinRewards: {} }, launchedCoin).accounts({ agent: agent.publicKey }).signers([agent]).rpc();
    expect((await balance(vault)) - vaultBefore).to.equal(0.302 * LAMPORTS_PER_SOL);
    const d = await program.account.distributor.fetch(distributor);
    expect(d.totalProfitDeposited.toNumber()).to.equal(0.3 * LAMPORTS_PER_SOL);
    expect(d.totalCoinRewardsDeposited.toNumber()).to.equal(0.002 * LAMPORTS_PER_SOL);
    expect(d.totalToTeam.toNumber()).to.equal(1.8 * LAMPORTS_PER_SOL + 18);
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
            .distribute(Array.from(merkle.root), new BN(1), 5, new BN(1), copycowMint, { cowbotProfit: {} })
            .accounts({ relayer: stranger.publicKey, epoch: epochPda(epochIndex) })
            .signers([stranger])
            .rpc(),
        "ConstraintHasOne",
      );
    });

    it("cannot promise more than the vault holds", async () => {
      await expectError(
        () => program.methods.distribute(Array.from(merkle.root), new BN(10 * LAMPORTS_PER_SOL), 5, new BN(1), copycowMint, { cowbotProfit: {} }).accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) }).rpc(),
        "InsufficientVaultBalance",
      );
    });

    it("publishes the epoch root (snapshot slot = checkpoint)", async () => {
      const total = amounts.reduce((a, b) => a + b, 0n);
      const slot = await provider.connection.getSlot();
      await program.methods
        .distribute(Array.from(merkle.root), new BN(total.toString()), holders.length, new BN(slot), copycowMint, { cowbotProfit: {} })
        .accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) })
        .rpc();
      const e = await program.account.epoch.fetch(epochPda(epochIndex));
      expect(e.index.toNumber()).to.equal(1);
      expect(e.holderCount).to.equal(5);
      expect(e.snapshotSlot.toNumber()).to.equal(slot);
      expect(e.tokenMint.toBase58()).to.equal(copycowMint.toBase58());
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
      await program.methods.distribute(Array.from(merkle.root), new BN(2_000_000), 2, new BN(0), launchedCoin, { launchedCoinRewards: {} }).accounts({ relayer: relayer.publicKey, epoch: epochPda(epochIndex) }).rpc();
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
