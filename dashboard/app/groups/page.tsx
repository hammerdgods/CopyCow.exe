"use client";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Addr, KindBadge, TierBadge } from "@/components/wallet-badges";
import { usePoll } from "@/lib/use-poll";
import { ago, pnlClass, signedSol } from "@/lib/format";
import type { WalletGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function GroupsPage() {
  const { data, error } = usePoll<WalletGroup[]>("/api/groups", 30_000);
  const groups = data ?? [];
  return (
    <>
      <PageHeader title="Fresh Wallets" kicker="new wallets, grouped by who funded them, sorted AI or human" />
      <Window title="HOW_IT_WORKS.TXT" icon="ℹ" className="mb-4">
        <p className="p-3 text-xs text-muted-foreground">
          Every new wallet COWBOT sees trading gets analyzed: when it was created, who sent it its first SOL, and whether a program (AI / bot) or a person is
          trading it. Wallets paid for by the same funder form a group, which is how one trader running many fresh wallets shows up. A funder behind 25+ wallets
          is most likely an exchange, so its group says little about who&apos;s behind it.
        </p>
      </Window>
      {error && <p className="mb-4 text-sm text-loss">{error}</p>}
      {data && groups.length === 0 && <p className="text-sm text-muted-foreground">No groups yet. They appear as COWBOT analyzes fresh wallets.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Window
            key={g.funder}
            title={`FUNDER ${g.funder.slice(0, 4)}…${g.funder.slice(-4)} — ${g.size} wallet${g.size === 1 ? "" : "s"}`}
            icon={g.likely_exchange ? "🏦" : "👥"}
            right={<span className="text-[11px] text-white/80">newest {ago(g.newest_at)}</span>}
          >
            <div className="border-b px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span>
                  Funder: <Addr address={g.funder} />
                </span>
                {g.funder_tier && <TierBadge tier={g.funder_tier} />}
                {g.likely_exchange && <span className="text-amber">likely an exchange</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3 text-muted-foreground">
                <span className="text-cyan-300">🤖 {g.ai} AI / bot</span>
                <span className="text-sky-100">🧑 {g.human} human</span>
                <span>? {g.unknown} undecided</span>
                <span className="text-win">{g.fresh} fresh</span>
              </div>
            </div>
            <div className="divide-y">
              {g.members.map((m) => (
                <div key={m.address} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                  <Addr address={m.address} />
                  {m.is_fresh === 1 && <span className="border border-win/40 px-1 text-[10px] uppercase text-win">fresh</span>}
                  <TierBadge tier={m.tier} />
                  <KindBadge kind={m.kind} score={m.ai_score} />
                  <span className={cn("ml-auto num", pnlClass(m.pnl_30d_sol))}>{signedSol(m.pnl_30d_sol, 2)} SOL 30d</span>
                </div>
              ))}
            </div>
          </Window>
        ))}
      </div>
    </>
  );
}
