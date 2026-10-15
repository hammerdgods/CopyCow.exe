/** Free source: GeckoTerminal's trending Solana pools. */
import { fetchTrendingPools } from "../../market/geckoterminal";
import { isMemeable, normalizeTerm } from "../extract";
import type { SourceResult } from "../types";

export async function scanGeckoTerminal(): Promise<SourceResult> {
  try {
    const pools = await fetchTrendingPools();
    const mentions = pools
      .map((p) => ({ p, term: normalizeTerm(p.symbol) }))
      .filter(({ term }) => isMemeable(term))
      .map(({ p, term }) => ({
        term,
        source: "geckoterminal" as const,
        weight: 1 + Math.min(2, p.volume.h1 / 250_000), // hotter pools count a bit more
        solanaAdjacent: true,
        fdvUsd: p.fdvUsd,
        sample: `GeckoTerminal trending: ${p.symbol} / ${p.quoteSymbol} · 1h ${p.change.h1.toFixed(1)}% · FDV $${Math.round(p.fdvUsd).toLocaleString()}`,
      }));
    return { source: "geckoterminal", ok: true, mentions };
  } catch (e) {
    return { source: "geckoterminal", ok: false, mentions: [], note: (e as Error).message };
  }
}
