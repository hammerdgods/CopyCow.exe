import { Connection } from "@solana/web3.js";
import { mainnetRpcUrl, rpcUrl } from "./config";

let conn: Connection | null = null;
export function connection(): Connection {
  if (!conn) conn = new Connection(rpcUrl(), "confirmed");
  return conn;
}

let market: Connection | null = null;
/** Mainnet connection for MARKET data (token decimals) — even when COWBOT acts on devnet. */
export function marketConnection(): Connection {
  if (!market) market = new Connection(mainnetRpcUrl(), "confirmed");
  return market;
}
