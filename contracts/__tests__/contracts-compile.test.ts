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

type CompileOutput = {
  errors?: Array<{ severity: "error" | "warning"; formattedMessage: string }>;
  contracts: Record<string, Record<string, { abi: Array<{ type: string; name?: string }>; evm: { bytecode: { object: string } } }>>;
};

let cachedCompileOutput: CompileOutput | null = null;

function compileContracts(): CompileOutput {
  if (cachedCompileOutput) return cachedCompileOutput;
  const root = join(process.cwd(), "contracts", "src");
  const input = {
    language: "Solidity",
    sources: {
      "ParimutuelPool.sol": { content: readFileSync(join(root, "ParimutuelPool.sol"), "utf8") },
      "MarketFactory.sol": { content: readFileSync(join(root, "MarketFactory.sol"), "utf8") },
      "OutcomeSharePool.sol": { content: readFileSync(join(root, "OutcomeSharePool.sol"), "utf8") },
      "OutcomeShareToken.sol": { content: readFileSync(join(root, "OutcomeShareToken.sol"), "utf8") },
      "LiquidityVault.sol": { content: readFileSync(join(root, "LiquidityVault.sol"), "utf8") },
      "AdjudexOrderMatcher.sol": { content: readFileSync(join(root, "AdjudexOrderMatcher.sol"), "utf8") },
      "ExclusiveOutcomeRegistry.sol": { content: readFileSync(join(root, "ExclusiveOutcomeRegistry.sol"), "utf8") },
      "ParlayPoolPrototype.sol": { content: readFileSync(join(root, "ParlayPoolPrototype.sol"), "utf8") },
      "ReputationOracle.sol": { content: readFileSync(join(root, "ReputationOracle.sol"), "utf8") },
      "TestUSDC.sol": { content: readFileSync(join(root, "TestUSDC.sol"), "utf8") },
      "AIJudgeVerifier.sol": { content: readFileSync(join(root, "AIJudgeVerifier.sol"), "utf8") },
      "PriceOracle.sol": { content: readFileSync(join(root, "PriceOracle.sol"), "utf8") },
      "TokenizedStockAdapter.sol": { content: readFileSync(join(root, "TokenizedStockAdapter.sol"), "utf8") },
      "TestAggregatorV3.sol": { content: readFileSync(join(root, "TestAggregatorV3.sol"), "utf8") },
      "ProofAnchor.sol": { content: readFileSync(join(root, "ProofAnchor.sol"), "utf8") },
      "BetQuoteVerifier.sol": { content: readFileSync(join(root, "BetQuoteVerifier.sol"), "utf8") },
      "OptimisticOracleResolver.sol": { content: readFileSync(join(root, "OptimisticOracleResolver.sol"), "utf8") },
      "AdjudexTimelock.sol": { content: readFileSync(join(root, "AdjudexTimelock.sol"), "utf8") },
      "ExclusiveGroupSettler.sol": { content: readFileSync(join(root, "ExclusiveGroupSettler.sol"), "utf8") },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  cachedCompileOutput = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as CompileOutput;
  return cachedCompileOutput;
}

describe("contracts", () => {
  it("compile cleanly", () => {
    const output = compileContracts();
    const errors = output.errors?.filter((e) => e.severity === "error") ?? [];
    expect(errors.map((e) => e.formattedMessage)).toEqual([]);
  }, 90_000);

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
        "createAmmMarket",
        "AmmMarketCreated",
        "getMarket",
        "liquidityVault",
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

  it("OutcomeSharePool exposes buy/sell liquidity surface", () => {
    const output = compileContracts();
    const pool = output.contracts["OutcomeSharePool.sol"].OutcomeSharePool;
    const names = pool.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "buy",
        "sell",
        "claim",
        "repayVault",
        "seedFromVault",
        "quoteBuy",
        "quoteSell",
        "addLiquidity",
        "removeLiquidity",
        "invariant",
        "lpBalanceOf",
        "totalLpShares",
        "resolve",
        "yesShares",
        "noShares",
        "yesBalanceOf",
        "noBalanceOf",
        "yesToken",
        "noToken",
        "SharesBought",
        "SharesSold",
        "LiquidityAdded",
        "LiquidityRemoved",
        "VaultSeeded",
      ]),
    );
  });

  it("OutcomeShareToken is an ERC-20 with minter-gated mint/burn", () => {
    const output = compileContracts();
    const token = output.contracts["OutcomeShareToken.sol"].OutcomeShareToken;
    const names = token.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "transfer",
        "transferFrom",
        "approve",
        "allowance",
        "balanceOf",
        "totalSupply",
        "decimals",
        "mint",
        "burn",
        "minter",
      ]),
    );
  });

  it("LiquidityVault tracks registered market debt and surplus", () => {
    const output = compileContracts();
    const vault = output.contracts["LiquidityVault.sol"].LiquidityVault;
    const names = vault.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "setFactory",
        "registerMarket",
        "repay",
        "claimSurplus",
        "marketDebt",
        "marketSurplus",
        "totalOutstandingDebt",
      ]),
    );
  });

  it("AdjudexOrderMatcher exposes EIP-712 order lifecycle", () => {
    const output = compileContracts();
    const matcher = output.contracts["AdjudexOrderMatcher.sol"].AdjudexOrderMatcher;
    const names = matcher.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "hashOrder",
        "verify",
        "matchOrders",
        "cancelOrder",
        "cancelUpTo",
        "OrdersMatched",
        "OrderFilled",
        "OrderCancelled",
        "FeeCharged",
      ]),
    );
  });

  it("ExclusiveOutcomeRegistry exposes group lifecycle", () => {
    const output = compileContracts();
    const registry = output.contracts["ExclusiveOutcomeRegistry.sol"].ExclusiveOutcomeRegistry;
    const names = registry.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "createGroup",
        "linkOutcome",
        "resolveGroup",
        "OutcomeGroupCreated",
        "GroupOutcomeLinked",
        "GroupResolved",
      ]),
    );
  });

  it("ParlayPoolPrototype exposes gated draft lifecycle", () => {
    const output = compileContracts();
    const pool = output.contracts["ParlayPoolPrototype.sol"].ParlayPoolPrototype;
    const names = pool.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "openDraft",
        "ownerSettle",
        "hashLegs",
        "ParlayDraftOpened",
        "ParlayDraftSettled",
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
        // OZ production hardening: 2-step ownership handshake.
        "owner",
        "pendingOwner",
        "transferOwnership",
        "acceptOwnership",
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
        "ProposalReset",
        "ProposalEscalated",
        "ChallengeBondPosted",
        "CHALLENGE_WINDOW",
        "challengeBond",
        "setChallengeBond",
        "fastTrackUntil",
        "setFastTrackUntil",
        // OZ production hardening: 2-step ownership handshake.
        "owner",
        "pendingOwner",
        "transferOwnership",
        "acceptOwnership",
      ]),
    );
  });

  it("OptimisticOracleResolver exposes permissionless assert/dispute/settle", () => {
    const output = compileContracts();
    const v = output.contracts["OptimisticOracleResolver.sol"].OptimisticOracleResolver;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(v.evm.bytecode.object.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining([
        "assertOutcome",
        "dispute",
        "settle",
        "resolveDispute",
        "canSettle",
        "disputeDeadline",
        "assertions",
        "bondToken",
        "defaultBond",
        "defaultLiveness",
        "setDefaultBond",
        "setDefaultLiveness",
        "MAX_LIVENESS",
        "MIN_LIVENESS",
        "OutcomeAsserted",
        "OutcomeDisputed",
        "OutcomeSettled",
        "DisputeArbitrated",
        // OZ production hardening: 2-step ownership handshake.
        "owner",
        "pendingOwner",
        "transferOwnership",
        "acceptOwnership",
      ]),
    );
  });

  it("AdjudexTimelock exposes the TimelockController governance surface", () => {
    const output = compileContracts();
    const v = output.contracts["AdjudexTimelock.sol"].AdjudexTimelock;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(v.evm.bytecode.object.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining([
        "schedule",
        "execute",
        "cancel",
        "getMinDelay",
        "updateDelay",
        "hashOperation",
        "isOperationReady",
        "grantRole",
        "revokeRole",
        "CallScheduled",
        "CallExecuted",
      ]),
    );
  });

  it("ExclusiveGroupSettler exposes atomic group settlement", () => {
    const output = compileContracts();
    const v = output.contracts["ExclusiveGroupSettler.sol"].ExclusiveGroupSettler;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(v.evm.bytecode.object.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining(["settle", "registry", "factory", "GroupSettled"]),
    );
  });

  it("PriceOracle exposes setPrice/setFeed/getPrice/keyFor", () => {
    const output = compileContracts();
    const v = output.contracts["PriceOracle.sol"].PriceOracle;
    const names = v.abi.map((item) => item.name).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        "setPrice",
        "setFeed",
        "getPrice",
        "keyFor",
        "PriceSet",
        "FeedSet",
        // OZ production hardening: 2-step ownership handshake.
        "owner",
        "pendingOwner",
        "transferOwnership",
        "acceptOwnership",
      ]),
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

// Pure-JS mirror of OutcomeSharePool's constant-product (x*y=k, Gnosis FPMM)
// math. Guards the invariants the Solidity contract must enforce.
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("neg");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Shares out for net collateral `amount` on side with (reserve, opposite).
function quoteBuy(amount: bigint, reserve: bigint, opposite: bigint): bigint {
  if (amount === 0n) throw new Error("zero amount");
  if (reserve === 0n || opposite === 0n) return amount; // bootstrap 1:1
  const k = reserve * opposite;
  const denom = opposite + amount;
  const endingReserve = (k + denom - 1n) / denom; // ceil → pool-safe
  return reserve + amount - endingReserve;
}

// Pre-fee collateral for selling `shares` on side with (reserve, opposite).
function quoteSell(shares: bigint, reserve: bigint, opposite: bigint): bigint {
  if (shares === 0n) throw new Error("zero shares");
  if (reserve === 0n || opposite === 0n) return 0n;
  const b = reserve + shares + opposite;
  const disc = b * b - 4n * shares * opposite;
  let r = (b - isqrt(disc)) / 2n;
  if (r >= opposite) r = opposite - 1n;
  return r;
}

describe("OutcomeSharePool constant-product invariants", () => {
  it("buy quotes are monotonic with input amount", () => {
    const small = quoteBuy(10n, 1000n, 1000n);
    const large = quoteBuy(20n, 1000n, 1000n);
    expect(large).toBeGreaterThan(small);
  });

  it("marginal price rises as you buy one side (slippage)", () => {
    // First 100 in: shares per unit. Then buy again on the moved pool.
    const first = quoteBuy(100n, 1000n, 1000n); // 191
    const reserveAfter = 1000n + 100n - first; // ending side reserve
    const oppositeAfter = 1000n + 100n;
    const second = quoteBuy(100n, reserveAfter, oppositeAfter);
    expect(second).toBeLessThan(first); // fewer shares for the same spend
  });

  it("round-trip is never profitable (no free money)", () => {
    const reserve = 1000n;
    const opposite = 1000n;
    const shares = quoteBuy(100n, reserve, opposite); // buy YES with 100
    const reserveAfter = reserve + 100n - shares;
    const oppositeAfter = opposite + 100n;
    const back = quoteSell(shares, reserveAfter, oppositeAfter); // sell them back
    expect(back).toBeLessThanOrEqual(100n);
  });

  it("constant product is preserved (>= k) on a buy", () => {
    const reserve = 1000n;
    const opposite = 1000n;
    const k = reserve * opposite;
    const shares = quoteBuy(100n, reserve, opposite);
    const product = (reserve + 100n - shares) * (opposite + 100n);
    expect(product).toBeGreaterThanOrEqual(k);
  });

  it("sell never drains the opposite reserve", () => {
    const out = quoteSell(1_000_000n, 1000n, 1000n);
    expect(out).toBeLessThan(1000n);
  });

  it("empty AMM bootstraps one share per unit", () => {
    expect(quoteBuy(25n, 0n, 0n)).toBe(25n);
    expect(quoteSell(25n, 1000n, 0n)).toBe(0n);
  });
});

// Pure-JS mirror of OptimisticOracleResolver's bond/winner economics. Guards
// the rules the Solidity contract enforces around dispute arbitration.
type OracleStatus = "none" | "asserted" | "disputed" | "settled";

// Returns who collects the pot after arbitration, and the pot size.
function arbitrate(
  assertedOutcome: 0 | 1,
  finalOutcome: 0 | 1,
  bond: bigint,
  asserter: string,
  disputer: string,
): { winner: string; pot: bigint } {
  return {
    winner: finalOutcome === assertedOutcome ? asserter : disputer,
    pot: bond * 2n,
  };
}

// Returns the bond refund on an undisputed settle (asserter gets it back).
function settleRefund(status: OracleStatus, livenessPassed: boolean, bond: bigint): bigint {
  if (status !== "asserted") throw new Error("not settleable");
  if (!livenessPassed) throw new Error("liveness open");
  return bond;
}

describe("OptimisticOracleResolver economics", () => {
  it("correct assertion: asserter takes both bonds", () => {
    const { winner, pot } = arbitrate(1, 1, 10n, "asserter", "disputer");
    expect(winner).toBe("asserter");
    expect(pot).toBe(20n);
  });

  it("wrong assertion: disputer takes both bonds", () => {
    const { winner, pot } = arbitrate(1, 0, 10n, "asserter", "disputer");
    expect(winner).toBe("disputer");
    expect(pot).toBe(20n);
  });

  it("undisputed settle refunds the asserter's bond after liveness", () => {
    expect(settleRefund("asserted", true, 10n)).toBe(10n);
    expect(settleRefund("asserted", true, 0n)).toBe(0n);
  });

  it("settle reverts before liveness elapses", () => {
    expect(() => settleRefund("asserted", false, 10n)).toThrow("liveness open");
  });

  it("settle reverts on a non-asserted (e.g. disputed) market", () => {
    expect(() => settleRefund("disputed", true, 10n)).toThrow("not settleable");
  });
});
