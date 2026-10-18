"use client";
import { useState } from "react";
import { solscanAccount } from "@/lib/format";
import type { Summary } from "@/lib/types";

export function WalletCard({ s }: { s: Summary }) {
  const [copied, setCopied] = useState(false);
  const pk = s.wallet.pubkey;
  return (
    <div className="space-y-2 p-3 text-xs">
      <p className="text-muted-foreground">COWBOT&apos;s dedicated Solana wallet. Every decision is hashed before it executes — see the Proof Ledger.</p>
      {pk ? (
        <>
          <code className="block break-all bg-black p-2 text-[11px] text-win">{pk}</code>
          <div className="flex flex-wrap gap-2">
            <button
              className="w95-btn !text-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(pk);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <a className="w95-btn !text-sm" href={solscanAccount(pk, s.network)} target="_blank" rel="noreferrer">
              Solscan ↗
            </a>
          </div>
          <p className="text-muted-foreground">
            On-chain balance: <span className="text-foreground num">{s.wallet.balanceSol === null ? "—" : `${s.wallet.balanceSol.toFixed(4)} ${s.network === "devnet" ? "test SOL (devnet)" : "SOL"}`}</span>
            {s.tradingMode === "paper" && " · trading identity is paper"}
          </p>
        </>
      ) : (
        <p className="text-amber">Wallet not created yet — start the agent once (npm run agent).</p>
      )}
    </div>
  );
}
