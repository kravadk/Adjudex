// Bootstrap the MM agent: generate keypair, patch .env.local, fund with
// testnet ETH and tUSDC, and register the agent in ReputationOracle.
// Idempotent: re-runs are safe.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  stringToBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

function assertTestnetOptIn() {
  if (process.env.PARIAI_TESTNET_ONLY !== "1") {
    throw new Error(
      "Refusing to generate/fund a market-maker test wallet without explicit testnet opt-in. " +
        "Set PARIAI_TESTNET_ONLY=1 only for Arbitrum Sepolia testnet setup.",
    );
  }
}

function patch(root: string, patches: Record<string, string>) {
  const envPath = join(root, ".env.local");
  let body = readFileSync(envPath, "utf-8");
  for (const [key, value] of Object.entries(patches)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(body)) body = body.replace(re, `${key}=${value}`);
    else body += `\n${key}=${value}`;
  }
  writeFileSync(envPath, body);
}

async function main() {
  assertTestnetOptIn();

  const root = process.cwd();
  const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const usdcAddress = process.env.STAKE_TOKEN_ADDRESS as Address | undefined;
  const oracleAddress = process.env.REPUTATION_ORACLE_ADDRESS as Address | undefined;
  const handle = process.env.MM_AGENT_HANDLE ?? "halcyon-mm-#0001";

  if (!rpcUrl || !deployerKey || !usdcAddress || !oracleAddress) {
    throw new Error(
      "Missing env: ARBITRUM_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, STAKE_TOKEN_ADDRESS, REPUTATION_ORACLE_ADDRESS",
    );
  }

  const deployer = privateKeyToAccount(deployerKey);

  const chain = arbitrumSepolia;
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain, transport });
  const chainId = await pub.getChainId();
  if (chainId !== arbitrumSepolia.id) {
    throw new Error(
      `Refusing test token funding/minting on chain ${chainId}; expected Arbitrum Sepolia (${arbitrumSepolia.id}).`,
    );
  }

  let mmKey = process.env.MM_AGENT_PRIVATE_KEY as Hex | undefined;
  if (!mmKey || mmKey.length < 10) {
    mmKey = generatePrivateKey();
    patch(root, { MM_AGENT_PRIVATE_KEY: mmKey });
    console.log("Generated new MM_AGENT_PRIVATE_KEY -> .env.local");
  }
  const mm = privateKeyToAccount(mmKey);
  const deployerWallet = createWalletClient({ account: deployer, chain, transport });
  const mmWallet = createWalletClient({ account: mm, chain, transport });

  console.log(`MM agent wallet: ${mm.address}`);
  console.log(`Handle:          ${handle}`);

  const ethBal = await pub.getBalance({ address: mm.address });
  console.log(`ETH balance:     ${Number(ethBal) / 1e18}`);
  if (ethBal < 1_000_000_000_000_000n) {
    console.log("Funding 0.005 ETH from deployer...");
    const tx = await deployerWallet.sendTransaction({
      to: mm.address,
      value: parseEther("0.005"),
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`  funded: ${tx}`);
  }

  const usdcAbi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "TestUSDC.json"), "utf-8"),
  ) as Abi;
  const usdcBal = (await pub.readContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [mm.address],
  })) as bigint;
  console.log(`tUSDC balance:   ${Number(usdcBal) / 1e6}`);
  if (usdcBal < 1_000_000_000n) {
    console.log("Minting 10,000 tUSDC to MM...");
    const tx = await mmWallet.writeContract({
      address: usdcAddress,
      abi: usdcAbi,
      functionName: "mint",
      args: [mm.address, 10_000_000_000n],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`  minted: ${tx}`);
  }

  const oracleAbi = JSON.parse(
    readFileSync(join(root, "src", "lib", "abi", "ReputationOracle.json"), "utf-8"),
  ) as Abi;
  const agentId = keccak256(stringToBytes(handle));
  console.log(`agentId:         ${agentId}`);
  const existing = (await pub.readContract({
    address: oracleAddress,
    abi: oracleAbi,
    functionName: "getAgent",
    args: [agentId],
  })) as readonly [string, string, bigint];
  if (existing[0] === "0x0000000000000000000000000000000000000000") {
    console.log("Registering in ReputationOracle...");
    const tx = await mmWallet.writeContract({
      address: oracleAddress,
      abi: oracleAbi,
      functionName: "registerAgent",
      args: [handle],
    });
    await pub.waitForTransactionReceipt({ hash: tx });
    console.log(`  registered: ${tx}`);
  } else {
    console.log(`Already registered (wallet=${existing[0]}).`);
  }

  console.log("\nReady. Start the loop:\n  pnpm --filter @adjudex/mm-agent dev");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
