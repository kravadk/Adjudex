// One-shot: register this MM agent in the ReputationOracle ERC-8004 registry.
// Idempotent — if already registered, prints the agentId and exits.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { abis, config } from "./config.js";

async function main() {
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);
  const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport });
  const pub = createPublicClient({ chain: arbitrumSepolia, transport });

  const agentId = keccak256(stringToBytes(config.handle));
  console.log(`Agent wallet: ${account.address}`);
  console.log(`Handle:       ${config.handle}`);
  console.log(`agentId:      ${agentId}`);

  const existing = (await pub.readContract({
    address: config.oracle,
    abi: abis.oracle,
    functionName: "getAgent",
    args: [agentId],
  })) as readonly [string, string, bigint];

  if (existing[0] !== "0x0000000000000000000000000000000000000000") {
    console.log(`Already registered (wallet=${existing[0]}, handle=${existing[1]}).`);
    return;
  }

  const hash = await wallet.writeContract({
    address: config.oracle,
    abi: abis.oracle,
    functionName: "registerAgent",
    args: [config.handle],
  });
  console.log(`registerAgent tx: ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("registerAgent reverted");
  console.log(`Registered`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
