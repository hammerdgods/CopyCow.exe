/**
 * One "grazing cycle" (runs every 5 minutes):
 *   1. heartbeat → dashboard shows "COWBOT is live"
 *   2. load the pasture (top tokens by volume)
 *   3. check open positions for take-profit / stop-loss
 *   4. look for new momentum entries (max 3 positions)
 */
import { type DB, nowIso, setMeta, getMeta, SOL_MINT } from "@copycow/shared";
import { config } from "../config";
import { fmtPct, fmtSol, fmtUsd, say } from "../log";
import { loadUniverse } from "../market/universe";
import type { PoolInfo } from "../market/geckoterminal";
import { getPrices } from "../market/prices";
import { evaluateEntry, evaluateExit } from "../strategy/momentum";
import { closePaperTrade, markPrice, openPaperTrade, openTrades, type TradeRow } from "./paper-broker";
import { manageLaunchPositions } from "../token-launcher/positions";

export function heartbeat(db: DB, status = "live"): void {
  setMeta(db, "heartbeat", nowIso());
  setMeta(db, "agent_status", status);
  setMeta(db, "launch_mode", config.launchMode);
  setMeta(db, "trading_mode", "paper");
  setMeta(db, "paper_starting_capital_sol", config.paperStartingCapitalSol);
}

function cooldowns(db: DB, now: number): Map<string, number> {
  const since = new Date(now - config.cooldownAfterLossMinutes * 60_000).toISOString();
  const rows = db
    .prepare("SELECT mint, exit_ts FROM trades WHERE status='closed' AND kind='momentum' AND pnl_sol < 0 AND exit_ts > ?")
    .all(since) as { mint: string; exit_ts: string }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.mint, new Date(r.exit_ts).getTime() + config.cooldownAfterLossMinutes * 60_000);
  return map;
}

/** After N losses in a row, COWBOT lies down in the field for a while. */
function inRut(db: DB, now: number): boolean {
  const n = config.rutAfterConsecutiveLosses;
  if (n <= 0) return false;
  const last = db
    .prepare("SELECT pnl_sol, exit_ts FROM trades WHERE status='closed' AND kind='momentum' ORDER BY exit_ts DESC LIMIT ?")
    .all(n) as { pnl_sol: number; exit_ts: string }[];
  if (last.length < n || !last.every((t) => t.pnl_sol < 0)) return false;
  return now - new Date(last[0].exit_ts).getTime() < config.rutPauseMinutes * 60_000;
}

export async function runTradingCycle(db: DB): Promise<void> {
  const now = Date.now();
  heartbeat(db);
  setMeta(db, "cycle_count", Number(getMeta(db, "cycle_count") ?? 0) + 1);

  // 1) Pasture
  let universe: PoolInfo[] = [];
  try {
    universe = await loadUniverse();
    setMeta(db, "universe", JSON.stringify(universe.map((p) => ({ mint: p.mint, symbol: p.symbol, m15: p.change.m15, vol24h: p.volume.h24 }))));
  } catch (e) {
    say("warn", `Couldn't reach the pasture (GeckoTerminal): ${(e as Error).message}. Managing open positions only.`);
  }

  // 2) Prices for everything we care about
  const open = openTrades(db);
  const mints = [...new Set([...universe.map((u) => u.mint), ...open.map((t) => t.mint), SOL_MINT])];
  const prices = await getPrices(mints);
  const solUsd = prices.get(SOL_MINT)?.priceUsd;

  const snap = db.prepare(
    `INSERT INTO price_snapshots (mint, symbol, price_usd, change_15m_pct, volume_24h_usd, liquidity_usd, source, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ts = nowIso();
  for (const u of universe) {
    const p = prices.get(u.mint);
    snap.run(u.mint, u.symbol, p?.priceUsd ?? u.priceUsd, u.change.m15, u.volume.h24, u.liquidityUsd, p?.source ?? "geckoterminal", ts);
  }
  db.prepare("DELETE FROM price_snapshots WHERE ts < ?").run(new Date(now - 14 * 86_400_000).toISOString());

  // 3) Exits
  for (const t of open) {
    const price = prices.get(t.mint)?.priceUsd ?? universe.find((u) => u.mint === t.mint)?.priceUsd;
    if (!price) {
      say("warn", `No price for ${t.symbol} this cycle — holding and checking again next cycle.`);
      continue;
    }
    markPrice(db, t.id, price);
    const ex = evaluateExit(t.entry_price, price, t.entry_ts, config, now);
    if (!ex.exit) continue;
    const closed = closePaperTrade(db, t, price, ex.reason!);
    if (ex.reason === "take_profit") say("win", `Fresh grass: took profit on ${t.symbol} at ${fmtPct(closed.pnl_pct!)} (${fmtSol(closed.pnl_sol!)})`);
    else if (ex.reason === "stop_loss") say("loss", `Rut: stopped out of ${t.symbol} at ${fmtPct(closed.pnl_pct!)} (${fmtSol(closed.pnl_sol!)}). No revenge trades — cooling off.`);
    else say(closed.pnl_sol! >= 0 ? "win" : "loss", `Grazed long enough on ${t.symbol}: time exit at ${fmtPct(closed.pnl_pct!)} (${fmtSol(closed.pnl_sol!)})`);
  }

  // 3b) Launch buys: sell at 2x or after 24h
  try {
    await manageLaunchPositions(db);
  } catch (e) {
    say("warn", `Launch-position check hiccup: ${(e as Error).message}`);
  }

  // 4) Entries
  const stillOpen = openTrades(db);
  let slots = config.maxPositions - stillOpen.length;
  if (slots > 0 && universe.length > 0) {
    if (!solUsd) {
      say("warn", "No SOL price this cycle — skipping new entries.");
    } else if (inRut(db, now)) {
      say("loss", `In a rut: ${config.rutAfterConsecutiveLosses} losses in a row. Lying down in the field for ${config.rutPauseMinutes} min. No forced trades.`);
    } else {
      const ctx = { heldMints: new Set(stillOpen.map((t) => t.mint)), cooldownUntil: cooldowns(db, now), now };
      const signals = universe.map((p) => ({ p, s: evaluateEntry(p, config, ctx) }));
      for (const { p, s } of signals) if (s.fomo) say("info", `${p.symbol} ripped ${fmtPct(s.momentum15m)} in 15m — not chasing. Cows don't sprint.`);
      const picks = signals.filter((x) => x.s.enter).sort((a, b) => b.s.score - a.s.score);
      for (const { p, s } of picks) {
        if (slots <= 0) break;
        const price = prices.get(p.mint);
        const mid = price?.priceUsd ?? p.priceUsd;
        const trade = await openPaperTrade(db, {
          mint: p.mint,
          symbol: p.symbol,
          midPrice: mid,
          decimals: price?.decimals,
          solUsd,
          reason: s.reason,
          momentum15m: s.momentum15m,
          volumePace: s.volumePace,
        });
        say("trade", `Moo-ving into ${p.symbol} — ${s.reason}. Paper size ${trade.size_sol} SOL @ ${fmtUsd(trade.entry_price)}`);
        slots--;
      }
    }
  }

  // 5) Summary
  const finalOpen = openTrades(db);
  if (finalOpen.length === 0) {
    say("info", `Grazing complete: no positions. Watching ${universe.length} tokens. Patience is a strategy.`);
  } else {
    const green = finalOpen.filter((t: TradeRow) => (t.last_price ?? t.entry_price) >= t.entry_price).length;
    say("info", `Grazing complete: ${green}/${finalOpen.length} positions green.`);
  }
  heartbeat(db);
}
