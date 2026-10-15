/**
 * LAUNCH DECISION ENGINE.
 * Given a qualified trend, COWBOT prepares a token (name, ticker, image)
 * and then either:
 *   • PAPER (default): logs "would have launched $XYZ riding trend ABC"
 *   • REAL (LAUNCH_MODE=real in .env): actually creates it on pump.fun
 * Safety rules are checked first, every time.
 */
import { commitProof, type DB, LAMPORTS_PER_SOL, nowIso } from "@copycow/shared";
import { config } from "../config";
import { say } from "../log";
import { loadOrCreateWallet } from "../wallet/wallet";
import { createTokenImage } from "./image";
import { makeTokenIdentity } from "./naming";
import { launchOnPumpFun } from "./pumpfun";
import { checkLaunchSafety, LAUNCH_OVERHEAD_SOL } from "./safety";

export interface TrendForLaunch {
  id: number;
  term: string;
  score: number;
}

export async function launchFromTrend(db: DB, trend: TrendForLaunch): Promise<number | null> {
  const mode = config.launchMode;
  const safety = await checkLaunchSafety(db, mode, trend.term);
  if (!safety.ok) {
    db.prepare("UPDATE trends SET status='skipped', status_reason=? WHERE id=?").run(`safety: ${safety.reason}`, trend.id);
    say("info", `Not launching "${trend.term}": ${safety.reason}.`);
    return null;
  }

  const identity = makeTokenIdentity(trend.term);
  const imagePath = await createTokenImage(identity.name, identity.ticker, trend.term);
  const agent = loadOrCreateWallet(db).keypair;

  // Pre-commit the launch decision to the proof ledger BEFORE acting.
  const proof = commitProof(db, "token_launch", {
    mode,
    trend_id: trend.id,
    trend_term: trend.term,
    trend_score: trend.score,
    name: identity.name,
    ticker: identity.ticker,
    launch_buy_sol: config.launchBuySol,
    creator_wallet: agent.publicKey.toBase58(),
  });

  const insert = db.prepare(
    `INSERT INTO launched_tokens (trend_id, trend_term, name, ticker, description, image_path, mode, status, launch_buy_sol, proof_id, launched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const spend = db.prepare("INSERT INTO treasury_ledger (ts, kind, amount_lamports, ref, simulated) VALUES (?, 'launch_spend', ?, ?, ?)");
  const costLamports = -Math.round((config.launchBuySol + LAUNCH_OVERHEAD_SOL) * LAMPORTS_PER_SOL);

  if (mode === "paper") {
    const id = Number(insert.run(trend.id, trend.term, identity.name, identity.ticker, identity.description, imagePath, "paper", "paper_launched", config.launchBuySol, proof.id, nowIso()).lastInsertRowid);
    spend.run(nowIso(), costLamports, `launch:${id}`, 1);
    db.prepare("UPDATE trends SET status='launched', status_reason='paper launch' WHERE id=?").run(trend.id);
    say("launch", `PAPER: would have launched $${identity.ticker} riding trend "${trend.term}" (score ${trend.score}) with a ${config.launchBuySol} SOL dev buy. Nothing was sent on-chain.`);
    return id;
  }

  // ---- REAL LAUNCH ----
  const id = Number(insert.run(trend.id, trend.term, identity.name, identity.ticker, identity.description, imagePath, "real", "pending", config.launchBuySol, proof.id, nowIso()).lastInsertRowid);
  say("launch", `REAL LAUNCH: creating $${identity.ticker} on pump.fun riding "${trend.term}"…`);
  try {
    const res = await launchOnPumpFun(agent, { ...identity, imagePath, buySol: config.launchBuySol });
    db.prepare("UPDATE launched_tokens SET status='launched', mint=?, tx_signature=?, metadata_uri=? WHERE id=?").run(res.mint, res.signature, res.metadataUri, id);
    spend.run(nowIso(), costLamports, `launch:${id}`, 0);
    db.prepare("UPDATE trends SET status='launched', status_reason='real launch' WHERE id=?").run(trend.id);
    say("launch", `🐄 Launched $${identity.ticker} — mint ${res.mint} · tx ${res.signature}`);
    return id;
  } catch (e) {
    db.prepare("UPDATE launched_tokens SET status='failed', error=? WHERE id=?").run((e as Error).message.slice(0, 500), id);
    db.prepare("UPDATE trends SET status='skipped', status_reason=? WHERE id=?").run(`launch failed: ${(e as Error).message.slice(0, 200)}`, trend.id);
    say("error", `Launch of $${identity.ticker} failed: ${(e as Error).message}`);
    return null;
  }
}

/** Called after each scan: launch at most one candidate (the best one). */
export async function considerLaunches(db: DB, candidates: TrendForLaunch[]): Promise<void> {
  const best = [...candidates].sort((a, b) => b.score - a.score)[0];
  if (!best) return;
  await launchFromTrend(db, best);
  for (const c of candidates) if (c.id !== best.id) db.prepare("UPDATE trends SET status='skipped', status_reason='a stronger trend was chosen' WHERE id=? AND status='logged'").run(c.id);
}
