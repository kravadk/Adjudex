// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IParimutuelPool {
    function resolve(uint8 side) external;
    function resolver() external view returns (address);
}

// AI Judge V2: optimistic resolution with challenge window.
//
// Flow:
//   1. propose(...) — judge submits signed outcome. Stored as pending.
//      Does NOT call pool.resolve() immediately.
//   2. CHALLENGE_WINDOW (2h on testnet) elapses with no challenge:
//      finalize(...) -> pool.resolve(outcome) -> claims unlock.
//   3. First challenge resets the proposal, requiring a fresh signed
//      evidence hash. A second challenge escalates to owner/multisig
//      override.
//
// V1 compatibility: verifyAndResolve(...) is retained but gated to a
// `fastTrackUntil` timestamp. Set to 0 (default) to force the V2 flow.
contract AIJudgeVerifier is Ownable2Step {
    address public immutable judge;

    // Markets resolved before this timestamp may use the legacy
    // instant-resolve path. Set to 0 (or past) to force the V2 flow.
    uint256 public fastTrackUntil;

    uint256 public constant CHALLENGE_WINDOW = 2 hours;

    enum ProposalStatus { None, Pending, Challenged, Reset, Escalated, Finalized }

    struct Proposal {
        address pool;
        uint8 outcome;
        bytes32 evidenceHash;
        uint64 proposedAt;
        ProposalStatus status;
        address challenger;
        uint32 challengeCount;
        uint256 bondPosted;
    }

    // marketId -> proposal
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => uint256) public challengeBond;

    event Proposed(
        address indexed pool,
        uint256 indexed marketId,
        uint8 outcome,
        bytes32 evidenceHash,
        uint64 proposedAt
    );
    event Challenged(
        address indexed pool,
        uint256 indexed marketId,
        address indexed challenger
    );
    event ProposalReset(address indexed pool, uint256 indexed marketId, bytes32 evidenceHash);
    event ProposalEscalated(address indexed pool, uint256 indexed marketId, address indexed challenger);
    event ChallengeBondPosted(uint256 indexed marketId, address indexed challenger, uint256 amount);
    event Finalized(
        address indexed pool,
        uint256 indexed marketId,
        uint8 outcome,
        bytes32 evidenceHash
    );
    event Overridden(
        address indexed pool,
        uint256 indexed marketId,
        uint8 outcome,
        address indexed by
    );

    // Retained for backwards compatibility with V1 consumers.
    event Resolved(
        address indexed pool,
        uint256 indexed marketId,
        uint8 outcome,
        bytes32 evidenceHash
    );

    constructor(address _judge) Ownable(msg.sender) {
        require(_judge != address(0), "judge=0");
        judge = _judge;
        fastTrackUntil = 0;
    }

    // ─── Configuration ────────────────────────────────────────────────
    // Ownership transfer/accept is inherited from Ownable2Step.

    function setFastTrackUntil(uint256 ts) external onlyOwner {
        fastTrackUntil = ts;
    }

    function setChallengeBond(uint256 marketId, uint256 amountWei) external onlyOwner {
        challengeBond[marketId] = amountWei;
    }

    // ─── Digest / signature verification (unchanged ABI) ──────────────

    function digest(
        address pool,
        uint256 marketId,
        uint8 outcome,
        bytes32 evidenceHash
    ) public view returns (bytes32) {
        bytes32 raw = keccak256(
            abi.encode(block.chainid, pool, marketId, outcome, evidenceHash)
        );
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", raw)
        );
    }

    function verify(
        address pool,
        uint256 marketId,
        uint8 outcome,
        bytes32 evidenceHash,
        bytes calldata signature
    ) public view returns (bool) {
        require(signature.length == 65, "sig length");
        bytes32 h = digest(pool, marketId, outcome, evidenceHash);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(h, v, r, s);
        return recovered != address(0) && recovered == judge;
    }

    // ─── V2: optimistic resolution ────────────────────────────────────

    function propose(
        address pool,
        uint256 marketId,
        uint8 outcome,
        bytes32 evidenceHash,
        bytes calldata signature
    ) external {
        require(outcome <= 1, "bad outcome");
        require(
            verify(pool, marketId, outcome, evidenceHash, signature),
            "bad sig"
        );
        Proposal storage p = proposals[marketId];
        require(
            p.status == ProposalStatus.None || p.status == ProposalStatus.Reset,
            "exists"
        );

        p.pool = pool;
        p.outcome = outcome;
        p.evidenceHash = evidenceHash;
        p.proposedAt = uint64(block.timestamp);
        p.status = ProposalStatus.Pending;
        p.challenger = address(0);
        p.bondPosted = 0;

        emit Proposed(pool, marketId, outcome, evidenceHash, p.proposedAt);
    }

    function challenge(uint256 marketId) external payable {
        Proposal storage p = proposals[marketId];
        require(p.status == ProposalStatus.Pending, "not pending");
        require(
            block.timestamp < uint256(p.proposedAt) + CHALLENGE_WINDOW,
            "window closed"
        );
        uint256 requiredBond = challengeBond[marketId];
        require(msg.value >= requiredBond, "bond too low");
        p.challenger = msg.sender;
        p.bondPosted = msg.value;
        emit Challenged(p.pool, marketId, msg.sender);
        if (msg.value > 0) {
            emit ChallengeBondPosted(marketId, msg.sender, msg.value);
        }
        if (p.challengeCount == 0) {
            p.challengeCount = 1;
            p.status = ProposalStatus.Reset;
            emit ProposalReset(p.pool, marketId, p.evidenceHash);
        } else {
            p.challengeCount += 1;
            p.status = ProposalStatus.Escalated;
            emit ProposalEscalated(p.pool, marketId, msg.sender);
        }
    }

    function finalize(uint256 marketId) external {
        Proposal storage p = proposals[marketId];
        require(p.status == ProposalStatus.Pending, "not pending");
        require(
            block.timestamp >= uint256(p.proposedAt) + CHALLENGE_WINDOW,
            "challenge window open"
        );
        _resolvePool(p, marketId, p.outcome, /*viaOverride=*/ false);
    }

    function overrideAndFinalize(uint256 marketId, uint8 outcome)
        external
        onlyOwner
    {
        require(outcome <= 1, "bad outcome");
        Proposal storage p = proposals[marketId];
        require(p.status == ProposalStatus.Escalated, "not escalated");
        _resolvePool(p, marketId, outcome, /*viaOverride=*/ true);
        emit Overridden(p.pool, marketId, outcome, msg.sender);
    }

    function _resolvePool(
        Proposal storage p,
        uint256 marketId,
        uint8 outcome,
        bool viaOverride
    ) internal {
        require(
            IParimutuelPool(p.pool).resolver() == address(this),
            "not resolver"
        );
        p.status = ProposalStatus.Finalized;
        IParimutuelPool(p.pool).resolve(outcome);
        emit Finalized(p.pool, marketId, outcome, p.evidenceHash);
        if (!viaOverride) {
            emit Resolved(p.pool, marketId, outcome, p.evidenceHash);
        }
    }

    // ─── V1 compatibility (fast-track only, deprecated) ───────────────

    function verifyAndResolve(
        address pool,
        uint256 marketId,
        uint8 outcome,
        bytes32 evidenceHash,
        bytes calldata signature
    ) external {
        require(
            block.timestamp <= fastTrackUntil,
            "fastTrack disabled - use propose+finalize"
        );
        require(outcome <= 1, "bad outcome");
        require(
            verify(pool, marketId, outcome, evidenceHash, signature),
            "bad sig"
        );
        require(
            IParimutuelPool(pool).resolver() == address(this),
            "not resolver"
        );
        Proposal storage p = proposals[marketId];
        require(p.status == ProposalStatus.None, "exists");
        p.pool = pool;
        p.outcome = outcome;
        p.evidenceHash = evidenceHash;
        p.proposedAt = uint64(block.timestamp);
        p.status = ProposalStatus.Finalized;
        IParimutuelPool(pool).resolve(outcome);
        emit Finalized(pool, marketId, outcome, evidenceHash);
        emit Resolved(pool, marketId, outcome, evidenceHash);
    }

    // ─── Views ────────────────────────────────────────────────────────

    function canFinalize(uint256 marketId) external view returns (bool) {
        Proposal storage p = proposals[marketId];
        return
            p.status == ProposalStatus.Pending &&
            block.timestamp >= uint256(p.proposedAt) + CHALLENGE_WINDOW;
    }

    function challengeDeadline(uint256 marketId)
        external
        view
        returns (uint256)
    {
        Proposal storage p = proposals[marketId];
        if (p.status != ProposalStatus.Pending) return 0;
        return uint256(p.proposedAt) + CHALLENGE_WINDOW;
    }
}
