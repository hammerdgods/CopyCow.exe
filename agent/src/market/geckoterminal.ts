/**
 * GeckoTerminal — free, no API key. Gives us Solana's busiest trading
 * pools with price, % change (5m/15m/1h...), volume and liquidity.
 * Free limit is ~30 requests/minute; COWBOT uses ~3 per cycle.
 */
import { fetchJson } from "../http";

const BASE = "https://api.geckoterminal.com/api/v2";

type Windowed = { m5?: string; m15?: string; m30?: string; h1?: string; h6?: string; h24?: string };

interface GtPool {
  id: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd: string | null;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    reserve_in_usd: string | null;
    price_change_percentage: Windowed;
    volume_usd: Windowed;
    transactions: Record<string, { buys: number; sells: number; buyers?: number; sellers?: number }>;
  };
  relationships: {
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
    dex?: { data: { id: string } };
  };
}

export interface PoolInfo {
  mint: string;
  symbol: string;
  quoteSymbol: string;
  poolAddress: string;
  dex: string;
  priceUsd: number;
  change: { m5: number; m15: number; m30: number; h1: number; h6: number; h24: number };
  volume: { m5: number; m15: number; h1: number; h6: number; h24: number };
  liquidityUsd: number;
  fdvUsd: number;
  buyers24h: number;
  txM15: { buys: number; sells: number };
}

const num = (v: string | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toPoolInfo(p: GtPool): PoolInfo {
  const a = p.attributes;
  const [baseSym = "?", quoteSym = "?"] = a.name.split(" / ");
  return {
    mint: p.relationships.base_token.data.id.replace(/^solana_/, ""),
    symbol: baseSym.trim(),
    quoteSymbol: quoteSym.trim(),
    poolAddress: a.address,
    dex: p.relationships.dex?.data.id ?? "unknown",
    priceUsd: num(a.base_token_price_usd),
    change: {
      m5: num(a.price_change_percentage.m5),
      m15: num(a.price_change_percentage.m15),
      m30: num(a.price_change_percentage.m30),
      h1: num(a.price_change_percentage.h1),
      h6: num(a.price_change_percentage.h6),
      h24: num(a.price_change_percentage.h24),
    },
    volume: {
      m5: num(a.volume_usd.m5),
      m15: num(a.volume_usd.m15),
      h1: num(a.volume_usd.h1),
      h6: num(a.volume_usd.h6),
      h24: num(a.volume_usd.h24),
    },
    liquidityUsd: num(a.reserve_in_usd),
    fdvUsd: num(a.fdv_usd ?? a.market_cap_usd),
    buyers24h: a.transactions?.h24?.buyers ?? 0,
    txM15: { buys: a.transactions?.m15?.buys ?? 0, sells: a.transactions?.m15?.sells ?? 0 },
  };
}

/** Solana pools sorted by 24h volume (20 per page). */
export async function fetchTopPools(pages = 3): Promise<PoolInfo[]> {
  const out: PoolInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const res = await fetchJson<{ data: GtPool[] }>(
      `${BASE}/networks/solana/pools?sort=h24_volume_usd_desc&page=${page}`,
      { retries: 2 },
    );
    out.push(...res.data.map(toPoolInfo));
  }
  return out;
}

/** GeckoTerminal's "trending" Solana pools — used by the trend scanner. */
export async function fetchTrendingPools(): Promise<PoolInfo[]> {
  const res = await fetchJson<{ data: GtPool[] }>(`${BASE}/networks/solana/trending_pools?page=1`);
  return res.data.map(toPoolInfo);
}

/** Pools for specific tokens (used to price open positions that left the top list). */
export async function fetchTokenPools(mints: string[]): Promise<Map<string, PoolInfo>> {
  const map = new Map<string, PoolInfo>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const res = await fetchJson<{ data: { id: string; attributes: { address: string; price_usd: string | null } }[] }>(
      `${BASE}/networks/solana/tokens/multi/${chunk.join(",")}`,
    );
    for (const t of res.data) {
      const price = num(t.attributes.price_usd);
      if (price > 0) {
        map.set(t.attributes.address, {
          mint: t.attributes.address,
          symbol: "",
          quoteSymbol: "",
          poolAddress: "",
          dex: "",
          priceUsd: price,
          change: { m5: 0, m15: 0, m30: 0, h1: 0, h6: 0, h24: 0 },
          volume: { m5: 0, m15: 0, h1: 0, h6: 0, h24: 0 },
          liquidityUsd: 0,
          fdvUsd: 0,
          buyers24h: 0,
          txM15: { buys: 0, sells: 0 },
        });
      }
    }
  }
  return map;
}
