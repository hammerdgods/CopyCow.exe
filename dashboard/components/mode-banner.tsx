"use client";
import { usePoll } from "@/lib/use-poll";
import type { Summary } from "@/lib/types";

/** Win95-style warning dialog that is always honest about paper/demo mode. */
export function ModeBanner() {
  const { data } = usePoll<Summary>("/api/summary", 30_000);
  if (!data) return null;
  if (data.demo) {
    return (
      <div className="border border-amber/60 bg-amber/10 px-3 py-2 text-xs text-amber" role="status">
        ⚠ DEMO DATA — this dashboard is showing sample numbers from data/demo.db, not COWBOT&apos;s real paper record.
      </div>
    );
  }
  if (data.network === "devnet") {
    return (
      <div className="flex items-center gap-2 border border-cyan-400/50 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-200" role="status">
        <span className="bevel-out bg-w95-gray px-1 font-bold text-black">i</span>
        DEVNET TEST — COWBOT&apos;s wallet, contract and airdrops run on Solana&apos;s test network with test SOL (no real value). Trading and launches are paper, using real mainnet prices.
      </div>
    );
  }
  if (data.tradingMode === "paper") {
    return (
      <div className="flex items-center gap-2 border border-border bg-black/40 px-3 py-2 text-xs text-muted-foreground" role="status">
        <span className="bevel-out bg-w95-gray px-1 font-bold text-black">!</span>
        PAPER MODE — COWBOT trades simulated positions against live market prices. No real funds move.
        {data.launchMode === "real" ? " Token launches are LIVE." : " Token launches are simulated too."}
      </div>
    );
  }
  return null;
}
