"use client";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Stat } from "@/components/stat";
import { Countdown } from "@/components/countdown";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePoll } from "@/lib/use-poll";
import { dt, lamportsToSol, shortAddr, solscanTx } from "@/lib/format";
import type { AirdropsData } from "@/lib/types";

const STATUS: Record<string, { label: string; v: "win" | "loss" | "amber" | "outline" }> = {
  completed: { label: "paid", v: "win" },
  paper: { label: "paper", v: "amber" },
  rolled_over: { label: "rolled over", v: "outline" },
  published: { label: "paying…", v: "amber" },
  partial: { label: "partial", v: "amber" },
  pending: { label: "pending", v: "amber" },
  ready: { label: "awaiting contract", v: "amber" },
};

export default function AirdropsPage() {
  const { data } = usePoll<AirdropsData>("/api/airdrops", 30_000);
  return (
    <>
      <PageHeader title="Airdrop History" kicker="weekly · automatic · no claim button" />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Pool for next airdrop" value={data ? data.pendingPoolSol.toFixed(5) : "—"} sub="SOL" valueClass="text-win" />
        <Stat label="Next airdrop in" value={data ? <Countdown to={data.nextAirdropAt} /> : "—"} sub="Mondays 00:05 UTC" />
        <Stat label="Airdropped to date" value={data ? data.totalAirdroppedSol.toFixed(5) : "—"} sub="SOL" />
        <Stat label="Epochs" value={data?.epochs.length ?? "—"} sub={data && !data.mintConfigured ? "$COPYCOW not launched yet" : "weekly snapshots"} />
      </div>

      <Window title="HOW_IT_WORKS.TXT" icon="❔" className="mb-4">
        <ol className="list-decimal space-y-1 p-4 pl-8 text-xs text-muted-foreground">
          <li>10% of every creator fee (and copytrade fee) lands in the dividend pool.</li>
          <li>Every Monday COWBOT snapshots all $COPYCOW holders at a fixed Solana slot (the checkpoint).</li>
          <li>The pool is split pro-rata. A Merkle root of every (wallet, amount) is published on-chain.</li>
          <li>The relayer pushes SOL straight into each wallet in batches and pays the gas. You do nothing.</li>
        </ol>
      </Window>

      <Window title="AIRDROPS.DBF" icon="🪂">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Epoch</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Distributed</TableHead>
              <TableHead className="text-right">Wallets paid</TableHead>
              <TableHead>Snapshot slot</TableHead>
              <TableHead>Merkle root</TableHead>
              <TableHead>Transactions</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.epochs ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">First airdrop runs next Monday 00:05 UTC.</TableCell>
              </TableRow>
            )}
            {(data?.epochs ?? []).map((e) => {
              const sigs = JSON.parse(e.tx_signatures) as string[];
              const st = STATUS[e.status] ?? { label: e.status, v: "outline" as const };
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-bold">#{e.epoch_index}</TableCell>
                  <TableCell className="text-muted-foreground">{dt(e.period_end)}</TableCell>
                  <TableCell className="text-right text-win">{lamportsToSol(e.total_lamports).toFixed(5)} SOL</TableCell>
                  <TableCell className="text-right">{e.wallets_paid}</TableCell>
                  <TableCell className="text-muted-foreground">{e.snapshot_slot ?? "—"}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground" title={e.merkle_root ?? ""}>{e.merkle_root ? shortAddr(e.merkle_root, 6) : "—"}</TableCell>
                  <TableCell className="text-[11px]">
                    {sigs.length === 0 ? (
                      <span className="text-muted-foreground">{e.mode === "paper" ? "paper — none sent" : "—"}</span>
                    ) : (
                      <span className="flex flex-wrap gap-x-2">
                        {sigs.slice(0, 3).map((s) => (
                          <a key={s} className="text-win underline" href={solscanTx(s)} target="_blank" rel="noreferrer">
                            {shortAddr(s, 5)}↗
                          </a>
                        ))}
                        {sigs.length > 3 && <span className="text-muted-foreground">+{sigs.length - 3}</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell title={e.notes ?? ""}>
                    <Badge variant={st.v}>{st.label}</Badge>
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
