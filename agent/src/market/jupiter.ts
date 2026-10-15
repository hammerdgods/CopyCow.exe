/**
 * Jupiter — Solana's main swap router. Free "lite" API, no key needed
 * (an optional key from https://station.jup.ag/ / portal.jup.ag uses the pro host).
 *  - price():  current USD prices for many tokens at once
 *  - quote():  "if I swapped X for Y right now, what would I get?" —
 *              used to simulate realistic paper fills (incl. price impact)
 */
import { config } from "../config";
import { fetchJson } from "../http";

const host = () => (config.jupiterApiKey ? "https://api.jup.ag" : "https://lite-api.jup.ag");
const headers = (): Record<string, string> => (config.jupiterApiKey ? { "x-api-key": config.jupiterApiKey } : {});

export interface JupPrice {
  usdPrice: number;
  decimals: number;
  liquidity?: number;
  priceChange24h?: number;
}

export async function jupiterPrices(mints: string[]): Promise<Map<string, JupPrice>> {
  const map = new Map<string, JupPrice>();
  for (let i = 0; i < mints.length; i += 50) {
    const chunk = mints.slice(i, i + 50);
    const res = await fetchJson<Record<string, JupPrice | null>>(`${host()}/price/v3?ids=${chunk.join(",")}`, {
      headers: headers(),
    });
    for (const [mint, p] of Object.entries(res)) if (p && p.usdPrice > 0) map.set(mint, p);
  }
  return map;
}

export interface JupQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
}

export async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amountAtomic: bigint,
  slippageBps = 50,
): Promise<JupQuote> {
  const url = `${host()}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountAtomic}&slippageBps=${slippageBps}`;
  return fetchJson<JupQuote>(url, { headers: headers(), retries: 0 });
}
