"use client";
import Link from "next/link";
import { GlitchText } from "@/components/glitch-text";
import { StatusBadge } from "@/components/status-badge";
import { Window } from "@/components/window";
import { Stat } from "@/components/stat";
import { TerminalFeed } from "@/components/terminal-feed";
import { WalletCard } from "@/components/wallet-card";
import { Countdown } from "@/components/countdown";
import { usePoll } from "@/lib/use-poll";
import { pct, pnlClass, signedSol, usd } from "@/lib/format";
import type { Summary, Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Home() {
  const { data: s, error } = usePoll<Summary>("/api/summary", 10_000);
  const { data: open } = usePoll<Trade[]>("/api/positions", 10_000);

  const wr = s?.winRate ?? null;
  const roi = s ? (s.totalPnlSol / s.startingCapitalSol) * 100 : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* HERO */}
      <Window title="C:\COWBOT.EXE" icon="🐄" className="lg:col-span-2" right={<span className="hidden font-pixel text-white/80 sm:inline">v0.1</span>}>
        <div className="relative overflow-hidden p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            {s ? <StatusBadge live={s.live} heartbeat={s.heartbeat} /> : <span className="text-xs text-muted-foreground">connecting…</span>}
            {s && <span className="border px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">{s.tradingMode} trading</span>}
          </div>
          <h1 className="mt-5 font-pixel text-5xl leading-[0.9] sm:text-7xl">
            <GlitchText text="COPYCOW.EXE" />
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">Copy the Smartest Cow in the Room.</p>

          <div className="mt-8">
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Win rate · all closed trades</p>
            <p
              className={cn(
                "-mt-4 font-pixel leading-[0.8] num text-[7rem] sm:-mt-8 sm:text-[11rem] lg:text-[13rem]",
                wr === null ? "text-muted-foreground" : wr >= 50 ? "text-win drop-shadow-[0_0_24px_rgba(0,255,136,0.35)]" : "text-loss",
              )}
              aria-label={wr === null ? "No closed trades yet" : `Win rate ${wr.toFixed(1)} percent`}
            >
              {wr === null ? "--.-" : wr.toFixed(1)}
              <span className="text-[0.4em]">%</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {s ? `${s.wins}W / ${s.losses}L over ${s.closedTrades} closed trades` : "…"}
              {wr === null && s && " — first trade still grazing"}
            </p>
          </div>
        </div>
      </Window>

      <div className="grid content-start gap-4">
        <Window title="P&L.TXT" icon="💹">
          <div className="grid grid-cols-2 gap-px bg-border">
            <Stat className="border-0" label="Total P&L" value={signedSol(s?.totalPnlSol ?? null, 3)} sub="SOL (paper)" valueClass={pnlClass(s?.totalPnlSol)} />
            <Stat className="border-0" label="Return" value={pct(roi, 2)} sub={s ? `on ${s.startingCapitalSol} SOL` : ""} valueClass={pnlClass(roi)} />
            <Stat className="border-0" label="Today" value={signedSol(s?.todayPnlSol ?? null, 3)} sub="SOL" valueClass={pnlClass(s?.todayPnlSol)} />
            <Stat className="border-0" label="Open" value={`${s?.openPositions ?? "—"}/3`} sub="positions" />
          </div>
        </Window>
        <Window title="HOLDERS.DLL" icon="🪙">
          <div className="space-y-3 p-3 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Dividend pool (next airdrop)</span>
              <span className="text-lg font-bold text-win num">{s ? s.dividendPoolSol.toFixed(4) : "—"} SOL</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Next auto-airdrop</span>
              <span className="text-foreground">{s ? <Countdown to={s.nextAirdropAt} /> : "—"}</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Airdropped to date</span>
              <span className="num">{s ? s.airdroppedSol.toFixed(4) : "—"} SOL</span>
            </div>
            <p className="border-t pt-2 text-muted-foreground">
              10% of every creator fee from tokens COWBOT launches is airdropped weekly. No claim button. Moo.
            </p>
          </div>
        </Window>
      </div>

      {/* OPEN POSITIONS PREVIEW */}
      <Window title="OPEN_POSITIONS.XLS" icon="📈" className="lg:col-span-2" right={<Link href="/live" className="text-xs text-white underline">all →</Link>}>
        <div className="divide-y">
          {(open ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No open positions. COWBOT is grazing, not chasing.</p>}
          {(open ?? []).map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-bold">{t.symbol}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t.entry_reason}</p>
              </div>
              <div className="text-right num">
                <p className={cn("text-lg font-bold", pnlClass(t.unrealized_pct))}>{pct(t.unrealized_pct)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {usd(t.entry_price)} → {usd(t.last_price)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Window>

      <Window title="AGENT_WALLET.SYS" icon="🔑">
        {s ? <WalletCard s={s} /> : <p className="p-3 text-xs text-muted-foreground">loading…</p>}
      </Window>

      <Window title="COWBOT.LOG" icon="▤" className="lg:col-span-2" bodyClassName="bg-black">
        <TerminalFeed />
      </Window>

      <Window title="STATS.INI" icon="⚙">
        <div className="grid grid-cols-2 gap-px bg-border">
          <Stat className="border-0" label="Tokens launched" value={s?.tokensLaunched ?? "—"} sub={s ? `${s.launchMode} mode` : ""} />
          <Stat className="border-0" label="Creator + copy fees" value={s ? s.totalFeesSol.toFixed(3) : "—"} sub="SOL all-time" />
          <Stat className="border-0" label="→ Holders (10%)" value={s ? s.holdersTotalSol.toFixed(4) : "—"} sub="SOL" valueClass="text-win" />
          <Stat className="border-0" label="Grazing cycles" value={s?.cycleCount ?? "—"} sub="every 5 min" />
        </div>
      </Window>

      {error && <p className="text-xs text-loss lg:col-span-3">Can&apos;t reach the database API: {error}</p>}
    </div>
  );
}
