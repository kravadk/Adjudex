import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const pinMock = vi.hoisted(() => vi.fn());
const writeContractMock = vi.hoisted(() => vi.fn());
const waitReceiptMock = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({ query: queryMock }));
vi.mock("../ipfs", () => ({
  ipfsConfigured: () => true,
  pinJsonToIpfs: pinMock,
}));
vi.mock("../feeds/chain", () => ({
  autoPipelineConfigError: () => null,
  getCreatorClients: () => ({
    account: { address: "0xCreator" },
    walletClient: { writeContract: writeContractMock },
    publicClient: { waitForTransactionReceipt: waitReceiptMock },
  }),
}));

const { anchorOnce } = await import("../proof-anchor-worker");

describe("proof-anchor worker", () => {
  beforeEach(() => {
    queryMock.mockReset();
    pinMock.mockReset();
    writeContractMock.mockReset();
    waitReceiptMock.mockReset();
    process.env.PROOF_ANCHOR_ADDRESS = "0x9c36aa5fa856893ae70e33014985678e4ce198ad";
  });
  afterEach(() => {
    delete process.env.PROOF_ANCHOR_ADDRESS;
  });

  it("pins each unanchored proof and writes the anchor tx", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ session_id: "s1", proof_hash: "0xabc", proof: { a: 1 } }] })
      .mockResolvedValueOnce({ rows: [] });
    pinMock.mockResolvedValue("bafyTEST");
    writeContractMock.mockResolvedValue("0xtxhash");
    waitReceiptMock.mockResolvedValue({});

    const result = await anchorOnce();

    expect(result).toEqual({ anchored: 1, errors: 0 });
    expect(pinMock).toHaveBeenCalledWith({ a: 1 });
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const callArgs = writeContractMock.mock.calls[0][0];
    expect(callArgs.functionName).toBe("anchor");
    expect(callArgs.args[0]).toBe("s1");
    expect(callArgs.args[1]).toBe("0xabc");
    expect(typeof callArgs.args[2]).toBe("string");
    const updateCall = queryMock.mock.calls[1];
    expect(updateCall[0]).toContain("UPDATE reclaim_proofs");
    expect(updateCall[1]).toEqual(["s1", "0xtxhash", "bafyTEST"]);
  });

  it("is a no-op when the anchor address is missing", async () => {
    delete process.env.PROOF_ANCHOR_ADDRESS;
    const result = await anchorOnce();
    expect(result).toEqual({ anchored: 0, errors: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
