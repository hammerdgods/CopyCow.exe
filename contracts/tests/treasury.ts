import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { Treasury } from "../target/types/treasury";
import { balance, expectError, newFundedKeypair, provider } from "./helpers";

describe("treasury", () => {
  const program = anchor.workspace.Treasury as Program<Treasury>;
  const admin = provider.wallet;
  const agent = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("treasury-vault")], program.programId);
  const sol = (n: number) => new BN(Math.round(n * LAMPORTS_PER_SOL));

  const spend = (amount: number, purpose: object, signer = agent) =>
    program.methods.spend(sol(amount), purpose as any).accounts({ agent: signer.publicKey, recipient }).signers([signer]).rpc();

  before(async () => {
    // daily limit 2 SOL, total launch budget 1 SOL
    await program.methods.initialize(agent.publicKey, sol(2), sol(1)).accounts({ admin: admin.publicKey }).rpc();
    await program.methods.deposit(sol(5)).accounts({ depositor: admin.publicKey }).rpc();
  });

  it("holds deposits", async () => {
    expect(await balance(vault)).to.be.gte(5 * LAMPORTS_PER_SOL);
  });

  it("agent can fund a token launch", async () => {
    await spend(0.5, { tokenLaunch: {} });
    expect(await balance(recipient)).to.equal(0.5 * LAMPORTS_PER_SOL);
  });

  it("max ONE launch per 24h, enforced on-chain", async () => {
    await expectError(() => spend(0.1, { tokenLaunch: {} }), "LaunchTooSoon");
  });

  it("daily limit is enforced", async () => {
    await expectError(() => spend(1.6, { trading: {} }), "DailyLimitExceeded"); // 0.5 + 1.6 > 2
    await spend(1.4, { trading: {} }); // 0.5 + 1.4 = 1.9 ok
  });

  it("only the agent can spend", async () => {
    const thief = await newFundedKeypair(1);
    await expectError(() => spend(0.01, { operations: {} }, thief), "ConstraintHasOne");
  });

  it("only the admin can change limits", async () => {
    const stranger = await newFundedKeypair(1);
    await expectError(
      () => program.methods.updateLimits(sol(100), sol(100)).accounts({ admin: stranger.publicKey }).signers([stranger]).rpc(),
      "ConstraintHasOne",
    );
    await program.methods.updateLimits(sol(3), sol(0.6)).accounts({ admin: admin.publicKey }).rpc();
    const t = await program.account.treasuryState.fetch(PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId)[0]);
    expect(t.dailyLimitLamports.toNumber()).to.equal(3 * LAMPORTS_PER_SOL);
  });

  it("launch budget is enforced (total, across all launches)", async () => {
    // Limits are now: daily 3 SOL, launch budget 0.6 SOL. 0.5 already spent on a launch,
    // so another 0.6 launch must fail on the BUDGET check (it runs before the 24h check).
    await expectError(() => spend(0.6, { tokenLaunch: {} }), "LaunchBudgetExceeded");
  });
});
