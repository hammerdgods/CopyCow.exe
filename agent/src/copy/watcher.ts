/**
 * Watches the wallets COWBOT copies, live.
 *   • a websocket subscription per leader (Solana "logsSubscribe") fires the
 *     moment a leader's transaction confirms
 *   • a poll every LEADER_POLL_SECONDS catches anything the websocket missed
 * Each new transaction is read once: swaps go to the copy engine; SOL sent to
 * a brand-new wallet adds that wallet to the database (possible rotation).
 */
import { PublicKey } from "@solana/web3.js";
import type { DB } from "@copycow/shared";
import { connection } from "../rpc";
import { say, short } from "../log";
import { fetchParsedOne, fetchSignatures } from "../chain/history";
import { findNewWalletsFunded, parseSwap } from "../chain/parse";
import { addWallet } from "../discovery/discover";
import type { CopyEngine } from "./engine";

/** SOL sent to a never-used wallet that makes COWBOT start tracking it. */
const ROTATION_MIN_SOL = 0.5;

export class LeaderWatcher {
  private subs = new Map<string, number>();
  private cursors = new Map<string, string | null>();
  private seen = new Set<string>();

  constructor(
    private db: DB,
    private engine: CopyEngine,
  ) {}

  get watching(): string[] {
    return [...this.cursors.keys()];
  }

  /** Start watching new leaders, stop watching dropped ones. */
  async sync(leaders: string[]): Promise<void> {
    const want = new Set(leaders);
    for (const [addr, id] of this.subs) {
      if (!want.has(addr)) {
        await connection().removeOnLogsListener(id).catch(() => undefined);
        this.subs.delete(addr);
        this.cursors.delete(addr);
      }
    }
    for (const addr of want) {
      if (this.cursors.has(addr)) continue;
      // Start from "now": COWBOT copies new trades only, never old ones.
      const newest = await fetchSignatures(addr, { limit: 1 }).catch(() => []);
      this.cursors.set(addr, newest[0]?.signature ?? null);
      try {
        const id = connection().onLogs(new PublicKey(addr), (logs) => {
          if (!logs.err) void this.handle(addr, logs.signature, Date.now());
        }, "confirmed");
        this.subs.set(addr, id);
      } catch (e) {
        say("warn", `Live feed for ${short(addr)} unavailable (${(e as Error).message}); relying on polling.`);
      }
    }
  }

  /** Safety net: read each leader's newest transactions since the last one handled. */
  async poll(): Promise<void> {
    for (const [addr, cursor] of this.cursors) {
      try {
        const sigs = await fetchSignatures(addr, { until: cursor, limit: 50 });
        if (!sigs.length) continue;
        this.cursors.set(addr, sigs[0].signature);
        if (!cursor) continue; // first successful read: just set the starting point
        for (const s of [...sigs].reverse()) if (!s.err) await this.handle(addr, s.signature, Date.now());
      } catch {
        /* next poll */
      }
    }
  }

  private async handle(leader: string, signature: string, seenAt: number): Promise<void> {
    const key = `${leader}:${signature}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 20_000) this.seen = new Set([...this.seen].slice(-10_000));
    const tx = await fetchParsedOne(signature);
    if (!tx) return;
    const swap = parseSwap(tx, leader);
    if (swap) {
      await this.engine.onLeaderSwap(swap, seenAt).catch((e: Error) => say("error", `Copy engine error: ${e.message}`));
      return;
    }
    for (const w of findNewWalletsFunded(tx, leader, ROTATION_MIN_SOL)) {
      if (addWallet(this.db, w.address, "funded_by_tracked", `received ${w.sol.toFixed(2)} SOL from tracked wallet ${leader}`)) {
        say("wallet", `${short(leader)} just funded a brand-new wallet ${short(w.address)} with ${w.sol.toFixed(2)} SOL — tracking it.`);
      }
    }
  }
}
