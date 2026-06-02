export const FLAGS = {
  WALLET_ENABLED: process.env.NEXT_PUBLIC_WALLET_ENABLED !== "0",
  ONCHAIN_READS: process.env.NEXT_PUBLIC_BACKEND === "onchain",
  AI_JUDGE_ENABLED: process.env.NEXT_PUBLIC_AI_JUDGE_ENABLED !== "0",
};
