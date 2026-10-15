"use client";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Stat } from "@/components/stat";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePoll } from "@/lib/use-poll";
import { ago, dt, lamportsToSol, solscanAccount, solscanTx } from "@/lib/format";
import type { LaunchesData } from "@/lib/types";

export default function LaunchesPage() {
  const { data } = usePoll<LaunchesData>("/api/launches", 30_000);
  const t = data?.totals;
  return (
    <>
      <PageHeader title="Launched Tokens" kicker="COWBOT scans X + Solana for trends, then launches on pump.fun">
        {data && <Badge variant={data.launchMode === "real" ? "loss" : "amber"}>{data.launchMode === "real" ? "LIVE LAUNCHES" : "PAPER LAUNCHES"}</Badge>}
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Creator fees earned" value={t ? t.feesSol.toFixed(4) : "—"} sub="SOL, all launched tokens" />
        <Stat label="→ Holders (10%)" value={t ? t.holdersSol.toFixed(4) : "—"} sub="hard-coded · never more" valueClass="text-win" />
        <Stat label="→ Treasury (90%)" value={t ? t.treasurySol.toFixed(4) : "—"} sub="compounds + funds launches" />
        <Stat label="Copytrade fees" value={t ? t.copytradeFeesSol.toFixed(4) : "—"} sub="SOL · same 10/90 split" />
      </div>

      {/* 10/90 visual */}
      <Window title="FEE_SPLIT.EXE" icon="🔀" className="mb-4">
        <div className="p-4">
          <div className="flex h-8 bevel-in text-[11px] font-bold">
            <div className="flex w-[10%] items-center justify-center bg-win text-black">10%</div>
            <div className="flex flex-1 items-center justify-center bg-muted text-muted-foreground">90% treasury</div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            FOUNDER RULE: holders get exactly 10% of creator fees — hard-coded in the code and in the on-chain contract (HOLDER_FEE_BPS = 1000). Airdropped weekly, no claim.
          </p>
        </div>
      </Window>

      <Window title="LAUNCHES.DBF" icon="🚀" className="mb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Launched</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Trend ridden</TableHead>
              <TableHead className="text-right">Dev buy</TableHead>
              <TableHead className="text-right">Creator fees</TableHead>
              <TableHead className="text-right">10% holders</TableHead>
              <TableHead className="text-right">90% treasury</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.tokens ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No launches yet. COWBOT only launches when a trend clears the bar (max 1 per 24h).
                </TableCell>
              </TableRow>
            )}
            {(data?.tokens ?? []).map((tk) => (
              <TableRow key={tk.id}>
                <TableCell className="text-muted-foreground">{dt(tk.launched_at)}</TableCell>
                <TableCell>
                  <span className="font-bold">${tk.ticker}</span> <span className="text-xs text-muted-foreground">{tk.name}</span>
                  {tk.mint && (
                    <a className="ml-2 text-[11px] text-win underline" href={solscanAccount(tk.mint)} target="_blank" rel="noreferrer">
                      mint ↗
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  “{tk.trend_term}” {tk.trend_score !== null && <span className="text-[11px] text-muted-foreground">score {Math.round(tk.trend_score)}</span>}
                </TableCell>
                <TableCell className="text-right">{tk.launch_buy_sol} SOL</TableCell>
                <TableCell className="text-right">
                  {lamportsToSol(tk.fees_lamports).toFixed(5)}
                  {tk.simulated_fees ? <span className="ml-1 text-[10px] text-amber">sim</span> : null}
                </TableCell>
                <TableCell className="text-right text-win">{lamportsToSol(tk.holder_lamports).toFixed(5)}</TableCell>
                <TableCell className="text-right">{lamportsToSol(tk.treasury_lamports).toFixed(5)}</TableCell>
                <TableCell>
                  {tk.tx_signature ? (
                    <a href={solscanTx(tk.tx_signature)} target="_blank" rel="noreferrer">
                      <Badge variant="win">LIVE ↗</Badge>
                    </a>
                  ) : (
                    <Badge variant={tk.status === "failed" ? "loss" : "amber"}>{tk.status === "paper_launched" ? "PAPER" : tk.status}</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Window>

      <Window title="TREND_RADAR.LOG" icon="📡">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Detected</TableHead>
              <TableHead>Term</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Mentions</TableHead>
              <TableHead className="text-right">Velocity</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead>Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.trends ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Trend scanner hasn&apos;t logged anything yet.</TableCell>
              </TableRow>
            )}
            {(data?.trends ?? []).map((tr) => (
              <TableRow key={tr.id} title={(JSON.parse(tr.sample_posts) as string[]).join("\n")}>
                <TableCell className="text-muted-foreground">{ago(tr.detected_at)}</TableCell>
                <TableCell className="font-bold">{tr.term.toUpperCase()}</TableCell>
                <TableCell className="text-right">{Math.round(tr.score)}</TableCell>
                <TableCell className="text-right">{tr.mention_count.toFixed(1)}</TableCell>
                <TableCell className="text-right">{tr.velocity_ratio.toFixed(1)}×</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">{Object.keys(JSON.parse(tr.sources) as object).join(", ")}</TableCell>
                <TableCell className="max-w-[280px] truncate text-[11px]">
                  <Badge variant={tr.status === "launched" ? "win" : tr.qualified ? "amber" : "outline"}>{tr.status === "logged" ? (tr.qualified ? "qualified" : "near miss") : tr.status}</Badge>{" "}
                  <span className="text-muted-foreground">{tr.status_reason}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Window>
    </>
  );
}
