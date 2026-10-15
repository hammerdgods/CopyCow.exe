/**
 * COWBOT's daily report — pulls REAL numbers from the database and writes
 * a ready-to-post recap to content/daily/YYYY-MM-DD.md
 */
import fs from "node:fs";
import path from "node:path";
import { type DB, LAMPORTS_PER_SOL, repoRoot, winRate } from "@copycow/shared";

export interface DailyStats {
  date: string;
  closedTrades: number;
  winRatePct: number | null;
  pnlSol: number;
  trendsScanned: number;
  trendsQualified: number;
  tokensLaunched: number;
  creatorFeesSol: number;
  holderShareSol: number;
  openPositions: number;
  mood: string;
  mode: string;
}

export function dailyStats(db: DB, date: string): DailyStats {
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  const closed = db.prepare("SELECT pnl_sol FROM trades WHERE status='closed' AND exit_ts BETWEEN ? AND ?").all(start, end) as { pnl_sol: number }[];
  const pnlSol = closed.reduce((s, t) => s + t.pnl_sol, 0);
  const trends = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(qualified),0) q FROM trends WHERE detected_at BETWEEN ? AND ?").get(start, end) as { n: number; q: number };
  const launched = (db.prepare("SELECT COUNT(*) n FROM launched_tokens WHERE status IN ('launched','paper_launched') AND launched_at BETWEEN ? AND ?").get(start, end) as { n: number }).n;
  const fees = db.prepare("SELECT COALESCE(SUM(amount_lamports),0) a, COALESCE(SUM(holder_lamports),0) h FROM fee_receipts WHERE source_type='creator_fee' AND received_at BETWEEN ? AND ?").get(start, end) as { a: number; h: number };
  const open = (db.prepare("SELECT COUNT(*) n FROM trades WHERE status='open'").get() as { n: number }).n;
  const wr = winRate(closed);
  const mood =
    closed.length === 0 ? (open > 0 ? "GRAZING (positions open)" : "PATIENT (no clean setups)") :
    pnlSol > 0 && (wr ?? 0) >= 50 ? "WELL-FED" :
    pnlSol > 0 ? "CHEWING CUD (green, choppy)" :
    pnlSol === 0 ? "CHEWING CUD" : "IN A RUT (stops did their job)";
  const mode = (db.prepare("SELECT value FROM agent_meta WHERE key='launch_mode'").get() as { value: string } | undefined)?.value ?? "paper";
  return {
    date, closedTrades: closed.length, winRatePct: wr, pnlSol, trendsScanned: trends.n, trendsQualified: trends.q, tokensLaunched: launched,
    creatorFeesSol: fees.a / LAMPORTS_PER_SOL, holderShareSol: fees.h / LAMPORTS_PER_SOL, openPositions: open, mood, mode,
  };
}

const signed = (n: number, d = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;

/** The post itself, in the exact format from the brief. */
export function recapPost(s: DailyStats): string {
  return [
    `🐄 COWBOT.exe Daily Report — ${s.date}`,
    `Win rate today: ${s.winRatePct === null ? "—" : `${s.winRatePct.toFixed(0)}%`} | Trading P&L: ${signed(s.pnlSol)} SOL`,
    `New trends scanned: ${s.trendsScanned} | Tokens launched: ${s.tokensLaunched}`,
    `Creator fees earned: ${s.creatorFeesSol.toFixed(4)} SOL (10% → holders: ${s.holderShareSol.toFixed(4)} SOL)`,
    `Open positions: ${s.openPositions} | Status: ${s.mood}`,
  ].join("\n");
}

export function writeDailyRecap(db: DB, date = new Date().toISOString().slice(0, 10)): { file: string; post: string } {
  const s = dailyStats(db, date);
  const post = recapPost(s);
  const paperNote = s.mode === "paper" ? "\n\n_All trades and launches are PAPER (simulated). No real funds._" : "";
  const md = `${"```"}\n${post}\n${"```"}${paperNote}

| Stat | Value |
|---|---|
| Closed trades | ${s.closedTrades} |
| Win rate | ${s.winRatePct === null ? "—" : `${s.winRatePct.toFixed(1)}%`} |
| Trading P&L | ${signed(s.pnlSol, 4)} SOL |
| Trends logged / qualified | ${s.trendsScanned} / ${s.trendsQualified} |
| Tokens launched | ${s.tokensLaunched} |
| Creator fees | ${s.creatorFeesSol.toFixed(6)} SOL |
| → Holders (10%) | ${s.holderShareSol.toFixed(6)} SOL |
| Open positions | ${s.openPositions} |
| Mode | ${s.mode.toUpperCase()} |
`;
  const dir = path.join(repoRoot(), "content", "daily");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date}.md`);
  fs.writeFileSync(file, md);
  return { file, post };
}
