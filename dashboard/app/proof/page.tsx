"use client";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Window } from "@/components/window";
import { Badge } from "@/components/ui/badge";
import { usePoll } from "@/lib/use-poll";
import { dt } from "@/lib/format";
import type { ProofData, ProofRow } from "@/lib/types";

/** Recompute sha256(prev_hash + "|" + payload) in YOUR browser. */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ProofPage() {
  const [page, setPage] = useState(0);
  const { data } = usePoll<ProofData>(`/api/proof?limit=25&offset=${page * 25}`, 30_000);
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const verify = async (e: ProofRow) => {
    const h = await sha256Hex(`${e.prev_hash}|${e.payload}`);
    setChecked((c) => ({ ...c, [e.id]: h === e.hash }));
  };

  return (
    <>
      <PageHeader title="Proof Ledger" kicker="the “we can't cheat” layer">
        {data && (
          <Badge variant={data.chain.ok ? "win" : "loss"}>
            {data.chain.ok ? `chain intact · ${data.chain.checked} entries` : `chain BROKEN at #${data.chain.brokenAtId}`}
          </Badge>
        )}
      </PageHeader>
      <Window title="README.TXT" icon="❔" className="mb-4">
        <div className="space-y-2 p-4 text-xs text-muted-foreground">
          <p>
            Before COWBOT executes anything — a copy buy, a copy sell, a safety exit — it writes the decision down and stores its SHA-256
            fingerprint. Each fingerprint also includes the previous one, so the entries form a chain.
          </p>
          <p>
            Anyone can check: <code className="text-foreground">hash = sha256(prev_hash + &quot;|&quot; + payload)</code>. Editing any old trade would change its hash
            and break every hash after it. Click <span className="text-foreground">verify</span> to recompute it in your own browser.
          </p>
        </div>
      </Window>
      <Window title="PROOF.LEDGER" icon="🔏">
        <div className="divide-y">
          {(data?.entries ?? []).length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No entries yet.</p>}
          {(data?.entries ?? []).map((e) => (
            <details key={e.id} className="group px-3 py-2">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground num">#{e.id}</span>
                <Badge variant="outline">{e.kind.replace("_", " ")}</Badge>
                <span className="text-muted-foreground">{dt(e.committed_at)}</span>
                <code className="min-w-0 flex-1 truncate text-win">{e.hash}</code>
                <button
                  className="w95-btn !text-sm"
                  onClick={(ev) => {
                    ev.preventDefault();
                    void verify(e);
                  }}
                >
                  verify
                </button>
                {checked[e.id] !== undefined && <Badge variant={checked[e.id] ? "win" : "loss"}>{checked[e.id] ? "✓ match" : "✗ mismatch"}</Badge>}
              </summary>
              <div className="mt-2 space-y-1 text-[11px]">
                <p className="text-muted-foreground">
                  prev_hash: <code className="break-all">{e.prev_hash}</code>
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-black p-2 text-foreground">{e.payload}</pre>
              </div>
            </details>
          ))}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
          <button className="w95-btn !text-sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ◀ newer
          </button>
          <span className="text-muted-foreground">
            page {page + 1} / {Math.max(1, Math.ceil((data?.total ?? 0) / 25))}
          </span>
          <button className="w95-btn !text-sm" disabled={(page + 1) * 25 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>
            older ▶
          </button>
        </div>
      </Window>
    </>
  );
}
