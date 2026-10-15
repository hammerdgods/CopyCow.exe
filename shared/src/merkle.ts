/**
 * Merkle tree for the weekly airdrop. One small "root" fingerprint on-chain
 * commits to the full list of (wallet, amount) payouts. The relayer then
 * pushes SOL to each wallet with a short proof — holders never click claim.
 *
 * MUST match contracts/programs/dividend_airdrop/src/lib.rs exactly:
 *   leaf = sha256(0x00 || epoch u64 LE || index u32 LE || wallet 32 bytes || amount u64 LE)
 *   node = sha256(0x01 || smaller(a,b) || larger(a,b))
 */
import { createHash } from "node:crypto";
import bs58 from "bs58";

export interface AirdropLeafInput {
  index: number;
  wallet: string; // base58 public key
  amountLamports: bigint;
}

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

const u64le = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u32le = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

export function airdropLeaf(epoch: bigint, leaf: AirdropLeafInput): Buffer {
  const wallet = bs58.decode(leaf.wallet);
  if (wallet.length !== 32) throw new Error(`bad wallet address: ${leaf.wallet}`);
  return sha256(Buffer.from([0]), u64le(epoch), u32le(leaf.index), wallet, u64le(leaf.amountLamports));
}

function hashPair(a: Buffer, b: Buffer): Buffer {
  return Buffer.compare(a, b) <= 0 ? sha256(Buffer.from([1]), a, b) : sha256(Buffer.from([1]), b, a);
}

export interface MerkleTree {
  root: Buffer;
  proofs: Buffer[][];
}

/** Builds the tree; proofs[i] is the proof for leaves[i]. */
export function buildMerkleTree(leaves: Buffer[]): MerkleTree {
  if (leaves.length === 0) return { root: Buffer.alloc(32), proofs: [] };
  const layers: Buffer[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const proofs = leaves.map((_, leafIdx) => {
    const proof: Buffer[] = [];
    let idx = leafIdx;
    for (let l = 0; l < layers.length - 1; l++) {
      const sibling = idx ^ 1;
      if (sibling < layers[l].length) proof.push(layers[l][sibling]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  });
  return { root: layers[layers.length - 1][0], proofs };
}

export function verifyMerkleProof(leaf: Buffer, proof: Buffer[], root: Buffer): boolean {
  let node = leaf;
  for (const p of proof) node = hashPair(node, p);
  return node.equals(root);
}
