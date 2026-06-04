// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Pools resolved by this oracle only need the resolve(uint8) sink plus a
// resolver() view so the oracle can refuse to act on a pool it doesn't own.
interface IResolvablePool {
    function resolve(uint8 side) external;
    function resolver() external view returns (address);
}

// OptimisticOracleResolver — permissionless, UMA-style optimistic resolution.
//
// Unlike AIJudgeVerifier (a single trusted judge proposes), ANYONE may assert
// an outcome here by posting an ERC-20 bond. The assertion stands unless it is
// disputed within the liveness window:
//
//   1. assertOutcome(pool, marketId, outcome, evidenceHash)
//        Caller bonds `defaultBond` of bondToken. Stored as Asserted.
//   2a. liveness elapses with no dispute -> settle(marketId):
//        pool.resolve(outcome); the asserter's bond is returned. Anyone may
//        call settle (it is permissionless and self-serving for the asserter).
//   2b. dispute(marketId) within liveness:
//        disputer bonds an equal amount; status -> Disputed; resolution is
//        escalated to the owner (a DAO/multisig) for arbitration.
//   3. resolveDispute(marketId, finalOutcome) [owner only]:
//        pool.resolve(finalOutcome); the *correct* party (asserter if the
//        final outcome matches the assertion, otherwise the disputer) takes
//        BOTH bonds. This is the economic teeth: a wrong assertion or a
//        frivolous dispute forfeits its bond.
//
// The contract implements the same resolve sink shape as AIJudgeVerifier, so a
// pool can hand resolution authority to either one via transferResolver().
contract OptimisticOracleResolver is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Bond currency. USDC on a live deployment — aligns the bond with the
    // collateral bettors actually risk.
    IERC20 public immutable bondToken;

    // Liveness ceiling so misconfiguration can't strand resolution forever.
    uint256 public constant MAX_LIVENESS = 7 days;
    uint256 public constant MIN_LIVENESS = 10 minutes;

    // Defaults applied to every new assertion. Owner-tunable.
    uint256 public defaultBond;
    uint64 public defaultLiveness;

    enum Status { None, Asserted, Disputed, Settled }

    struct Assertion {
        address pool;
        address asserter;
        address disputer;
        uint8 outcome; // the asserted outcome (0/1); never overwritten
        bytes32 evidenceHash;
        uint64 assertedAt;
        uint64 liveness;
        uint256 bond;
        Status status;
    }

    // marketId -> assertion
    mapping(uint256 => Assertion) public assertions;

    event OutcomeAsserted(
        address indexed pool,
        uint256 indexed marketId,
        address indexed asserter,
        uint8 outcome,
        bytes32 evidenceHash,
        uint256 bond,
        uint64 liveness
    );
    event OutcomeDisputed(
        address indexed pool,
        uint256 indexed marketId,
        address indexed disputer,
        uint256 bond
    );
    event OutcomeSettled(
        address indexed pool,
        uint256 indexed marketId,
        uint8 outcome,
        address asserter
    );
    event DisputeArbitrated(
        address indexed pool,
        uint256 indexed marketId,
        uint8 finalOutcome,
        address indexed winner,
        uint256 payout
    );
    event DefaultBondSet(uint256 bond);
    event DefaultLivenessSet(uint64 liveness);

    constructor(
        address _bondToken,
        uint256 _defaultBond,
        uint64 _defaultLiveness
    ) Ownable(msg.sender) {
        require(_bondToken != address(0), "bondToken=0");
        require(
            _defaultLiveness >= MIN_LIVENESS && _defaultLiveness <= MAX_LIVENESS,
            "liveness range"
        );
        bondToken = IERC20(_bondToken);
        defaultBond = _defaultBond;
        defaultLiveness = _defaultLiveness;
    }

    // ─── Configuration ────────────────────────────────────────────────

    function setDefaultBond(uint256 bond) external onlyOwner {
        defaultBond = bond;
        emit DefaultBondSet(bond);
    }

    function setDefaultLiveness(uint64 liveness) external onlyOwner {
        require(
            liveness >= MIN_LIVENESS && liveness <= MAX_LIVENESS,
            "liveness range"
        );
        defaultLiveness = liveness;
        emit DefaultLivenessSet(liveness);
    }

    // ─── Optimistic flow ──────────────────────────────────────────────

    function assertOutcome(
        address pool,
        uint256 marketId,
        uint8 outcome,
        bytes32 evidenceHash
    ) external nonReentrant {
        require(outcome <= 1, "bad outcome");
        require(pool != address(0), "pool=0");
        Assertion storage a = assertions[marketId];
        require(a.status == Status.None, "exists");
        // The oracle must already own resolution authority, else a settle
        // later would revert and the bond would be stuck. Fail fast.
        require(
            IResolvablePool(pool).resolver() == address(this),
            "not resolver"
        );

        uint256 bond = defaultBond;
        a.pool = pool;
        a.asserter = msg.sender;
        a.outcome = outcome;
        a.evidenceHash = evidenceHash;
        a.assertedAt = uint64(block.timestamp);
        a.liveness = defaultLiveness;
        a.bond = bond;
        a.status = Status.Asserted;

        emit OutcomeAsserted(
            pool,
            marketId,
            msg.sender,
            outcome,
            evidenceHash,
            bond,
            defaultLiveness
        );
        if (bond > 0) {
            bondToken.safeTransferFrom(msg.sender, address(this), bond);
        }
    }

    function dispute(uint256 marketId) external nonReentrant {
        Assertion storage a = assertions[marketId];
        require(a.status == Status.Asserted, "not open");
        require(
            block.timestamp < uint256(a.assertedAt) + a.liveness,
            "liveness passed"
        );
        require(msg.sender != a.asserter, "self dispute");
        a.disputer = msg.sender;
        a.status = Status.Disputed;
        emit OutcomeDisputed(a.pool, marketId, msg.sender, a.bond);
        if (a.bond > 0) {
            bondToken.safeTransferFrom(msg.sender, address(this), a.bond);
        }
    }

    // Permissionless: anyone can finalize an undisputed assertion after its
    // liveness window. Returns the asserter's bond.
    function settle(uint256 marketId) external nonReentrant {
        Assertion storage a = assertions[marketId];
        require(a.status == Status.Asserted, "not settleable");
        require(
            block.timestamp >= uint256(a.assertedAt) + a.liveness,
            "liveness open"
        );
        a.status = Status.Settled;
        _resolve(a.pool, a.outcome);
        emit OutcomeSettled(a.pool, marketId, a.outcome, a.asserter);
        if (a.bond > 0) {
            bondToken.safeTransfer(a.asserter, a.bond);
        }
    }

    // Owner (DAO/multisig) arbitrates a dispute. The winning party takes both
    // bonds; the pool is resolved to the arbitrated outcome.
    function resolveDispute(uint256 marketId, uint8 finalOutcome)
        external
        onlyOwner
        nonReentrant
    {
        require(finalOutcome <= 1, "bad outcome");
        Assertion storage a = assertions[marketId];
        require(a.status == Status.Disputed, "not disputed");
        a.status = Status.Settled;

        // Asserter wins iff the arbitrated outcome matches the assertion.
        address winner = finalOutcome == a.outcome ? a.asserter : a.disputer;
        uint256 pot = a.bond * 2;

        _resolve(a.pool, finalOutcome);
        emit DisputeArbitrated(a.pool, marketId, finalOutcome, winner, pot);
        if (pot > 0) {
            bondToken.safeTransfer(winner, pot);
        }
    }

    function _resolve(address pool, uint8 outcome) internal {
        require(
            IResolvablePool(pool).resolver() == address(this),
            "not resolver"
        );
        IResolvablePool(pool).resolve(outcome);
    }

    // ─── Views ────────────────────────────────────────────────────────

    function canSettle(uint256 marketId) external view returns (bool) {
        Assertion storage a = assertions[marketId];
        return
            a.status == Status.Asserted &&
            block.timestamp >= uint256(a.assertedAt) + a.liveness;
    }

    function disputeDeadline(uint256 marketId) external view returns (uint256) {
        Assertion storage a = assertions[marketId];
        if (a.status != Status.Asserted) return 0;
        return uint256(a.assertedAt) + a.liveness;
    }
}
