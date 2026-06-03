"use client";

import { getWalletClient, readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { parseUnits, type Address } from "viem";
import parimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import testUsdcAbi from "@/lib/abi/TestUSDC.json";
import { getServices } from "@/lib/services/provider";
import type { BetPreviewInput } from "@/lib/types/domain";
import { useMarketsStore, usePortfolioStore, useUserStore } from "@/lib/store";
import { wagmiConfig } from "@/lib/wagmi";
import { isZeroDevGaslessEnabled, placeGaslessBetWithZeroDev } from "@/lib/zerodev/gasless-bet";

const STAKE_TOKEN = process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS as Address | undefined;
const MAX_UINT256 = 2n ** 256n - 1n;
type SupportedChainId = (typeof wagmiConfig.chains)[number]["id"];

export function useBet() {
  const account = useUserStore((state) => state.account);
  const refreshMarkets = useMarketsStore((state) => state.refresh);
  const refreshPortfolio = usePortfolioStore((state) => state.refresh);

  async function placeBet(input: Omit<BetPreviewInput, "address">, onStep: (step: string) => void = () => undefined) {
    if (!account) throw new Error("Connect wallet before placing a bet.");
    onStep("Preparing backend quote");
    const services = getServices();
    const quote = await services.betService.previewBet({
      ...input,
      address: account.address,
    });
    const market = useMarketsStore.getState().markets.find((item) => item.id === input.marketId);
    if (!market?.poolAddress) throw new Error("Market pool address is required for on-chain bet placement.");
    if (!market.chainId) throw new Error("Market chain id is required for on-chain bet placement.");
    if (!isSupportedChainId(market.chainId)) {
      throw new Error(`Market chain ${market.chainId} is not configured in the wallet client.`);
    }
    const chainId = market.chainId;

    const amount = parseUnits(String(input.stakeUsd), 6);

    const useGasless = isZeroDevGaslessEnabled();
    if (STAKE_TOKEN && !useGasless) {
      onStep("Checking USDC allowance");
      const allowance = (await readContract(wagmiConfig, {
        address: STAKE_TOKEN,
        abi: testUsdcAbi,
        functionName: "allowance",
        args: [account.address as Address, market.poolAddress],
        chainId,
      })) as bigint;
      if (allowance < amount) {
        onStep("Approving USDC spend");
        const approveHash = await writeContract(wagmiConfig, {
          address: STAKE_TOKEN,
          abi: testUsdcAbi,
          functionName: "approve",
          args: [market.poolAddress, MAX_UINT256],
          chainId,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId });
      }
    }

    onStep("Reading next on-chain position id");
    const positionId = await readContract(wagmiConfig, {
      address: market.poolAddress,
      abi: parimutuelPoolAbi,
      functionName: "nextPositionId",
      chainId,
    });
    let transactionHash: `0x${string}`;
    let bettorAddress = account.address;
    if (useGasless) {
      onStep("Using ZeroDev gasless smart account");
      const walletClient = await getWalletClient(wagmiConfig, { chainId });
      const gasless = await placeGaslessBetWithZeroDev({
        walletClient,
        chainId,
        poolAddress: market.poolAddress,
        side: input.side,
        stakeUsd: input.stakeUsd,
        onStep,
      });
      transactionHash = gasless.transactionHash;
      bettorAddress = gasless.smartAccountAddress;
    } else {
      onStep("Waiting for wallet signature");
      transactionHash = await writeContract(wagmiConfig, {
        address: market.poolAddress,
        abi: parimutuelPoolAbi,
        functionName: "bet",
        args: [input.side === "YES" ? 0 : 1, amount],
        chainId,
      });
      onStep(`Transaction submitted: ${transactionHash}`);
      onStep("Confirming transaction");
      await waitForTransactionReceipt(wagmiConfig, { hash: transactionHash, chainId });
    }

    onStep("Recording confirmed transaction in backend");
    const receipt = await services.betService.placeBet({
      ...quote,
      address: bettorAddress,
      transactionHash,
      positionId: `${market.id}#${String(positionId)}`,
      chainId,
    });
    onStep("Refreshing indexed market and portfolio state");
    await refreshMarkets();
    await refreshPortfolio(account.address);
    return receipt;
  }

  return { placeBet };
}

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}
