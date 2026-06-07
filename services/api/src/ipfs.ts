// Minimal IPFS pinning for proof anchoring. Pins a JSON value and returns its
// CID. Provider + token come from env:
//   IPFS_PROVIDER=pinata          PINATA_JWT (or IPFS_TOKEN)
//   IPFS_PROVIDER=web3.storage    WEB3_STORAGE_TOKEN (or IPFS_TOKEN)
// When unconfigured the proof-anchor worker skips anchoring (no-op), so this is
// safe to leave off in environments without an IPFS account.

function ipfsToken(): string | undefined {
  const provider = process.env.IPFS_PROVIDER?.trim().toLowerCase();
  if (provider === "pinata") {
    return (process.env.PINATA_JWT || process.env.IPFS_TOKEN)?.trim() || undefined;
  }
  if (provider === "web3.storage" || provider === "web3storage") {
    return (process.env.WEB3_STORAGE_TOKEN || process.env.IPFS_TOKEN)?.trim() || undefined;
  }
  return process.env.IPFS_TOKEN?.trim() || undefined;
}

export function ipfsConfigured(): boolean {
  return Boolean(process.env.IPFS_PROVIDER?.trim()) && Boolean(ipfsToken());
}

export async function pinJsonToIpfs(value: unknown): Promise<string> {
  const provider = process.env.IPFS_PROVIDER?.trim().toLowerCase();
  const token = ipfsToken();
  if (!provider || !token) throw new Error("ipfs_not_configured");

  if (provider === "pinata") {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pinataContent: value }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`pinata_pin_failed:${res.status}`);
    const json = (await res.json()) as { IpfsHash?: string };
    if (!json.IpfsHash) throw new Error("pinata_no_cid");
    return json.IpfsHash;
  }

  if (provider === "web3.storage" || provider === "web3storage") {
    const res = await fetch("https://api.web3.storage/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-name": "adjudex-proof" },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`web3storage_pin_failed:${res.status}`);
    const json = (await res.json()) as { cid?: string };
    if (!json.cid) throw new Error("web3storage_no_cid");
    return json.cid;
  }

  throw new Error(`ipfs_provider_unsupported:${provider}`);
}
