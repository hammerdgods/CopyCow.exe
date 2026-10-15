// Same Merkle format as shared/src/merkle.ts and the on-chain program.
import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

const sha256 = (...parts: Buffer[]) => {
  const h = createHash("sha256");
  parts.forEach((p) => h.update(p));
  return h.digest();
};

export function leaf(epoch: bigint, index: number, wallet: PublicKey, amount: bigint): Buffer {
  const e = Buffer.alloc(8);
  e.writeBigUInt64LE(epoch);
  const i = Buffer.alloc(4);
  i.writeUInt32LE(index);
  const a = Buffer.alloc(8);
  a.writeBigUInt64LE(amount);
  return sha256(Buffer.from([0]), e, i, wallet.toBuffer(), a);
}

const pair = (a: Buffer, b: Buffer) => (Buffer.compare(a, b) <= 0 ? sha256(Buffer.from([1]), a, b) : sha256(Buffer.from([1]), b, a));

export function tree(leaves: Buffer[]): { root: Buffer; proofs: Buffer[][] } {
  const layers = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const proofs = leaves.map((_, li) => {
    const proof: Buffer[] = [];
    let idx = li;
    for (let l = 0; l < layers.length - 1; l++) {
      if ((idx ^ 1) < layers[l].length) proof.push(layers[l][idx ^ 1]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  });
  return { root: layers[layers.length - 1][0], proofs };
}
