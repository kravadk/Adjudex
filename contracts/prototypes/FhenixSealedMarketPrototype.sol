// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Prototype only. Compile this with the Fhenix/CoFHE toolchain after adding:
//   pnpm add -D @fhenixprotocol/cofhe-contracts
//
// Current CoFHE docs use:
//   import "@fhenixprotocol/cofhe-contracts/FHE.sol";
//
// The production compiler intentionally excludes contracts/prototypes so the
// Arbitrum/RHC contracts stay reproducible without a Fhenix dependency.
import "@fhenixprotocol/cofhe-contracts/FHE.sol";

contract FhenixSealedMarketPrototype {
    using FHE for euint64;

    struct SealedPosition {
        euint64 yesAmount;
        euint64 noAmount;
        uint256 updatedAt;
    }

    bytes32 public immutable specHash;
    uint256 public immutable deadline;
    address public resolver;
    bool public revealRequested;

    mapping(address => SealedPosition) private positions;
    euint64 private totalYes;
    euint64 private totalNo;

    event SealedBet(address indexed bettor, uint8 indexed side);
    event RevealRequested(bytes32 indexed specHash);

    constructor(bytes32 specHash_, uint256 deadline_, address resolver_) {
        require(deadline_ > block.timestamp, "deadline");
        require(resolver_ != address(0), "resolver");
        specHash = specHash_;
        deadline = deadline_;
        resolver = resolver_;
    }

    function betYes(InEuint64 calldata encryptedAmount) external {
        require(block.timestamp < deadline, "closed");
        euint64 amount = FHE.asEuint64(encryptedAmount);
        positions[msg.sender].yesAmount = positions[msg.sender].yesAmount.add(amount);
        positions[msg.sender].updatedAt = block.timestamp;
        totalYes = totalYes.add(amount);
        emit SealedBet(msg.sender, 0);
    }

    function betNo(InEuint64 calldata encryptedAmount) external {
        require(block.timestamp < deadline, "closed");
        euint64 amount = FHE.asEuint64(encryptedAmount);
        positions[msg.sender].noAmount = positions[msg.sender].noAmount.add(amount);
        positions[msg.sender].updatedAt = block.timestamp;
        totalNo = totalNo.add(amount);
        emit SealedBet(msg.sender, 1);
    }

    function allowViewer(address viewer) external {
        FHE.allow(positions[msg.sender].yesAmount, viewer);
        FHE.allow(positions[msg.sender].noAmount, viewer);
    }

    function requestPublicTotals() external {
        require(msg.sender == resolver, "resolver");
        require(block.timestamp >= deadline, "too early");
        revealRequested = true;
        FHE.allowPublic(totalYes);
        FHE.allowPublic(totalNo);
        emit RevealRequested(specHash);
    }
}
