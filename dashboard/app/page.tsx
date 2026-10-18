"use client";
import Link from "next/link";
import { TIERS, TIER_DESCRIPTIONS } from "@copycow/shared/constants";
import { GlitchText } from "@/components/glitch-text";
import { StatusBadge } from "@/components/status-badge";
import { Window } from "@/components/window";
import { Stat } from "@/components/stat";
import { TerminalFeed } from "@/components/terminal-feed";
import { Addr, KindBadge, TierBadge } from "@/components/wallet-badges";
import { usePoll } from "@/lib/use-poll";
import { ago, pct, pnlClass, signedSol } from "@/lib/format";
import type { CopiesData, LeadersData, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Home() {
  const { data: s, error } = usePoll<Summary>("/api/summary", 10_000);
  const { data: leaders } = usePoll<LeadersData>("/api/leaders", 30_000);
  const { data: copies } = usePoll<CopiesData>("/api/copies", 10_000);
  const copying = (leaders?.leaders ?? []).filter((l) => l.copy_weight > 0);
  const wr = s?.winRate ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {error && (
        <div className="border border-amber/60 bg-amber/10 p-3 text-xs text-amber lg:col-span-3" role="alert">
          ⚠ No data yet: {error}
        </div>
      )}
      {/* HERO */}
      <Window title="C:\COWBOT.EXE" icon="🐄" className="lg:col-span-2" right={<span className="hidden font-pixel text-white/80 sm:inline">v0.2</span>}>
        <div className="relative overflow-hidden p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            {s ? <StatusBadge live={s.live} heartbeat={s.heartbeat} /> : <span className="text-xs text-muted-foreground">connecting…</span>}
            {s && <span className={cn("border px-2 py-1 text-[11px] uppercase tracking-widest", s.copyMode === "real" ? "border-amber/50 text-amber" : "text-muted-foreground")}>{s.copyMode} money</span>}
          </div>
          <h1 className="mt-5 font-pixel text-5xl leading-[0.9] sm:text-7xl">
            <GlitchText text="COPYCOW.EXE" />
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            COWBOT watches thousands of Solana wallets, AI agents and humans alike, and copies whoever is making money right now. Losers get dropped
            automatically.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            <Stat className="border-0" label="Realized P&L" value={signedSol(s?.realizedPnlSol ?? null, 3)} sub="SOL from copies" valueClass={pnlClass(s?.realizedPnlSol)} />
            <Stat className="border-0" label="Win rate" value={wr === null ? "—" : `${wr.toFixed(1)}%`} sub={s ? `${s.wins}W / ${s.losses}L` : ""} valueClass={wr === null ? "" : wr >= 50 ? "text-win" : "text-loss"} />
            <Stat className="border-0" label="Open" value={s ? `${s.openPositions}/${s.maxPositions}` : "—"} sub={s ? `${signedSol(s.unrealizedPnlSol, 3)} SOL unrealized` : ""} valueClass={pnlClass(s?.unrealizedPnlSol)} />
            <Stat className="border-0" label="Copying" value={s?.leaders ?? "—"} sub={s ? `of ${s.walletsTracked} wallets studied` : ""} />
          </div>
        </div>
      </Window>

      {/* TIERS */}
      <Window title="WALLET_DB.IDX" icon="🗄">
        <div className="divide-y">
          {TIERS.map((t) => (
            <Link key={t} href={`/wallets?tier=${t}`} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50" title={TIER_DESCRIPTIONS[t]}>
              <TierBadge tier={t} />
              <span className="text-lg font-bold num">{s?.tierCounts[t] ?? "—"}</span>
            </Link>
          ))}
          <div className="grid grid-cols-3 gap-px bg-border">
            <Link href="/wallets?kind=ai" className="bg-card p-2 text-center hover:bg-muted/50">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">AI / bot</p>
              <p className="text-lg font-bold text-cyan-300 num">{s?.kindCounts.ai ?? "—"}</p>
            </Link>
            <Link href="/wallets?kind=human" className="bg-card p-2 text-center hover:bg-muted/50">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Human</p>
              <p className="text-lg font-bold text-sky-100 num">{s?.kindCounts.human ?? "—"}</p>
            </Link>
            <Link href="/groups" className="bg-card p-2 text-center hover:bg-muted/50">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Fresh 24h</p>
              <p className="text-lg font-bold num">{s?.freshWallets24h ?? "—"}</p>
            </Link>
          </div>
        </div>
      </Window>

      {/* LEADERS */}
      <Window title="COPYING_NOW.LST" icon="🎯" className="lg:col-span-2" right={<Link href="/leaders" className="text-xs text-white underline">all →</Link>}>
        <div className="divide-y">
          {copying.length === 0 && <p className="p-4 text-sm text-muted-foreground">Not copying anyone yet. COWBOT needs to study some wallets first. Leaders appear here once a wallet is making money.</p>}
          {copying.slice(0, 8).map((l) => (
            <div key={l.address} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Addr address={l.address} />
                <TierBadge tier={l.tier} />
                <KindBadge kind={l.kind} score={null} />
              </div>
              <div className="flex items-center gap-4 text-right num">
                <span className={cn("text-xs", pnlClass(l.pnl_7d_sol))}>{signedSol(l.pnl_7d_sol, 2)} SOL 7d</span>
                <span className="w-14 text-lg font-bold text-win">{(l.copy_weight * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      </Window>

      <Window title="OPEN_COPIES.XLS" icon="📈" right={<Link href="/copies" className="text-xs text-white underline">all →</Link>}>
        <div className="divide-y">
          {(copies?.open ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No open positions.</p>}
          {(copies?.open ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="font-bold">{p.symbol ?? p.mint.slice(0, 6)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  from <Addr address={p.leader} /> · {ago(p.opened_at)}
                </p>
              </div>
              <p className={cn("text-lg font-bold num", pnlClass(p.unrealized_pct))}>{pct(p.unrealized_pct ?? null)}</p>
            </div>
          ))}
        </div>
      </Window>

      <Window title="COWBOT.LOG" icon="▤" className="lg:col-span-3" bodyClassName="bg-black">
        <TerminalFeed limit={18} />
      </Window>
    </div>
  );
}
