// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ParimutuelPool} from "./ParimutuelPool.sol";

contract MarketFactory {
    address public immutable stakeToken;
    // Global fee config applied to every pool the factory creates. 150 = 1.5%.
    // A new factory must be deployed to change the rate or recipient — this
    // keeps governance auditable (immutable, no setter).
    uint256 public immutable feeBps;
    address public immutable feeRecipient;
    uint256 public nextMarketId = 1;

    mapping(uint256 => address) public pools;
    mapping(uint256 => bytes32) public specHashes;
    // Off-chain spec metadata as a durable data: or ipfs: URI. Empty for
    // legacy callers; populated by overloads that take it.
    mapping(uint256 => string) public specUris;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed pool,
        bytes32 indexed specHash,
        address creator,
        address resolver,
        uint256 deadline,
        string specUri
    );
    event MarketResolved(uint256 indexed marketId, uint8 outcome);

    constructor(address _stakeToken, uint256 _feeBps, address _feeRecipient) {
        require(_stakeToken != address(0), "stake=0");
        require(
            _feeBps == 0 || _feeRecipient != address(0),
            "feeRecipient=0"
        );
        stakeToken = _stakeToken;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }

    // Hard market: creator is the resolver. Used for price-oracle markets
    // where the creator (or an off-chain bot they run) calls resolve() when
    // the price feed crosses the threshold.
    function createMarket(bytes32 specHash, uint256 deadline) external returns (uint256 marketId) {
        return _create(specHash, deadline, msg.sender, "");
    }

    function createMarketWithSpec(
        bytes32 specHash,
        uint256 deadline,
        string calldata specUri
    ) external returns (uint256 marketId) {
        return _create(specHash, deadline, msg.sender, specUri);
    }

    // Soft market: resolver is the AIJudgeVerifier contract. Settles via the
    // Reclaim + Phala + ECDSA verify pipeline.
    function createSoftMarket(
        bytes32 specHash,
        uint256 deadline,
        address verifier,
        string calldata specUri
    ) external returns (uint256 marketId) {
        require(verifier != address(0), "verifier=0");
        return _create(specHash, deadline, verifier, specUri);
    }

    function _create(
        bytes32 specHash,
        uint256 deadline,
        address resolver,
        string memory specUri
    ) internal returns (uint256 marketId) {
        marketId = nextMarketId++;
        ParimutuelPool pool = new ParimutuelPool(
            stakeToken,
            specHash,
            resolver,
            deadline,
            feeBps,
            feeRecipient
        );
        pools[marketId] = address(pool);
        specHashes[marketId] = specHash;
        if (bytes(specUri).length > 0) specUris[marketId] = specUri;
        emit MarketCreated(marketId, address(pool), specHash, msg.sender, resolver, deadline, specUri);
    }

    function getMarket(uint256 marketId) external view returns (address pool) {
        pool = pools[marketId];
        require(pool != address(0), "not found");
    }
}
