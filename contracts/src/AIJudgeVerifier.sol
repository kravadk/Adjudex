// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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
//   3. Anyone may challenge(...) inside the window to flip the proposal
//      into `disputed`. Disputed proposals must be settled by `owner`
//      via overrideAndFinalize(outcome) which forwards the corrected
//      outcome to the pool.
//
// V1 compatibility: verifyAndResolve(...) is retained but gated to a
// `fastTrackUntil` timestamp. Set to 0 (default) to force the V2 flow.
contract AIJudgeVerifier {
    address public immutable judge;
    address public owner;

    // Markets resolved before this timestamp may use the legacy
    // instant-resolve path. Set to 0 (or past) to force the V2 flow.
    uint256 public fastTrackUntil;

    uint256 public constant CHALLENGE_WINDOW = 2 hours;

    enum ProposalStatus { None, Pending, Disputed, Finalized }

    struct Proposal {
        address pool;
        uint8 outcome;
        bytes32 evidenceHash;
        uint64 proposedAt;
        ProposalStatus status;
        address challenger;
    }

    // marketId -> proposal
    mapping(uint256 => Proposal) public proposals;

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

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _judge) {
        require(_judge != address(0), "judge=0");
        judge = _judge;
        owner = msg.sender;
        fastTrackUntil = 0;
    }

    // ─── Configuration ────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        owner = newOwner;
    }

    function setFastTrackUntil(uint256 ts) external onlyOwner {
        fastTrackUntil = ts;
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
        require(p.status == ProposalStatus.None, "exists");

        p.pool = pool;
        p.outcome = outcome;
        p.evidenceHash = evidenceHash;
        p.proposedAt = uint64(block.timestamp);
        p.status = ProposalStatus.Pending;

        emit Proposed(pool, marketId, outcome, evidenceHash, p.proposedAt);
    }

    function challenge(uint256 marketId) external {
        Proposal storage p = proposals[marketId];
        require(p.status == ProposalStatus.Pending, "not pending");
        require(
            block.timestamp < uint256(p.proposedAt) + CHALLENGE_WINDOW,
            "window closed"
        );
        p.status = ProposalStatus.Disputed;
        p.challenger = msg.sender;
        emit Challenged(p.pool, marketId, msg.sender);
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
        require(p.status == ProposalStatus.Disputed, "not disputed");
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
