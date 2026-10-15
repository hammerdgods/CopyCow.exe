/**
 * COWBOT's voice. Everything it says goes to the terminal AND to the
 * database, so the dashboard can show a live "terminal feed".
 */
import { type DB, nowIso } from "@copycow/shared";

type Level = "info" | "trade" | "win" | "loss" | "warn" | "error" | "trend" | "launch" | "fee";

const COLORS: Record<Level, string> = {
  info: "\x1b[37m",
  trade: "\x1b[36m",
  win: "\x1b[32m",
  loss: "\x1b[31m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  trend: "\x1b[35m",
  launch: "\x1b[95m",
  fee: "\x1b[92m",
};

let db: DB | null = null;
export function attachLogDb(d: DB): void {
  db = d;
}

export function say(level: Level, message: string): void {
  const ts = nowIso();
  console.log(`\x1b[90m${ts.slice(11, 19)}\x1b[0m ${COLORS[level]}[COWBOT]\x1b[0m ${message}`);
  if (!db) return;
  try {
    db.prepare("INSERT INTO agent_log (ts, level, message) VALUES (?, ?, ?)").run(ts, level, message);
    // keep the log table from growing forever
    db.prepare("DELETE FROM agent_log WHERE id < (SELECT MAX(id) - 5000 FROM agent_log)").run();
  } catch {
    /* never crash because of logging */
  }
}

export const fmtUsd = (n: number): string =>
  n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : `$${n.toPrecision(4)}`;
export const fmtPct = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
export const fmtSol = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(4)} SOL`;
