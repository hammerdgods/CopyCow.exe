"use client";
import { useState } from "react";
import { TIERS } from "@copycow/shared/tiers";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";

export default function TiersPage() {
  const [wallet, setWallet] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/tier?wallet=${encodeURIComponent(wallet.trim())}`);
      const json = await res.json();
      setResult(res.ok ? { ok: true, text: `${json.tierName} — ${Number(json.balance).toLocaleString()} $COPYCOW` } : { ok: false, text: json.error });
    } catch {
      setResult({ ok: false, text: "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const ordered = [...TIERS].reverse();
  return (
    <>
      <PageHeader title="Holder Tiers" kicker="hold more $COPYCOW → faster execution + bigger sizing" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map((t, i) => (
          <Window key={t.id} title={`${t.name.toUpperCase().replace(" ", "_")}.EXE`} icon={t.emoji} inactive={i < 2}>
            <div className="flex h-full flex-col gap-3 p-4">
              <div>
                <p className="font-pixel text-4xl leading-none text-win num">{t.minTokens >= 1_000_000 ? `${t.minTokens / 1_000_000}M+` : `${t.minTokens / 1000}K+`}</p>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">$COPYCOW</p>
              </div>
              <ul className="space-y-1.5 text-xs">
                {t.benefits.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-win" aria-hidden>
                      ▸
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <dl className="mt-auto grid grid-cols-2 gap-1 border-t pt-2 text-[11px] text-muted-foreground">
                <dt>Auto-copy</dt>
                <dd className="text-right text-foreground">{t.autoCopy ? "yes" : "alerts only"}</dd>
                <dt>Max copy size</dt>
                <dd className="text-right text-foreground">{t.maxCopySizeSol ? `${t.maxCopySizeSol} SOL` : "—"}</dd>
                <dt>Queue head start</dt>
                <dd className="text-right text-foreground">{t.autoCopy ? (t.executionDelayMs === 0 ? "first" : `+${t.executionDelayMs / 1000}s`) : "—"}</dd>
              </dl>
            </div>
          </Window>
        ))}
      </div>

      <Window title="CHECK_MY_TIER.EXE" icon="🔎" className="mt-4">
        <form onSubmit={check} className="flex flex-col gap-2 p-4 sm:flex-row">
          <label htmlFor="wallet" className="sr-only">
            Solana wallet address
          </label>
          <input
            id="wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="Paste your Solana wallet address"
            className="bevel-in min-w-0 flex-1 bg-black px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-win"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="w95-btn" disabled={busy || wallet.trim().length < 32}>
            {busy ? "Checking…" : "Check tier"}
          </button>
        </form>
        {result && <p className={`px-4 pb-4 text-sm ${result.ok ? "text-win" : "text-amber"}`}>{result.text}</p>}
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Tiers are read from your on-chain $COPYCOW balance. Every tier with 100K+ tokens is eligible for the weekly SOL airdrop.
        </p>
      </Window>
    </>
  );
}
