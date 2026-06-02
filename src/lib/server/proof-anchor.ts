// Writes Reclaim proof anchors to the on-chain ProofAnchor contract.
//
// Called from the Reclaim callback after the proof has been verified and
// pinned. Anchor calls are best-effort — a missing env (e.g. no anchor
// wallet key on the dev box) downgrades the response to "pinned but not
// anchored" without breaking the verify path.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import proofAnchorAbi from "@/lib/abi/ProofAnchor.json";

export type AnchorResult = {
  sessionId: string;
  sessionIdHash: Hex;
  proofHash: Hex;
  cid: string;
  cidBytes: Hex;
  txHash: Hex;
};

export type AnchorSkippedReason =
  | "missing-address"
  | "missing-key"
  | "missing-rpc"
  | "already-anchored";

export type AnchorOutcome =
  | { anchored: true; result: AnchorResult }
  | { anchored: false; reason: AnchorSkippedReason; detail?: string };

export async function anchorProof(input: {
  sessionId: string;
  proofHash: Hex;
  cid: string;
}): Promise<AnchorOutcome> {
  const address = process.env.NEXT_PUBLIC_PROOF_ANCHOR_ADDRESS as
    | Address
    | undefined;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return { anchored: false, reason: "missing-address" };
  }
  const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
  if (!rpcUrl) return { anchored: false, reason: "missing-rpc" };
  const privateKey = process.env.PROOF_ANCHOR_DEPLOYER_KEY as Hex | undefined;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return { anchored: false, reason: "missing-key" };
  }

  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
  const sessionIdHash = keccak256(stringToBytes(input.sessionId));

  // Skip if someone already anchored this sessionId — the contract would
  // revert with "anchored" and waste gas + log noise.
  try {
    const existing = (await publicClient.readContract({
      address,
      abi: proofAnchorAbi,
      functionName: "isAnchored",
      args: [input.sessionId],
    })) as boolean;
    if (existing) {
      return { anchored: false, reason: "already-anchored" };
    }
  } catch {
    // Read failure shouldn't block the write attempt — fall through.
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport,
  });

  const cidBytes = toHex(stringToBytes(input.cid));
  const txHash = await walletClient.writeContract({
    address,
    abi: proofAnchorAbi,
    functionName: "anchor",
    args: [input.sessionId, input.proofHash, cidBytes],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    anchored: true,
    result: {
      sessionId: input.sessionId,
      sessionIdHash,
      proofHash: input.proofHash,
      cid: input.cid,
      cidBytes,
      txHash,
    },
  };
}
