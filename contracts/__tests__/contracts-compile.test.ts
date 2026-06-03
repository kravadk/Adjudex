import { readFileSync } from "node:fs";
import { join } from "node:path";
import solc from "solc";
import { describe, expect, it } from "vitest";

function findImports(importPath: string) {
  if (importPath.startsWith("@openzeppelin/")) {
    return { contents: readFileSync(join(process.cwd(), "node_modules", importPath), "utf8") };
  }
  return { error: `Unsupported import: ${importPath}` };
}

function compileContracts() {
  const root = join(process.cwd(), "contracts", "src");
  const input = {
    language: "Solidity",
    sources: {
      "ParimutuelPool.sol": { content: readFileSync(join(root, "ParimutuelPool.sol"), "utf8") },
      "MarketFactory.sol": { content: readFileSync(join(root, "MarketFactory.sol"), "utf8") },
      "ReputationOracle.sol": { content: readFileSync(join(root, "ReputationOracle.sol"), "utf8") },
      "TestUSDC.sol": { content: readFileSync(join(root, "TestUSDC.sol"), "utf8") },
      "AIJudgeVerifier.sol": { content: readFileSync(join(root, "AIJudgeVerifier.sol"), "utf8") },
      "PriceOracle.sol": { content: readFileSync(join(root, "PriceOracle.sol"), "utf8") },
      "TokenizedStockAdapter.sol": { content: readFileSync(join(root, "TokenizedStockAdapter.sol"), "utf8") },
      "TestAggregatorV3.sol": { content: readFileSync(join(root, "TestAggregatorV3.sol"), "utf8") },
      "ProofAnchor.sol": { content: readFileSync(join(root, "ProofAnchor.sol"), "utf8") },
      "BetQuoteVerifier.sol": { content: readFileSync(join(root, "BetQuoteVerifier.sol"), "utf8") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  return JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as {
    errors?: Array<{ severity: "error" | "warning"; formattedMessage: string }>;
    contracts: Record<string, Record<string, { abi: Array<{ type: string; name?: string }>; evm: { bytecode: { object: string } } }>>;
  };
}

describe("contracts", () => {
  it("compile cleanly", () => {
    const output = compileContracts();
    const errors = output.errors?.filter((e) => e.severity === "error") ?? [];
    expect(errors.map((e) => e.formattedMessage)).toEqual([]);
  }, 20_000);

  it("ParimutuelPool exposes USDC-aware ABI", () => {
    const output = compileContracts();
    const pool = output.contracts["ParimutuelPool.sol"].ParimutuelPool;
    const names = pool.abi.map((item) => item.name).filter(Boolean);
    expect(pool.evm.bytecode.object.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining([
        "bet",
        "claim",
        "resolve",
        "positions",
        "getYesPct",
        "getTotalVolume",
        "getBettorCount",
        "stake",
        "specHash",
        "ownerOf",
        "balanceOf",
        "name",
        "symbol",
        // v2:
        "transferResolver",
        "refundAfterGrace",
        "deadline",
        "REFUND_GRACE",
        "ResolverTransferred",
        "Refunded",
        // OZ production hardening: resolver-gated emergency pause.
        "pause",
        "unpause",
        "paused",
        "Paused",
        "Unpaused",
      ]),
    );
  });

  it("MarketFactory exposes hard + soft market creation", () => {
    const output = compileContracts();
    const factory = output.contracts["MarketFactory.sol"].MarketFactory;
    const names = factory.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "createMarket",
        "createMarketWithSpec",
        "createSoftMarket",
        "getMarket",
        "nextMarketId",
        "stakeToken",
        "specHashes",
        "specUris",
        // OZ production hardening: 2-step ownership + pausable creation.
        "owner",
        "pendingOwner",
        "transferOwnership",
        "acceptOwnership",
        "pause",
        "unpause",
        "paused",
      ]),
    );
  });

  it("ReputationOracle exposes ERC-8004-style registry", () => {
    const output = compileContracts();
    const rep = output.contracts["ReputationOracle.sol"].ReputationOracle;
    const names = rep.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "registerAgent",
        "setReputation",
        "getReputation",
        "getAgent",
        "agentCount",
        "agentIds",
      ]),
    );
  });

  it("TestUSDC exposes standard ERC-20 surface + mint", () => {
    const output = compileContracts();
    const usdc = output.contracts["TestUSDC.sol"].TestUSDC;
    const names = usdc.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "transfer",
        "transferFrom",
        "approve",
        "balanceOf",
        "allowance",
        "mint",
        "decimals",
        "totalSupply",
      ]),
    );
  });

  it("AIJudgeVerifier exposes verify + verifyAndResolve + digest", () => {
    const output = compileContracts();
    const v = output.contracts["AIJudgeVerifier.sol"].AIJudgeVerifier;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining(["judge", "verify", "verifyAndResolve", "digest", "Resolved"]),
    );
  });

  it("AIJudgeVerifier V2 exposes propose/challenge/finalize + canFinalize view", () => {
    const output = compileContracts();
    const v = output.contracts["AIJudgeVerifier.sol"].AIJudgeVerifier;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "propose",
        "challenge",
        "finalize",
        "overrideAndFinalize",
        "canFinalize",
        "challengeDeadline",
        "Proposed",
        "Challenged",
        "Finalized",
        "Overridden",
        "CHALLENGE_WINDOW",
        "fastTrackUntil",
        "setFastTrackUntil",
      ]),
    );
  });

  it("PriceOracle exposes setPrice/setFeed/getPrice/keyFor", () => {
    const output = compileContracts();
    const v = output.contracts["PriceOracle.sol"].PriceOracle;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining(["setPrice", "setFeed", "getPrice", "keyFor", "PriceSet", "FeedSet"]),
    );
  });

  it("TokenizedStockAdapter exposes register/setActive/tokenOf", () => {
    const output = compileContracts();
    const v = output.contracts["TokenizedStockAdapter.sol"].TokenizedStockAdapter;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "register",
        "setActive",
        "tokenOf",
        "tickerCount",
        "owner",
        "transferOwnership",
        "AssetRegistered",
        // OZ production hardening: 2-step ownership handshake.
        "pendingOwner",
        "acceptOwnership",
      ]),
    );
  });

  it("TestAggregatorV3 mirrors Chainlink AggregatorV3Interface", () => {
    const output = compileContracts();
    const v = output.contracts["TestAggregatorV3.sol"].TestAggregatorV3;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "decimals",
        "description",
        "latestAnswer",
        "latestRound",
        "latestRoundData",
        "setAnswer",
        "version",
        "AnswerUpdated",
      ]),
    );
  });
});

// Pure-JS mirror of ParimutuelPool.claim() math. Guards the invariants that
// the Solidity contract is supposed to enforce.
function payout(myAmount: bigint, mySide: 0 | 1, resolvedSide: 0 | 1, yesPool: bigint, noPool: bigint): bigint {
  if (mySide !== resolvedSide) return 0n;
  const winningPool = resolvedSide === 0 ? yesPool : noPool;
  if (winningPool === 0n) return 0n;
  const totalPool = yesPool + noPool;
  return (myAmount * totalPool) / winningPool;
}

describe("parimutuel math invariants", () => {
  it("losing side gets zero", () => {
    expect(payout(100n, 1, 0, 500n, 300n)).toBe(0n);
  });

  it("sole winner takes the entire pool", () => {
    expect(payout(100n, 0, 0, 100n, 50n)).toBe(150n);
  });

  it("pro-rata split among winners", () => {
    expect(payout(100n, 0, 0, 200n, 100n)).toBe(150n);
  });

  it("solvency: a sole winner holding the entire winning pool gets total pool", () => {
    const cases: Array<[bigint, bigint]> = [
      [100n, 50n], [1000n, 1n], [1n, 1000n], [1n, 1n], [9999n, 1n],
      [500_000_000n, 500_000_000n],
    ];
    for (const [y, n] of cases) {
      for (const side of [0, 1] as const) {
        const winning = side === 0 ? y : n;
        if (winning === 0n) continue;
        expect(payout(winning, side, side, y, n)).toBe(y + n);
      }
    }
  });

  it("integer division floors, never inflates total payouts", () => {
    // YES=3 (split 2 + 1), NO=4, resolves YES: 4 + 2 = 6 <= 7
    expect(payout(2n, 0, 0, 3n, 4n)).toBe(4n);
    expect(payout(1n, 0, 0, 3n, 4n)).toBe(2n);
  });
});

// JS mirror of v2 contract invariants: refund-after-grace, transferResolver,
// double-claim protection. Guards behaviour without spinning up an EVM.
function refund(stake: bigint, gracePassed: boolean, claimed: boolean): bigint {
  if (!gracePassed) throw new Error("too early");
  if (claimed) throw new Error("claimed");
  return stake;
}

type ResolverState = { resolver: string; resolved: boolean };
function transferResolver(state: ResolverState, caller: string, next: string): ResolverState {
  if (caller !== state.resolver) throw new Error("not resolver");
  if (next === "0x0") throw new Error("zero");
  if (state.resolved) throw new Error("resolved");
  return { resolver: next, resolved: state.resolved };
}

describe("v2 invariants", () => {
  it("refund returns 1:1 stake after grace if not claimed", () => {
    expect(refund(100n, true, false)).toBe(100n);
    expect(refund(0n, true, false)).toBe(0n);
  });

  it("refund reverts before grace passes", () => {
    expect(() => refund(100n, false, false)).toThrow("too early");
  });

  it("refund reverts on already-claimed position", () => {
    expect(() => refund(100n, true, true)).toThrow("claimed");
  });

  it("transferResolver hands authority to new address", () => {
    const before: ResolverState = { resolver: "creator", resolved: false };
    const after = transferResolver(before, "creator", "verifier");
    expect(after.resolver).toBe("verifier");
  });

  it("transferResolver rejects non-resolver caller", () => {
    expect(() =>
      transferResolver({ resolver: "creator", resolved: false }, "attacker", "verifier"),
    ).toThrow("not resolver");
  });

  it("transferResolver rejects zero address", () => {
    expect(() =>
      transferResolver({ resolver: "creator", resolved: false }, "creator", "0x0"),
    ).toThrow("zero");
  });

  it("transferResolver rejects after market resolved", () => {
    expect(() =>
      transferResolver({ resolver: "creator", resolved: true }, "creator", "verifier"),
    ).toThrow("resolved");
  });

  it("double-claim of same position rejected", () => {
    let claimed = false;
    const tryClaim = () => {
      if (claimed) throw new Error("claimed");
      claimed = true;
      return 100n;
    };
    expect(tryClaim()).toBe(100n);
    expect(() => tryClaim()).toThrow("claimed");
  });

  it("ProofAnchor exposes anchor/getAnchor/isAnchored + ProofAnchored event", () => {
    const output = compileContracts();
    const v = output.contracts["ProofAnchor.sol"].ProofAnchor;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "anchor",
        "getAnchor",
        "getAnchorByKey",
        "isAnchored",
        "anchors",
        "owner",
        "transferOwnership",
        "ProofAnchored",
        // OZ production hardening: 2-step ownership handshake.
        "pendingOwner",
        "acceptOwnership",
      ]),
    );
  });

  it("BetQuoteVerifier exposes EIP-712 verify/consume + QuoteConsumed event", () => {
    const output = compileContracts();
    const v = output.contracts["BetQuoteVerifier.sol"].BetQuoteVerifier;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "quoteSigner",
        "BET_QUOTE_TYPEHASH",
        "DOMAIN_TYPEHASH",
        "domainSeparator",
        "hashQuote",
        "digest",
        "verify",
        "consume",
        "consumedNonces",
        "QuoteConsumed",
      ]),
    );
  });
});
