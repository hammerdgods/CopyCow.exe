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
        <Stat label="Launched-coin rewards" value={t ? t.coinRewardsSol.toFixed(4) : "—"} sub={t ? `100% to each coin's holders · ${t.coinRewardsAirdroppedSol.toFixed(4)} airdropped` : "SOL"} valueClass="text-win" />
        <Stat label="Launch-sale P&L" value={t ? `${t.launchPnlSol >= 0 ? "+" : ""}${t.launchPnlSol.toFixed(4)}` : "—"} sub="SOL · goes to $COPYCOW holders" valueClass={t && t.launchPnlSol < 0 ? "text-loss" : "text-win"} />
        <Stat label="$COPYCOW rewards" value={t ? t.copycowRewardsSol.toFixed(4) : "—"} sub={t ? `COWBOT 10% ${t.agentSol.toFixed(4)} · team 90% ${t.teamSol.toFixed(4)}` : "SOL"} />
        <Stat label="Team 90% sent" value={t ? t.teamSentSol.toFixed(4) : "—"} sub="SOL · on-chain to team wallet" />
      </div>

      <Window title="WHO_GETS_WHAT.TXT" icon="🔀" className="mb-4">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">A coin COWBOT launches</p>
            <div className="flex h-8 bevel-in text-[11px] font-bold">
              <div className="flex flex-1 items-center justify-center bg-win text-black">100% creator rewards → that coin&apos;s holders (daily)</div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">COWBOT sells its own launch buy at 2× or after 24h; that profit goes to $COPYCOW holders.</p>
          </div>
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">$COPYCOW creator rewards</p>
            <div className="flex h-8 bevel-in text-[11px] font-bold">
              <div className="flex w-[18%] min-w-[64px] items-center justify-center bg-win text-black">10% COWBOT</div>
              <div className="flex flex-1 items-center justify-center bg-muted text-muted-foreground">90% team wallet (marketing)</div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              FOUNDER RULE: COWBOT keeps max 10% (AGENT_SHARE_BPS = 1000, hard-coded on-chain). The team&apos;s 90% is sent straight away; COWBOT can never touch it.
            </p>
          </div>
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
              <TableHead className="text-right">Rewards → holders</TableHead>
              <TableHead className="text-right">Airdropped</TableHead>
              <TableHead className="text-right">Launch buy P&amp;L</TableHead>
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
                <TableCell className="text-right text-win">{lamportsToSol(tk.airdropped_lamports).toFixed(5)}</TableCell>
                <TableCell className={`text-right ${tk.launch_pnl_sol === null ? "text-muted-foreground" : tk.launch_pnl_sol >= 0 ? "text-win" : "text-loss"}`}>
                  {tk.launch_status === "open" ? "holding" : tk.launch_pnl_sol === null ? "—" : `${tk.launch_pnl_sol >= 0 ? "+" : ""}${tk.launch_pnl_sol.toFixed(4)}`}
                </TableCell>
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
