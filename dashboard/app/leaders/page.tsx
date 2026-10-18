"use client";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Addr, KindBadge, TierBadge } from "@/components/wallet-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePoll } from "@/lib/use-poll";
import { ago, dt, pnlClass, signedSol } from "@/lib/format";
import type { LeadersData } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function LeadersPage() {
  const { data } = usePoll<LeadersData>("/api/leaders", 30_000);
  const leaders = data?.leaders ?? [];
  return (
    <>
      <PageHeader title="Who COWBOT Copies" kicker="the learning loop · re-weighted every 15 minutes" />
      <Window title="RULES.TXT" icon="📜" className="mb-4">
        <ul className="list-inside list-disc space-y-1 p-3 text-xs text-muted-foreground">
          <li>Weight follows each wallet&apos;s realized profit over the last 7 days (60%) and 30 days (40%), scaled by its win rate and number of trades.</li>
          <li>Losing money this week → weight 0, immediately. It comes back on its own once the wallet is profitable again.</li>
          <li>COWBOT also learns from its own results: if copying a wallet lost COWBOT money over 14 days (late entries, slippage), it stops copying that wallet.</li>
          <li>Only the top earners are copied, and weights add up to 100% of the copy budget{data?.budgetSol ? ` (${data.budgetSol} SOL)` : ""}.</li>
        </ul>
      </Window>

      <Window title={`LEADERS.XLS — ${leaders.filter((l) => l.copy_weight > 0).length} copied`} icon="🎯" className="mb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Its 7d</TableHead>
              <TableHead className="text-right">Its 30d</TableHead>
              <TableHead className="text-right">Wins</TableHead>
              <TableHead className="text-right">COWBOT&apos;s copy P&amp;L</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaders.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">No wallet is earning enough to copy yet.</TableCell>
              </TableRow>
            )}
            {leaders.map((l) => (
              <TableRow key={l.address} className={l.copy_weight > 0 ? "" : "opacity-60"}>
                <TableCell><Addr address={l.address} /></TableCell>
                <TableCell><TierBadge tier={l.tier} /></TableCell>
                <TableCell><KindBadge kind={l.kind} score={null} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-2 w-16 bevel-in bg-black" aria-hidden>
                      <div className="h-full bg-win" style={{ width: `${Math.min(100, l.copy_weight * 100)}%` }} />
                    </div>
                    <span className="w-10 font-bold text-win">{(l.copy_weight * 100).toFixed(0)}%</span>
                  </div>
                </TableCell>
                <TableCell className={cn("text-right", pnlClass(l.pnl_7d_sol))}>{signedSol(l.pnl_7d_sol, 2)}</TableCell>
                <TableCell className={cn("text-right", pnlClass(l.pnl_30d_sol))}>{signedSol(l.pnl_30d_sol, 2)}</TableCell>
                <TableCell className="text-right">{l.win_rate_30d === null ? "—" : `${Math.round(l.win_rate_30d * 100)}%`}</TableCell>
                <TableCell className={cn("text-right font-bold", pnlClass(l.copy_pnl_sol))}>
                  {signedSol(l.copy_pnl_sol, 3)} <span className="font-normal text-muted-foreground">({l.copy_closed})</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{ago(l.last_activity_at)}</TableCell>
                <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground" title={l.weight_reason ?? ""}>{l.weight_reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Window>

      <Window title="LEARNING.LOG — weight changes" icon="🧠">
        <div className="divide-y text-xs">
          {(data?.changes ?? []).length === 0 && <p className="p-4 text-muted-foreground">No changes yet.</p>}
          {(data?.changes ?? []).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="text-muted-foreground">{dt(c.ts)}</span>
              <Addr address={c.wallet} />
              <span className="num">
                {(c.old_weight * 100).toFixed(0)}% → <span className={c.new_weight > c.old_weight ? "text-win" : "text-loss"}>{(c.new_weight * 100).toFixed(0)}%</span>
              </span>
              <span className="text-muted-foreground">{c.reason}</span>
            </div>
          ))}
        </div>
      </Window>
    </>
  );
}
