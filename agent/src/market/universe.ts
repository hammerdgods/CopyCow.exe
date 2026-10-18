/**
 * COWBOT's "pasture": the top N Solana tokens by 24h volume, after
 * throwing out the junk (stablecoins, wash-traded scams, lookalike names,
 * thin liquidity).
 */
import { config } from "../config";
import { fetchTopPools, type PoolInfo } from "./geckoterminal";

// Stablecoins and SOL-staking tokens don't have momentum worth trading.
const EXCLUDED_SYMBOLS = new Set(
  [
    "USDC", "USDT", "USDG", "PYUSD", "USD1", "USDS", "USDE", "FDUSD", "DAI", "USDH", "UXD", "EURC", "USDY",
    "SUSD", "USDX", "AUSD", "USDB", "USD*", "WSOL", "JITOSOL", "MSOL", "BSOL", "JUPSOL", "INF", "BNSOL",
    "HSOL", "DSOL", "STSOL", "JSOL", "LSTSOL", "WBTC", "CBBTC", "ZBTC", "WETH",
  ],
);

/** Plain-ASCII tickers only: blocks lookalike-letter scam tokens (e.g. "ՍЅᎠТ"). */
const SAFE_SYMBOL = /^[A-Za-z0-9$._-]{1,15}$/;

export function isTradeablePool(p: PoolInfo): { ok: boolean; why?: string } {
  if (!SAFE_SYMBOL.test(p.symbol)) return { ok: false, why: "non-ASCII / lookalike symbol" };
  if (EXCLUDED_SYMBOLS.has(p.symbol.toUpperCase())) return { ok: false, why: "stablecoin / staking token" };
  if (p.priceUsd > 0.97 && p.priceUsd < 1.03 && Math.abs(p.change.h24) < 1.5) return { ok: false, why: "looks like a stablecoin" };
  if (p.liquidityUsd < config.minLiquidityUsd) return { ok: false, why: "liquidity too thin" };
  if (p.buyers24h < config.minUniqueBuyers24h) return { ok: false, why: "too few real buyers (wash trading?)" };
  if (p.priceUsd <= 0) return { ok: false, why: "no price" };
  // Wash-trading / serial-rug filters: brand-new pools, tiny market caps, and
  // tokens trading many times their own value per day are skipped.
  if (p.poolAgeHours < config.minPoolAgeHours) return { ok: false, why: `pool only ${p.poolAgeHours.toFixed(0)}h old` };
  if (p.fdvUsd < config.minMarketCapUsd) return { ok: false, why: "market cap too small" };
  if (p.volume.h24 > p.fdvUsd * config.maxVolumeToMarketCap) return { ok: false, why: "volume far above market cap (wash trading?)" };
  return { ok: true };
}

/** Tickers used by more than one token = copycats / relaunches. Skip them all. */
export function duplicateTickers(pools: PoolInfo[]): Set<string> {
  const mints = new Map<string, Set<string>>();
  for (const p of pools) {
    const k = p.symbol.toUpperCase();
    mints.set(k, (mints.get(k) ?? new Set()).add(p.mint));
  }
  return new Set([...mints].filter(([, m]) => m.size > 1).map(([k]) => k));
}

/** One entry per token (its busiest pool), sorted by 24h volume (all that pass the filters). */
export async function loadUniverse(): Promise<PoolInfo[]> {
  const pools = await fetchTopPools(8); // 160 busiest pools — enough to find ~10 that pass every filter
  const dupes = duplicateTickers(pools);
  const byMint = new Map<string, PoolInfo>();
  for (const p of pools) {
    if (dupes.has(p.symbol.toUpperCase())) continue;
    if (!isTradeablePool(p).ok) continue;
    const existing = byMint.get(p.mint);
    if (!existing || p.volume.h24 > existing.volume.h24) byMint.set(p.mint, p);
  }
  return [...byMint.values()].sort((a, b) => b.volume.h24 - a.volume.h24);
}
