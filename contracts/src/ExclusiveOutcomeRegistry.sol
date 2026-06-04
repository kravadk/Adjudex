// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract ExclusiveOutcomeRegistry is Ownable2Step {
    struct Outcome {
        uint256 marketId;
        string label;
        bool linked;
    }

    struct Group {
        string title;
        bool resolved;
        uint256 winningMarketId;
        uint256 outcomeCount;
    }

    uint256 public nextGroupId = 1;
    mapping(uint256 => Group) public groups;
    mapping(uint256 => mapping(uint256 => Outcome)) public outcomes;
    mapping(uint256 => mapping(uint256 => bool)) public marketLinked;

    event OutcomeGroupCreated(uint256 indexed groupId, string title);
    event GroupOutcomeLinked(uint256 indexed groupId, uint256 indexed marketId, string label);
    event GroupResolved(uint256 indexed groupId, uint256 indexed winningMarketId);

    constructor() Ownable(msg.sender) {}

    function createGroup(string calldata title) external onlyOwner returns (uint256 groupId) {
        require(bytes(title).length > 0, "title required");
        groupId = nextGroupId++;
        groups[groupId].title = title;
        emit OutcomeGroupCreated(groupId, title);
    }

    function linkOutcome(uint256 groupId, uint256 marketId, string calldata label) external onlyOwner {
        Group storage group = groups[groupId];
        require(bytes(group.title).length > 0, "group missing");
        require(!group.resolved, "resolved");
        require(marketId > 0, "market=0");
        require(!marketLinked[groupId][marketId], "duplicate");
        require(bytes(label).length > 0, "label required");
        uint256 index = group.outcomeCount++;
        outcomes[groupId][index] = Outcome({ marketId: marketId, label: label, linked: true });
        marketLinked[groupId][marketId] = true;
        emit GroupOutcomeLinked(groupId, marketId, label);
    }

    function resolveGroup(uint256 groupId, uint256 winningMarketId) external onlyOwner {
        Group storage group = groups[groupId];
        require(bytes(group.title).length > 0, "group missing");
        require(!group.resolved, "resolved");
        require(group.outcomeCount >= 2, "too few outcomes");
        require(marketLinked[groupId][winningMarketId], "winner not linked");
        group.resolved = true;
        group.winningMarketId = winningMarketId;
        emit GroupResolved(groupId, winningMarketId);
    }
}
