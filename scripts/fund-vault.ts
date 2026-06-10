// Fund the LiquidityVault with TestUSDC so createAmmMarket() can seed each new
// AMM pool's reserves (the vault transfers `seedAmount` into the pool on
// registerMarket). TestUSDC.mint is public on testnet. On-chain only.
// Run: FUND_VAULT_USDC=100000 pnpm tsx --env-file=.env.local scripts/fund-vault.ts
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const rpc = process.env.ARBITRUM_SEPOLIA_RPC_URL!;
const stake = (process.env.STAKE_TOKEN_ADDRESS || "0x5beb1dbe90d0c1faa1fa44e175f9f72fd8bcd696") as `0x${string}`;
const vault = (process.env.LIQUIDITY_VAULT_ADDRESS || "0x52c3afa0975e6b72c6b1e0cf3ac805d30b0b0b2d") as `0x${string}`;
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as Hex);
const usdc = (n: number) => BigInt(Math.round(n * 1e6));
const amount = usdc(Number(process.env.FUND_VAULT_USDC || "100000"));

const erc20Abi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const pub = createPublicClient({ chain: arbitrumSepolia, transport: http(rpc) });
const w = createWalletClient({ account, chain: arbitrumSepolia, transport: http(rpc) });

async function main() {
  const before = (await pub.readContract({ address: stake, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;
  console.log("vault:", vault, "| balance before:", Number(before) / 1e6, "USDC");
  const h = await w.writeContract({ address: stake, abi: erc20Abi, functionName: "mint", args: [vault, amount] });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log("mint:", r.status, `https://sepolia.arbiscan.io/tx/${h}`);
  const after = (await pub.readContract({ address: stake, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;
  console.log("balance after:", Number(after) / 1e6, "USDC");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e); process.exit(1); });
