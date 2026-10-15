"use client";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePoll } from "@/lib/use-poll";
import { dt, pct, pnlClass, signedSol, usd } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

type Key = "exit_ts" | "symbol" | "entry_price" | "exit_price" | "size_sol" | "pnl_pct" | "pnl_sol";
const COLS: { key: Key; label: string; right?: boolean }[] = [
  { key: "exit_ts", label: "Date" },
  { key: "symbol", label: "Token" },
  { key: "entry_price", label: "Entry", right: true },
  { key: "exit_price", label: "Exit", right: true },
  { key: "size_sol", label: "Size", right: true },
  { key: "pnl_pct", label: "P&L %", right: true },
  { key: "pnl_sol", label: "P&L SOL", right: true },
];

export default function HistoryPage() {
  const { data } = usePoll<Trade[]>("/api/trades", 30_000);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "exit_ts", dir: -1 });
  const [filter, setFilter] = useState<"all" | "win" | "loss">("all");
  const rows = useMemo(() => {
    const r = (data ?? []).filter((t) => filter === "all" || (filter === "win" ? (t.pnl_sol ?? 0) > 0 : (t.pnl_sol ?? 0) <= 0));
    return [...r].sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [data, sort, filter]);

  const exitLabel: Record<string, string> = { take_profit: "TP +3%", stop_loss: "SL −1.5%", time_exit: "time" };

  return (
    <>
      <PageHeader title="Trade History" kicker={`${data?.length ?? 0} closed trades`}>
        <div className="flex gap-1" role="group" aria-label="Filter">
          {(["all", "win", "loss"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1 text-xs uppercase tracking-widest", filter === f ? "bevel-in bg-black text-win" : "bevel-out bg-w95-gray text-black")}>
              {f}
            </button>
          ))}
        </div>
      </PageHeader>
      <Window title="HISTORY.DBF" icon="🗂">
        <Table>
          <TableHeader>
            <TableRow>
              {COLS.map((c) => (
                <TableHead key={c.key} className={c.right ? "text-right" : ""} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button
                    className="uppercase tracking-[0.14em] hover:text-win"
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}
                  >
                    {c.label} {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
                  </button>
                </TableHead>
              ))}
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No closed trades yet.</TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const win = (t.pnl_sol ?? 0) > 0;
              return (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">{dt(t.exit_ts)}</TableCell>
                  <TableCell className="font-bold">{t.symbol}</TableCell>
                  <TableCell className="text-right">{usd(t.entry_price)}</TableCell>
                  <TableCell className="text-right">{usd(t.exit_price)}</TableCell>
                  <TableCell className="text-right">{t.size_sol} SOL</TableCell>
                  <TableCell className={cn("text-right font-bold", pnlClass(t.pnl_pct))}>{pct(t.pnl_pct)}</TableCell>
                  <TableCell className={cn("text-right", pnlClass(t.pnl_sol))}>{signedSol(t.pnl_sol)}</TableCell>
                  <TableCell>
                    <Badge variant={win ? "win" : "loss"}>{win ? "WIN" : "LOSS"}</Badge>{" "}
                    <span className="text-[11px] text-muted-foreground">{exitLabel[t.exit_reason ?? ""] ?? t.exit_reason}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Window>
    </>
  );
}
