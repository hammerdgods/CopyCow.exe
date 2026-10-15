import { NextResponse, type NextRequest } from "next/server";
import { tierForBalance } from "@copycow/shared/tiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Looks up a wallet's $COPYCOW balance on Solana and returns its tier. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return NextResponse.json({ error: "Enter a valid Solana wallet address." }, { status: 400 });
  const mint = process.env.COPYCOW_MINT?.trim();
  if (!mint) return NextResponse.json({ error: "$COPYCOW hasn't launched yet — tier checks go live at launch.", notLaunched: true }, { status: 503 });
  const rpc = process.env.SOLANA_RPC_URL?.trim() ||
    (process.env.HELIUS_API_KEY?.trim() ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY.trim()}` : "https://api.mainnet-beta.solana.com");
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [wallet, { mint }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { result?: { value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[] }; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    const balance = (json.result?.value ?? []).reduce((s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
    const tier = tierForBalance(balance);
    return NextResponse.json({ wallet, balance, tier: tier.id, tierName: tier.name, benefits: tier.benefits });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't reach Solana: ${(e as Error).message}` }, { status: 502 });
  }
}
