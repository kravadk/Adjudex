// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ParimutuelPool} from "./ParimutuelPool.sol";
import {OutcomeSharePool} from "./OutcomeSharePool.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

// Ownable2Step: ownership transfer is a two-step handshake (transferOwnership
// sets a pendingOwner; the new owner must acceptOwnership) so a typo'd
// address can never strand the factory. Pausable lets the owner halt new
// market creation in an emergency without touching already-deployed pools.
contract MarketFactory is Ownable2Step, Pausable {
    address public immutable stakeToken;
    // Global fee config applied to every pool the factory creates. 150 = 1.5%.
    // A new factory must be deployed to change the rate or recipient — this
    // keeps governance auditable (immutable, no setter).
    uint256 public immutable feeBps;
    address public immutable feeRecipient;
    // Address passed into every spawned ParimutuelPool as its quote verifier.
    // Zero address = quote-aware betting is disabled for every pool the
    // factory creates. To rotate the verifier deploy a fresh factory; this
    // keeps the binding immutable for the lifetime of each market.
    address public immutable quoteVerifier;
    address public immutable liquidityVault;
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
    event AmmMarketCreated(uint256 indexed marketId, address indexed pool, uint256 seedAmount);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);

    error StakeZero();
    error FeeRecipientZero();
    error VerifierZero();
    error VaultZero();
    error ResolverZero();
    error NotFound();

    constructor(
        address _stakeToken,
        uint256 _feeBps,
        address _feeRecipient,
        address _quoteVerifier,
        address _liquidityVault
    ) Ownable(msg.sender) {
        if (_stakeToken == address(0)) revert StakeZero();
        if (_feeBps != 0 && _feeRecipient == address(0)) revert FeeRecipientZero();
        stakeToken = _stakeToken;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        // Zero allowed — disables the quote feature for every pool spawned
        // by this factory.
        quoteVerifier = _quoteVerifier;
        // Zero allowed: AMM market creation stays disabled until a vault is
        // configured in a fresh factory deployment.
        liquidityVault = _liquidityVault;
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
        if (verifier == address(0)) revert VerifierZero();
        return _create(specHash, deadline, verifier, specUri);
    }

    function createAmmMarket(
        bytes32 specHash,
        uint256 deadline,
        address resolver,
        string calldata specUri,
        uint256 seedAmount
    ) external whenNotPaused returns (uint256 marketId) {
        if (liquidityVault == address(0)) revert VaultZero();
        if (resolver == address(0)) revert ResolverZero();
        marketId = nextMarketId++;
        OutcomeSharePool pool = new OutcomeSharePool(
            stakeToken,
            specHash,
            resolver,
            deadline,
            feeBps,
            feeRecipient,
            liquidityVault
        );
        pools[marketId] = address(pool);
        specHashes[marketId] = specHash;
        if (bytes(specUri).length > 0) specUris[marketId] = specUri;
        ILiquidityVaultFactory(liquidityVault).registerMarket(address(pool), seedAmount);
        emit MarketCreated(marketId, address(pool), specHash, msg.sender, resolver, deadline, specUri);
        emit AmmMarketCreated(marketId, address(pool), seedAmount);
    }

    function _create(
        bytes32 specHash,
        uint256 deadline,
        address resolver,
        string memory specUri
    ) internal whenNotPaused returns (uint256 marketId) {
        marketId = nextMarketId++;
        ParimutuelPool pool = new ParimutuelPool(
            stakeToken,
            specHash,
            resolver,
            deadline,
            feeBps,
            feeRecipient,
            quoteVerifier
        );
        pools[marketId] = address(pool);
        specHashes[marketId] = specHash;
        if (bytes(specUri).length > 0) specUris[marketId] = specUri;
        emit MarketCreated(marketId, address(pool), specHash, msg.sender, resolver, deadline, specUri);
    }

    // Emergency stop for new market creation. Existing pools are independent
    // contracts and keep operating (bet/claim/resolve) regardless.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getMarket(uint256 marketId) external view returns (address pool) {
        pool = pools[marketId];
        if (pool == address(0)) revert NotFound();
    }
}

interface ILiquidityVaultFactory {
    function registerMarket(address market, uint256 seedAmount) external;
}
