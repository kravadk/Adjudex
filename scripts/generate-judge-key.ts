// Generate a fresh ECDSA keypair for the AI Judge V1 signer and patch
// .env.local. Testnet-only; never reuse on mainnet.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function assertTestnetOptIn() {
  if (process.env.ADJUDEX_TESTNET_ONLY !== "1") {
    throw new Error(
      "Refusing to generate a judge private key without explicit testnet opt-in. " +
        "Set ADJUDEX_TESTNET_ONLY=1 only for Arbitrum Sepolia testnet setup.",
    );
  }
}

function patch(root: string, patches: Record<string, string>) {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    throw new Error("Run from repo root with .env.local present.");
  }
  let body = readFileSync(envPath, "utf-8");
  for (const [key, value] of Object.entries(patches)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(body)) body = body.replace(re, `${key}=${value}`);
    else body += `\n${key}=${value}`;
  }
  writeFileSync(envPath, body);
}

assertTestnetOptIn();

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

console.log(`Judge address:     ${account.address}`);

patch(process.cwd(), {
  JUDGE_PRIVATE_KEY: pk,
  JUDGE_PUBLIC_ADDRESS: account.address,
});

console.log("Patched .env.local with JUDGE_PRIVATE_KEY + JUDGE_PUBLIC_ADDRESS.");
