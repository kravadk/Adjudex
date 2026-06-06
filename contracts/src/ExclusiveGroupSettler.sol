// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Atomic settlement for an exclusive-outcome group. Once the
// ExclusiveOutcomeRegistry marks a group resolved (exactly one winning
// market), anyone can call settle(groupId) to resolve every child market
// on-chain in one shot: the winner to YES, every other outcome to NO.
//
// SAFETY MODEL: this only triggers each pool's own resolve(); it never moves
// collateral between pools. Each binary pool stays solvent against its own
// reserves and pays its own winners on claim(). For the child pools to accept
// this, they must be created with (or transferResolver'd to) this contract as
// their resolver.
//
// NOT included: capital-efficient negative-risk CONVERSION (merging NO shares
// across outcomes into collateral before resolution). That requires a shared
// collateral framework (CTF-style) — independent per-pool reserves cannot back
// a cross-pool merge without insolvency risk — and is intentionally out of
// scope. See docs/GOVERNANCE.md.

interface IExclusiveRegistry {
    function groups(uint256 groupId)
        external
        view
        returns (string memory title, bool resolved, uint256 winningMarketId, uint256 outcomeCount);

    function outcomes(uint256 groupId, uint256 index)
        external
        view
        returns (uint256 marketId, string memory label, bool linked);
}

interface IMarketFactoryLookup {
    function getMarket(uint256 marketId) external view returns (address pool);
}

interface IResolvablePool {
    function resolve(uint8 side) external;
    function resolved() external view returns (bool);
}

contract ExclusiveGroupSettler {
    uint8 internal constant YES = 0;
    uint8 internal constant NO = 1;

    IExclusiveRegistry public immutable registry;
    IMarketFactoryLookup public immutable factory;

    event GroupSettled(uint256 indexed groupId, uint256 winningMarketId, uint256 outcomeCount);

    error RegistryZero();
    error FactoryZero();
    error GroupNotResolved();
    error NoOutcomes();

    constructor(address _registry, address _factory) {
        if (_registry == address(0)) revert RegistryZero();
        if (_factory == address(0)) revert FactoryZero();
        registry = IExclusiveRegistry(_registry);
        factory = IMarketFactoryLookup(_factory);
    }

    // Permissionless: callable by anyone once the group is resolved (like
    // finalize). Idempotent — already-resolved child pools are skipped, so a
    // partially-settled group can be completed by re-calling.
    function settle(uint256 groupId) external {
        (, bool resolved, uint256 winningMarketId, uint256 outcomeCount) = registry.groups(groupId);
        if (!resolved) revert GroupNotResolved();
        if (outcomeCount == 0) revert NoOutcomes();

        for (uint256 i = 0; i < outcomeCount; i++) {
            (uint256 marketId,,) = registry.outcomes(groupId, i);
            address pool = factory.getMarket(marketId);
            if (pool == address(0)) continue;
            IResolvablePool p = IResolvablePool(pool);
            if (p.resolved()) continue;
            p.resolve(marketId == winningMarketId ? YES : NO);
        }
        emit GroupSettled(groupId, winningMarketId, outcomeCount);
    }
}
