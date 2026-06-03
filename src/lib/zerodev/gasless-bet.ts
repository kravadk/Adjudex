"use client";

import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseUnits,
  type Account,
  type Address,
  type Chain,
  type Transport,
  type WalletClient,
} from "viem";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_3 } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import parimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import testUsdcAbi from "@/lib/abi/TestUSDC.json";
import { robinhoodChainTestnet } from "@/lib/wagmi";

type GaslessBetInput = {
  walletClient: WalletClient;
  chainId: number;
  poolAddress: Address;
  side: "YES" | "NO";
  stakeUsd: number;
  onStep: (step: string) => void;
};

const ENTRY_POINT = getEntryPoint("0.7");
const STAKE_TOKEN = process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS as Address | undefined;
const MAX_UINT256 = 2n ** 256n - 1n;

export function isZeroDevGaslessEnabled() {
  return process.env.NEXT_PUBLIC_ZERODEV_GASLESS_ENABLED === "1";
}

export async function placeGaslessBetWithZeroDev(input: GaslessBetInput) {
  const bundlerRpc = process.env.NEXT_PUBLIC_ZERODEV_BUNDLER_RPC_URL?.trim();
  if (!bundlerRpc) {
    throw new Error("ZeroDev gasless flow requires NEXT_PUBLIC_ZERODEV_BUNDLER_RPC_URL.");
  }
  if (!input.walletClient.account) {
    throw new Error("Connected wallet account is required for ZeroDev signer.");
  }
  const walletClient = input.walletClient as WalletClient<Transport, Chain | undefined, Account>;

  const chain = chainForZeroDev(input.chainId);
  input.onStep("Creating ZeroDev validator");
  const publicClient = createPublicClient({ chain, transport: http(chain.rpcUrls.default.http[0]) });
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: walletClient,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_3,
  });

  input.onStep("Creating Kernel smart account");
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_V3_3,
  });

  input.onStep("Preparing sponsored UserOperation");
  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerRpc),
    client: publicClient,
    paymaster: process.env.NEXT_PUBLIC_ZERODEV_PAYMASTER_ENABLED === "1" ? true : undefined,
  });
  const amount = parseUnits(String(input.stakeUsd), 6);
  const callData = encodeFunctionData({
    abi: parimutuelPoolAbi,
    functionName: "bet",
    args: [input.side === "YES" ? 0 : 1, amount],
  });
  const calls = STAKE_TOKEN
    ? [
        {
          to: STAKE_TOKEN,
          value: 0n,
          data: encodeFunctionData({
            abi: testUsdcAbi,
            functionName: "approve",
            args: [input.poolAddress, MAX_UINT256],
          }),
        },
        { to: input.poolAddress, value: 0n, data: callData },
      ]
    : [{ to: input.poolAddress, value: 0n, data: callData }];

  input.onStep("Submitting ZeroDev UserOperation");
  const userOperationHash = await kernelClient.sendUserOperation({
    callData: await account.encodeCalls(calls),
  });
  input.onStep(`UserOperation submitted: ${userOperationHash}`);
  const receipt = await kernelClient.waitForUserOperationReceipt({ hash: userOperationHash });
  const transactionHash = receipt.receipt.transactionHash;
  input.onStep(`Gasless transaction confirmed: ${transactionHash}`);
  return { transactionHash, smartAccountAddress: account.address, userOperationHash };
}

function chainForZeroDev(chainId: number): Chain {
  if (chainId === robinhoodChainTestnet.id) return robinhoodChainTestnet;
  return {
    id: chainId,
    name: `Configured chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: {
      default: {
        http: [
          process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL ||
            process.env.NEXT_PUBLIC_RHC_RPC_URL ||
            "http://127.0.0.1:8545",
        ],
      },
    },
    testnet: true,
  };
}
