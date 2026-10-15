/**
 * REST API
 *   GET  /health
 *   GET  /signals            COWBOT's open positions + recent closed trades
 *   POST /subscribe          { wallet, maxSizeSol?, paperBalance? } → tier + (COW+) API key
 *   GET  /subscribers/:wallet  your registration + tier
 *   GET  /executions?wallet=  what the engine would have executed for you (paper)
 *   GET  /queue              current execution order (wallets masked)
 *   GET  /tiers              tier table
 */
import { createHash, randomBytes } from "node:crypto";
import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { type DB, nowIso, TIERS, tierById } from "@copycow/shared";
import { buildQueue, type QueueSubscriber } from "./queue";
import { isValidWallet, lookupTier } from "./tier-lookup";

const mask = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export function createApp(db: DB) {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));
  const subscribeLimiter = rateLimit({ windowMs: 3_600_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many subscribe attempts — try again in an hour." } });

  app.get("/health", (_req, res) => res.json({ ok: true, mode: "paper", ts: nowIso() }));

  app.get("/tiers", (_req, res) => res.json(TIERS));

  app.get("/signals", (_req, res) => {
    const open = db.prepare("SELECT id, symbol, mint, size_sol, entry_price, entry_ts, last_price, last_price_ts, entry_reason FROM trades WHERE status='open' AND kind='momentum' ORDER BY entry_ts DESC").all() as {
      entry_price: number; last_price: number | null;
    }[];
    const recent = db.prepare("SELECT id, symbol, mint, entry_price, exit_price, entry_ts, exit_ts, exit_reason, pnl_pct FROM trades WHERE status='closed' AND kind='momentum' ORDER BY exit_ts DESC LIMIT 20").all();
    res.json({
      mode: "paper",
      open: open.map((o) => ({ ...o, unrealized_pct: o.last_price ? (o.last_price / o.entry_price - 1) * 100 : 0 })),
      recent,
    });
  });

  app.post("/subscribe", subscribeLimiter, async (req: Request, res: Response) => {
    const { wallet, maxSizeSol, paperBalance } = req.body ?? {};
    if (typeof wallet !== "string" || !isValidWallet(wallet)) return res.status(400).json({ error: "wallet must be a valid Solana wallet address" });
    if (maxSizeSol !== undefined && !(typeof maxSizeSol === "number" && maxSizeSol > 0 && maxSizeSol <= 100)) {
      return res.status(400).json({ error: "maxSizeSol must be a number between 0 and 100" });
    }
    let info;
    try {
      info = await lookupTier(wallet, typeof paperBalance === "number" ? paperBalance : undefined);
    } catch (e) {
      return res.status(502).json({ error: `couldn't read your $COPYCOW balance: ${(e as Error).message}` });
    }
    const existing = db.prepare("SELECT id, api_key FROM subscribers WHERE wallet=?").get(wallet) as { id: number; api_key: string | null } | undefined;
    let apiKey: string | undefined;
    let keyHash = existing?.api_key ?? null;
    if (info.tier.autoCopy && !keyHash) {
      apiKey = `cow_${randomBytes(24).toString("hex")}`;
      keyHash = hashKey(apiKey);
    }
    if (!info.tier.autoCopy) keyHash = null;
    db.prepare(
      `INSERT INTO subscribers (wallet, tier, token_balance, balance_verified, max_size_sol, api_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet) DO UPDATE SET tier=excluded.tier, token_balance=excluded.token_balance, balance_verified=excluded.balance_verified,
         max_size_sol=excluded.max_size_sol, api_key=excluded.api_key, updated_at=excluded.updated_at`,
    ).run(wallet, info.tier.id, info.balance, info.verified ? 1 : 0, maxSizeSol ?? null, keyHash, nowIso(), nowIso());
    res.json({
      wallet,
      tier: info.tier.id,
      tierName: info.tier.name,
      balance: info.balance,
      balanceVerified: info.verified,
      benefits: info.tier.benefits,
      autoCopy: info.tier.autoCopy,
      maxCopySizeSol: info.tier.maxCopySizeSol,
      ...(apiKey ? { apiKey, apiKeyNote: "Shown ONCE. Store it safely." } : {}),
      mode: "paper",
    });
  });

  app.get("/subscribers/:wallet", (req, res) => {
    const s = db.prepare("SELECT wallet, tier, token_balance, balance_verified, max_size_sol, created_at, updated_at FROM subscribers WHERE wallet=?").get(req.params.wallet);
    if (!s) return res.status(404).json({ error: "not subscribed" });
    res.json(s);
  });

  app.get("/executions", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const wallet = typeof req.query.wallet === "string" ? req.query.wallet : null;
    const rows = db.prepare(
      `SELECT e.id, e.trade_id, t.symbol, e.action, e.tier, e.queue_position, e.delay_ms, e.size_sol, e.instruction, e.status, e.pnl_sol, e.fee_lamports, e.created_at, s.wallet
         FROM copy_executions e JOIN trades t ON t.id=e.trade_id JOIN subscribers s ON s.id=e.subscriber_id
        WHERE (? IS NULL OR s.wallet = ?) ORDER BY e.id DESC LIMIT ?`,
    ).all(wallet, wallet, limit) as { wallet: string; instruction: string }[];
    res.json(rows.map((r) => ({ ...r, wallet: wallet ? r.wallet : mask(r.wallet), instruction: JSON.parse(r.instruction) })));
  });

  app.get("/queue", (_req, res) => {
    const subs = db.prepare("SELECT id, wallet, tier, token_balance, max_size_sol, created_at FROM subscribers").all() as QueueSubscriber[];
    res.json(buildQueue(subs).map((q) => ({ position: q.position, wallet: mask(q.subscriber.wallet), tier: tierById(q.subscriber.tier).name, delayMs: q.delayMs, sizeSol: q.sizeSol })));
  });

  app.use((_req, res) => res.status(404).json({ error: "not found" }));
  return app;
}
