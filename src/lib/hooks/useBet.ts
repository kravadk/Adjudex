"use client";

import { getWalletClient, readContract, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { parseUnits, type Address } from "viem";
import parimutuelPoolAbi from "@/lib/abi/ParimutuelPool.json";
import testUsdcAbi from "@/lib/abi/TestUSDC.json";
import { getServices } from "@/lib/services/provider";
import type { BetPreviewInput } from "@/lib/types/domain";
import { useMarketsStore, usePortfolioStore, useUserStore } from "@/lib/store";
import { wagmiConfig } from "@/lib/wagmi";
import { isZeroDevGaslessEnabled, placeGaslessBetWithZeroDev } from "@/lib/zerodev/gasless-bet";
import { stakeTokenForChain } from "@/lib/stake-token";

const MAX_UINT256 = 2n ** 256n - 1n;
type SupportedChainId = (typeof wagmiConfig.chains)[number]["id"];

export function useBet() {
  const account = useUserStore((state) => state.account);
  const refreshMarkets = useMarketsStore((state) => state.refresh);
  const refreshPortfolio = usePortfolioStore((state) => state.refresh);

  async function placeBet(
    input: Omit<BetPreviewInput, "address"> & { poolAddress?: Address; chainId?: number },
    onStep: (step: string) => void = () => undefined,
    opts: { gasless?: boolean } = {},
  ) {
    if (!account) throw new Error("Connect wallet before placing a bet.");
    onStep("Preparing backend quote");
    const services = getServices();
    const quote = await services.betService.previewBet({
      ...input,
      address: account.address,
    });
    // Resolve pool/chain from the caller first (the market detail page passes
    // them directly) and fall back to the markets store, so betting works even
    // when the store isn't populated — e.g. a direct load of /market/:id.
    const storeMarket = useMarketsStore.getState().markets.find((item) => item.id === input.marketId);
    const poolAddress = (input.poolAddress ?? storeMarket?.poolAddress) as Address | undefined;
    const chainId = input.chainId ?? storeMarket?.chainId;
    if (!poolAddress) throw new Error("Market pool address is required for on-chain bet placement.");
    if (!chainId) throw new Error("Market chain id is required for on-chain bet placement.");
    if (!isSupportedChainId(chainId)) {
      throw new Error(`Market chain ${chainId} is not configured in the wallet client.`);
    }
    const stakeTokenAddress = stakeTokenForChain(chainId);

    const amount = parseUnits(String(input.stakeUsd), 6);

    // Gasless requires the feature flag AND the per-bet opt-in (default on when
    // available). A user who unticks the toggle falls back to a normal wallet tx.
    const useGasless = isZeroDevGaslessEnabled() && (opts.gasless ?? true);
    if (stakeTokenAddress && !useGasless) {
      onStep("Checking USDC allowance");
      const allowance = (await readContract(wagmiConfig, {
        address: stakeTokenAddress,
        abi: testUsdcAbi,
        functionName: "allowance",
        args: [account.address as Address, poolAddress],
        chainId,
      })) as bigint;
      if (allowance < amount) {
        onStep("Approving USDC spend");
        const approveHash = await writeContract(wagmiConfig, {
          address: stakeTokenAddress,
          abi: testUsdcAbi,
          functionName: "approve",
          args: [poolAddress, MAX_UINT256],
          chainId,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId, timeout: 90_000 });
      }
    }

    onStep("Reading next on-chain position id");
    const positionId = await readContract(wagmiConfig, {
      address: poolAddress,
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
        poolAddress: poolAddress,
        stakeTokenAddress,
        side: input.side,
        stakeUsd: input.stakeUsd,
        onStep,
      });
      transactionHash = gasless.transactionHash;
      bettorAddress = gasless.smartAccountAddress;
    } else {
      // Preflight: confirm the wallet actually holds enough stake token. The
      // pool's bet() ends in stake.transferFrom — without a balance the tx
      // reverts and the wallet shows a scary generic "unknown transaction"
      // warning. Catch it here with a clear message instead.
      if (stakeTokenAddress) {
        const balance = (await readContract(wagmiConfig, {
          address: stakeTokenAddress,
          abi: testUsdcAbi,
          functionName: "balanceOf",
          args: [account.address as Address],
          chainId,
        })) as bigint;
        if (balance < amount) {
          throw new Error(
            "Insufficient USDC balance. Use the faucet to mint test USDC before betting.",
          );
        }
      }
      // Preflight: simulate the bet so a guaranteed revert (expired deadline,
      // already-resolved market, allowance/stake-token mismatch) surfaces as a
      // decoded error in the app rather than as the wallet's generic
      // "execution error for third-party contract" warning.
      onStep("Simulating bet transaction");
      const { request } = await simulateContract(wagmiConfig, {
        account: account.address as Address,
        address: poolAddress,
        abi: parimutuelPoolAbi,
        functionName: "bet",
        args: [input.side === "YES" ? 0 : 1, amount],
        chainId,
      });
      onStep("Waiting for wallet signature");
      transactionHash = await writeContract(wagmiConfig, request);
      onStep(`Transaction submitted: ${transactionHash}`);
      onStep("Confirming transaction");
      await waitForTransactionReceipt(wagmiConfig, { hash: transactionHash, chainId, timeout: 90_000 });
    }

    onStep("Recording confirmed transaction in backend");
    const receipt = await services.betService.placeBet({
      ...quote,
      address: bettorAddress,
      transactionHash,
      positionId: `${input.marketId}#${String(positionId)}`,
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
