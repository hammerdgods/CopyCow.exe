"use client";
import { usePoll } from "@/lib/use-poll";
import type { Summary } from "@/lib/types";

/** Always honest about whether real money is moving. */
export function ModeBanner() {
  const { data } = usePoll<Summary>("/api/summary", 30_000);
  if (!data) return null;
  if (data.paused) {
    return (
      <div className="border border-amber/60 bg-amber/10 px-3 py-2 text-xs text-amber" role="status">
        ⏸ COPYING PAUSED — COWBOT isn&apos;t opening new positions. It still follows leaders&apos; sells and its own stop-losses.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border border-border bg-black/40 px-3 py-2 text-xs text-muted-foreground" role="status">
      <span className="bevel-out bg-w95-gray px-1 font-bold text-black">!</span>
      {data.copyMode === "real"
        ? "REAL MONEY — COWBOT copies trades with real SOL from its own wallet. Memecoins are extremely risky; past profit of any wallet says nothing about the future."
        : "PAPER MODE — copy trades are simulated with live Jupiter quotes. No real funds move."}
    </div>
  );
}
