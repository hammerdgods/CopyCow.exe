/** Free source: DexScreener's newest token profiles + boosted tokens on Solana. */
import { fetchJson } from "../../http";
import { isMemeable, normalizeTerm, termsFromText } from "../extract";
import type { Mention, SourceResult } from "../types";

interface Profile {
  chainId: string;
  tokenAddress: string;
  description?: string;
  totalAmount?: number;
}
interface Pair {
  baseToken: { address: string; name: string; symbol: string };
  fdv?: number;
  volume?: { h1?: number; h24?: number };
}

const API = "https://api.dexscreener.com";

export async function scanDexScreener(): Promise<SourceResult> {
  try {
    const lists = await Promise.allSettled([
      fetchJson<Profile[]>(`${API}/token-profiles/latest/v1`),
      fetchJson<Profile[]>(`${API}/token-boosts/latest/v1`),
      fetchJson<Profile[]>(`${API}/token-boosts/top/v1`),
    ]);
    const profiles = lists.flatMap((l) => (l.status === "fulfilled" ? l.value : [])).filter((p) => p.chainId === "solana");
    const byAddr = new Map<string, Profile & { hits: number }>();
    for (const p of profiles) {
      const cur = byAddr.get(p.tokenAddress);
      byAddr.set(p.tokenAddress, { ...p, ...cur, totalAmount: Math.max(cur?.totalAmount ?? 0, p.totalAmount ?? 0), hits: (cur?.hits ?? 0) + 1 });
    }
    const addrs = [...byAddr.keys()].slice(0, 60);
    const pairs: Pair[] = [];
    for (let i = 0; i < addrs.length; i += 30) {
      pairs.push(...(await fetchJson<Pair[]>(`${API}/tokens/v1/solana/${addrs.slice(i, i + 30).join(",")}`)));
    }
    const seen = new Set<string>();
    const mentions: Mention[] = [];
    for (const pair of pairs) {
      const addr = pair.baseToken.address;
      if (seen.has(addr)) continue;
      seen.add(addr);
      const prof = byAddr.get(addr);
      const weight = (prof?.hits ?? 1) + Math.min(2, (prof?.totalAmount ?? 0) / 500);
      const terms = new Set([normalizeTerm(pair.baseToken.symbol), ...termsFromText(pair.baseToken.name)]);
      for (const term of terms) {
        if (!isMemeable(term)) continue;
        mentions.push({
          term,
          source: "dexscreener",
          weight,
          solanaAdjacent: true,
          fdvUsd: pair.fdv,
          sample: `DexScreener: ${pair.baseToken.name} ($${pair.baseToken.symbol}) — ${(prof?.description ?? "").slice(0, 140)}`,
        });
      }
    }
    return { source: "dexscreener", ok: true, mentions };
  } catch (e) {
    return { source: "dexscreener", ok: false, mentions: [], note: (e as Error).message };
  }
}
