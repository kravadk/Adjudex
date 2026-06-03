import { describe, expect, it } from "vitest";
import { describeTxError } from "../decode-error";

describe("describeTxError", () => {
  it("flags a user-rejected request as benign (code 4001)", () => {
    const out = describeTxError({ code: 4001, message: "User rejected the request." });
    expect(out.kind).toBe("rejected");
    expect(out.rejected).toBe(true);
  });

  it("flags a user-rejected request by message", () => {
    const out = describeTxError(new Error("MetaMask Tx Signature: User denied transaction signature."));
    expect(out.kind).toBe("rejected");
    expect(out.rejected).toBe(true);
  });

  it("detects a stuck transaction (timeout) and tells the user to check the explorer", () => {
    const out = describeTxError({ name: "WaitForTransactionReceiptTimeoutError", message: "timed out" });
    expect(out.kind).toBe("timeout");
    expect(out.rejected).toBe(false);
    expect(out.message.toLowerCase()).toContain("explorer");
  });

  it("detects a wrong-network error", () => {
    const out = describeTxError({ name: "ChainMismatchError", message: "The current chain does not match the target chain." });
    expect(out.kind).toBe("chain_mismatch");
  });

  it("detects insufficient gas", () => {
    const out = describeTxError(new Error("insufficient funds for gas * price + value"));
    expect(out.kind).toBe("insufficient_funds");
  });

  it("decodes a known contract revert reason to friendly copy", () => {
    const out = describeTxError({ name: "ContractFunctionRevertedError", reason: "claimed", message: "execution reverted: claimed" });
    expect(out.kind).toBe("reverted");
    expect(out.message).toBe("This position was already claimed.");
  });

  it("maps a pausable revert", () => {
    const out = describeTxError({ name: "ContractFunctionRevertedError", reason: "EnforcedPause", message: "reverted" });
    expect(out.kind).toBe("reverted");
    expect(out.message.toLowerCase()).toContain("paused");
  });

  it("falls back to the raw reason for an unknown revert string", () => {
    const out = describeTxError({ name: "ContractFunctionRevertedError", reason: "some_custom_guard", message: "reverted" });
    expect(out.kind).toBe("reverted");
    expect(out.message).toContain("some_custom_guard");
  });

  it("detects an RPC/network failure", () => {
    const out = describeTxError(new Error("Failed to fetch"));
    expect(out.kind).toBe("network");
  });

  it("never returns an empty message (no silent fail)", () => {
    for (const input of [null, undefined, {}, new Error(""), "boom"]) {
      const out = describeTxError(input);
      expect(out.title.length).toBeGreaterThan(0);
      expect(out.message.length).toBeGreaterThan(0);
    }
  });
});
