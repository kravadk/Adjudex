// IPFS pinning shim — pins arbitrary JSON to IPFS via a configurable
// provider and returns the resulting CID.
//
// Provider is selected by IPFS_PROVIDER env:
//   - "pinata"      → POST https://api.pinata.cloud/pinning/pinJSONToIPFS
//                      Needs PINATA_JWT.
//   - "web3storage" → POST https://api.web3.storage/upload
//                      Needs WEB3_STORAGE_TOKEN.
//   - "kubo"        → POST {IPFS_API_URL}/api/v0/add
//                      Defaults IPFS_API_URL to http://127.0.0.1:5001 for
//                      local kubo nodes.
//   - "stub"        → deterministic local pseudo-CID derived from keccak256
//                      so dev environments can run end-to-end without a
//                      real IPFS node. Marked clearly as `localcid-...`.
//
// `pinJson()` always returns a string CID. Real providers return CIDv0 or
// CIDv1 strings; the stub provider returns `localcid-{hex}` so it cannot
// be mistaken for a real CID by an indexer or end-user.

import { keccak256, stringToBytes } from "viem";

type PinResult = { cid: string };

function provider(): string {
  return (process.env.IPFS_PROVIDER ?? "stub").toLowerCase();
}

export async function pinJson(payload: unknown): Promise<PinResult> {
  const canonical = JSON.stringify(payload);
  const p = provider();
  // Defence-in-depth: even if the env validator is bypassed, stub provider
  // must never run in production (it returns a pseudo-CID that does NOT
  // resolve on the public IPFS network — anchoring such a CID on-chain
  // would silently break proof retrievability).
  if (process.env.NODE_ENV === "production" && (p === "stub" || p === "")) {
    throw new Error(
      "IPFS_PROVIDER=stub is forbidden in NODE_ENV=production. Set IPFS_PROVIDER to pinata/web3storage/kubo and configure the credential env (PINATA_JWT / WEB3_STORAGE_TOKEN / IPFS_API_URL).",
    );
  }
  switch (p) {
    case "pinata":
      return pinViaPinata(canonical);
    case "web3storage":
      return pinViaWeb3Storage(canonical);
    case "kubo":
      return pinViaKubo(canonical);
    case "stub":
    case "":
      return pinViaStub(canonical);
    default:
      throw new Error(`Unsupported IPFS_PROVIDER: ${p}`);
  }
}

async function pinViaPinata(body: string): Promise<PinResult> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is required when IPFS_PROVIDER=pinata");
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { IpfsHash?: string };
  if (!json.IpfsHash) throw new Error("Pinata returned no IpfsHash");
  return { cid: json.IpfsHash };
}

async function pinViaWeb3Storage(body: string): Promise<PinResult> {
  const token = process.env.WEB3_STORAGE_TOKEN;
  if (!token) throw new Error("WEB3_STORAGE_TOKEN is required when IPFS_PROVIDER=web3storage");
  const res = await fetch("https://api.web3.storage/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`web3.storage pin failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { cid?: string };
  if (!json.cid) throw new Error("web3.storage returned no cid");
  return { cid: json.cid };
}

async function pinViaKubo(body: string): Promise<PinResult> {
  const apiUrl = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001";
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/json" }));
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v0/add?pin=true&cid-version=1`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`kubo pin failed: ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  // kubo replies with newline-delimited JSON per file. Take the first line.
  const first = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  const json = JSON.parse(first) as { Hash?: string };
  if (!json.Hash) throw new Error("kubo returned no Hash");
  return { cid: json.Hash };
}

function pinViaStub(body: string): PinResult {
  // Deterministic stand-in. Same payload → same pseudo-CID, so callers
  // can dedupe and the local indexer can correlate ProofAnchored events
  // even without a real network.
  const hash = keccak256(stringToBytes(body));
  return { cid: `localcid-${hash.slice(2)}` };
}
