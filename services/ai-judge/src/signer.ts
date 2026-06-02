// Mode-dependent signer for the AI judge.
//
//   server: viem privateKeyToAccount(JUDGE_PRIVATE_KEY)
//   phala: DstackClient.getKey() -> toViemAccountSecure() -> ECDSA key bound to
//          the CVM measurement; client.getQuote() emits a TDX quote whose
//          reportData = the verdict digest, binding the verdict to the
//          specific enclave that produced it.

import type { Hex, Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type Attestation = {
  quote: Hex;
  reportData: Hex;
  eventLog?: string;
};

export type SignerHandle = {
  mode: "server" | "phala";
  address: Address;
  signDigest(digest: Hex): Promise<Hex>;
  attest?(digest: Hex): Promise<Attestation | null>;
};

export async function signer(mode: "server" | "phala"): Promise<SignerHandle> {
  if (mode === "phala") return phalaSigner();
  return serverSigner();
}

function serverSigner(): SignerHandle {
  const pk = process.env.JUDGE_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    throw new Error("JUDGE_PRIVATE_KEY is required for server signer mode.");
  }
  const account = privateKeyToAccount(pk);
  return {
    mode: "server",
    address: account.address,
    async signDigest(digest) {
      return account.signMessage({ message: { raw: digest } });
    },
  };
}

async function phalaSigner(): Promise<SignerHandle> {
  const { DstackClient } = await import("@phala/dstack-sdk");
  const { toViemAccountSecure } = await import("@phala/dstack-sdk/viem");

  const endpoint = process.env.DSTACK_SIMULATOR_ENDPOINT;
  const client = endpoint ? new DstackClient(endpoint) : new DstackClient();

  const reachable = await client.isReachable().catch(() => false);
  if (!reachable) {
    throw new Error(
      "Phala mode requested but dstack socket not reachable. Configure JUDGE_REMOTE_URL or use JUDGE_MODE=server with a managed signer key.",
    );
  }

  // path = stable label so the key persists across image rebuilds with the
  // same app-id; purpose appears in the signed key-derivation chain.
  const keyResp = await client.getKey("adjudex/ai-judge", "ai-judge-signing");
  const account = toViemAccountSecure(keyResp);

  return {
    mode: "phala",
    address: account.address,
    async signDigest(digest) {
      return account.signMessage({ message: { raw: digest } });
    },
    async attest(digest) {
      // reportData = 32-byte digest, right-padded to 64 bytes.
      const padded = digest.slice(2) + "0".repeat(64);
      const reportData = (`0x${padded}`) as Hex;
      const { quote, event_log } = await client.getQuote(Buffer.from(padded, "hex"));
      return {
        quote: (quote.startsWith("0x") ? quote : `0x${quote}`) as Hex,
        reportData,
        eventLog: event_log,
      };
    },
  };
}
