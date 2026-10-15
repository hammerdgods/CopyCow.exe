"use client";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { RugChecks } from "@/components/rug-checks";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePoll } from "@/lib/use-poll";
import { ago, pct, pnlClass, signedSol, usd } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function LivePage() {
  const { data, updatedAt, error } = usePoll<Trade[]>("/api/positions", 10_000);
  const rows = data ?? [];
  const totalU = rows.reduce((s, t) => s + (t.unrealized_sol ?? 0), 0);
  return (
    <>
      <PageHeader title="Live Trades" kicker="open positions · auto-refresh 10s">
        <p className="text-xs text-muted-foreground">
          {updatedAt ? `updated ${updatedAt.toISOString().slice(11, 19)} UTC` : "loading…"}
          {error && <span className="text-loss"> · {error}</span>}
        </p>
      </PageHeader>
      <Window title={`POSITIONS.XLS — ${rows.filter((r) => r.kind === "momentum").length}/3 open`} icon="📈" right={<span className={cn("text-xs font-bold num", totalU >= 0 ? "text-win" : "text-loss")}>{signedSol(totalU)} SOL</span>}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Mark</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Unrealized</TableHead>
              <TableHead className="text-right">P&amp;L SOL</TableHead>
              <TableHead>Why COWBOT entered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No open positions. Waiting for clean momentum + volume. No FOMO.
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => (
              <TableRow key={t.id} className={cn((t.unrealized_pct ?? 0) >= 0 ? "bg-win/[0.03]" : "bg-loss/[0.04]")}>
                <TableCell className="font-bold">
                  {t.symbol} {t.kind === "launch" && <Badge variant="amber">launch buy</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground">{ago(t.entry_ts)}</TableCell>
                <TableCell className="text-right">{usd(t.entry_price)}</TableCell>
                <TableCell className="text-right">{usd(t.last_price)}</TableCell>
                <TableCell className="text-right">{t.size_sol} SOL</TableCell>
                <TableCell className={cn("text-right font-bold", pnlClass(t.unrealized_pct))}>{pct(t.unrealized_pct)}</TableCell>
                <TableCell className={cn("text-right", pnlClass(t.unrealized_sol))}>{signedSol(t.unrealized_sol)}</TableCell>
                <TableCell className="max-w-[340px] truncate text-xs text-muted-foreground">{t.entry_reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Trades: take-profit +3% · stop-loss −1.5% · max hold 4h. Launch buys: sold at 2× or after 24h. Profits from both → weekly $COPYCOW airdrop.
        </p>
      </Window>
      <RugChecks />
    </>
  );
}
