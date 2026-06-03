// Shared decoder that turns a viem/wagmi error into a user-facing message.
// The goal is no silent failures and no scary raw RPC strings: every write
// path runs its catch through describeTxError so the UI can show a friendly
// title + body and decide whether it was a benign user cancellation.

import { BaseError } from "viem";

export type TxErrorKind =
  | "rejected" // user dismissed the wallet prompt
  | "insufficient_funds" // not enough gas/native token
  | "chain_mismatch" // wallet on the wrong network
  | "reverted" // contract require() failed
  | "timeout" // tx submitted but not mined in time
  | "network" // RPC unreachable / request failed
  | "unknown";

export type TxError = {
  kind: TxErrorKind;
  title: string;
  message: string;
  // True only for a deliberate wallet cancellation — callers should surface
  // this quietly (info toast), not as a red error.
  rejected: boolean;
};

// On-chain require() strings → human copy. Mirrors the messages in
// contracts/src/*.sol plus the OpenZeppelin custom-error names.
const REVERT_COPY: Record<string, string> = {
  resolved: "This market is already resolved.",
  "already resolved": "This market is already resolved.",
  "deadline passed": "Betting has closed for this market.",
  "deadline in past": "Betting has closed for this market.",
  "not resolver": "Only the market resolver can do that.",
  claimed: "This position was already claimed.",
  "not owner": "This position belongs to another wallet.",
  "no winners": "There is no winning pool to claim from.",
  "not resolved": "This market has not resolved yet.",
  "too early": "The refund grace window has not passed yet.",
  "quote consumed": "That quote was already used — refresh and try again.",
  "quote disabled": "Signed quotes are disabled for this pool.",
  expired: "Your quote expired — refresh and try again.",
  "bad sig": "Signature verification failed — refresh and try again.",
  "wrong pool": "Quote was issued for a different pool.",
  "bettor mismatch": "That quote was issued for a different wallet.",
  "zero amount": "Enter an amount greater than zero.",
  "bad side": "Invalid bet side.",
  EnforcedPause: "Betting is paused on this market right now.",
  OwnableUnauthorizedAccount: "Your wallet is not authorized for this action.",
  ERC20InsufficientBalance: "Insufficient USDC balance.",
  ERC20InsufficientAllowance: "Approve USDC spending first, then retry.",
};

function root(error: unknown): unknown {
  if (error instanceof BaseError) return error.walk();
  return error;
}

function text(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const e = error as { shortMessage?: string; details?: string; reason?: string; message?: string };
  return e.shortMessage || e.reason || e.details || e.message || "";
}

function name(error: unknown): string {
  return (error as { name?: string })?.name ?? "";
}

export function describeTxError(error: unknown): TxError {
  const walked = root(error);
  const walkedName = name(walked);
  const blob = `${text(error)} ${text(walked)}`.trim();
  const lower = blob.toLowerCase();
  const code = (error as { code?: number })?.code ?? (walked as { code?: number })?.code;

  // 1. User rejected the wallet prompt (MetaMask code 4001 / viem name).
  if (
    code === 4001 ||
    walkedName === "UserRejectedRequestError" ||
    /user rejected|user denied|denied transaction|request rejected|rejected the request|user cancel/i.test(lower)
  ) {
    return {
      kind: "rejected",
      title: "Request cancelled",
      message: "You cancelled the wallet request. Nothing was sent.",
      rejected: true,
    };
  }

  // 2. Submitted but not mined within the wait window.
  if (walkedName.includes("WaitForTransactionReceiptTimeout") || /timed out|timeout/i.test(lower)) {
    return {
      kind: "timeout",
      title: "Still pending",
      message: "The transaction was sent but hasn't confirmed yet. Check the explorer; your balance updates once it lands.",
      rejected: false,
    };
  }

  // 3. Wrong network.
  if (
    walkedName === "ChainMismatchError" ||
    /chain mismatch|does not match the target chain|chain .* not configured|switch.*network|wrong network/i.test(lower)
  ) {
    return {
      kind: "chain_mismatch",
      title: "Wrong network",
      message: "Switch your wallet to the market's network and try again.",
      rejected: false,
    };
  }

  // 4. Not enough gas / native balance.
  if (/insufficient funds|insufficient balance for gas|exceeds the balance|gas required exceeds/i.test(lower)) {
    return {
      kind: "insufficient_funds",
      title: "Not enough gas",
      message: "Your wallet doesn't have enough ETH to cover gas for this transaction.",
      rejected: false,
    };
  }

  // 5. Contract revert — decode the require() reason / custom error name.
  if (walkedName === "ContractFunctionRevertedError" || /reverted|execution reverted/i.test(lower)) {
    const reason =
      (walked as { reason?: string })?.reason ??
      (walked as { data?: { errorName?: string } })?.data?.errorName ??
      "";
    const key = Object.keys(REVERT_COPY).find(
      (k) => reason === k || lower.includes(k.toLowerCase()),
    );
    return {
      kind: "reverted",
      title: "Transaction rejected on-chain",
      message: key ? REVERT_COPY[key] : reason || "The contract rejected this transaction.",
      rejected: false,
    };
  }

  // 6. RPC / network transport failure.
  if (
    walkedName === "HttpRequestError" ||
    walkedName === "TimeoutError" ||
    /failed to fetch|network error|fetch failed|request failed|connection|econnrefused|503|502|504/i.test(lower)
  ) {
    return {
      kind: "network",
      title: "Network unavailable",
      message: "Couldn't reach the network. Check your connection and retry.",
      rejected: false,
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    message: blob ? blob.slice(0, 200) : "Unexpected error. Please try again.",
    rejected: false,
  };
}
