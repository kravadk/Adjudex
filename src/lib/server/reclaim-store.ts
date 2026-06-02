import { requireBackendUrl } from "./backend-api";

export type StoredProof = {
  sessionId: string;
  providerId: string;
  proof: unknown;
  proofHash: `0x${string}`;
  marketId?: string;
  sourceUrl?: string;
  chainId?: number;
  poolAddress?: string;
  walletAddress?: string;
  verifiedAtIso: string;
};

function requireProofStoreSecret(action: "persist verified Reclaim proofs" | "read verified Reclaim proofs") {
  const secret = process.env.RECLAIM_PROOF_WRITE_SECRET;
  if (!secret) {
    throw new Error(`RECLAIM_PROOF_WRITE_SECRET is required to ${action}`);
  }
  return secret;
}

export async function putProof(entry: {
  sessionId: string;
  providerId: string;
  proof: unknown;
}): Promise<StoredProof> {
  const secret = requireProofStoreSecret("persist verified Reclaim proofs");
  const response = await fetch(`${requireBackendUrl()}/api/reclaim/proofs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pariai-internal-secret": secret,
    },
    body: JSON.stringify(entry),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`reclaim proof backend write failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as StoredProof;
}

export async function getProof(sessionId: string): Promise<StoredProof | null> {
  const secret = requireProofStoreSecret("read verified Reclaim proofs");
  const response = await fetch(`${requireBackendUrl()}/api/reclaim/proofs/${encodeURIComponent(sessionId)}`, {
    headers: {
      "x-pariai-internal-secret": secret,
    },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`reclaim proof backend read failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as StoredProof;
}
