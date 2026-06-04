"use client";

import type { Address } from "viem";

function addressEnv(value: string | undefined): Address | undefined {
  const trimmed = value?.trim();
  return trimmed ? (trimmed as Address) : undefined;
}

export function stakeTokenForChain(chainId?: number): Address | undefined {
  const rhcChainId = Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID ?? "46630");
  if (chainId === rhcChainId) {
    return (
      addressEnv(process.env.NEXT_PUBLIC_RHC_STAKE_TOKEN_ADDRESS) ??
      addressEnv(process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS)
    );
  }
  return addressEnv(process.env.NEXT_PUBLIC_STAKE_TOKEN_ADDRESS);
}
