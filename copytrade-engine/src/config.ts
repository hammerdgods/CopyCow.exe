import { envNum, envStr, loadEnv } from "@copycow/shared/env";
loadEnv();

export const engineConfig = {
  port: envNum("ENGINE_PORT", 8787),
  pollSeconds: envNum("ENGINE_POLL_SECONDS", 10),
  /** Performance fee on PROFITABLE copied trades, in basis points (500 = 5%). Goes through the 10/90 splitter. */
  perfFeeBps: Math.min(2000, envNum("COPYTRADE_PERF_FEE_BPS", 500)),
  copycowMint: envStr("COPYCOW_MINT"),
  rpcUrl: envStr("SOLANA_RPC_URL") ||
    (envStr("HELIUS_API_KEY") ? `https://mainnet.helius-rpc.com/?api-key=${envStr("HELIUS_API_KEY")}` : "https://api.mainnet-beta.solana.com"),
  slippageBps: envNum("COPYTRADE_SLIPPAGE_BPS", 100),
};
