// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ParlayPoolPrototype is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Leg {
        uint256 marketId;
        uint8 side;
    }

    struct Draft {
        address bettor;
        bytes32 legsHash;
        uint256 stake;
        uint256 naiveProbabilityBps;
        bool settled;
        bool won;
    }

    IERC20 public immutable stakeToken;
    uint256 public nextDraftId = 1;
    mapping(uint256 => Draft) public drafts;

    event ParlayDraftOpened(
        uint256 indexed draftId,
        address indexed bettor,
        bytes32 indexed legsHash,
        uint256 stake,
        uint256 naiveProbabilityBps
    );
    event ParlayDraftSettled(uint256 indexed draftId, bool won);

    constructor(address _stakeToken) Ownable(msg.sender) {
        require(block.chainid != 1, "prototype testnet only");
        require(_stakeToken != address(0), "stake=0");
        stakeToken = IERC20(_stakeToken);
    }

    function openDraft(Leg[] calldata legs, uint256 stake, uint256 naiveProbabilityBps)
        external
        nonReentrant
        returns (uint256 draftId)
    {
        require(legs.length >= 2, "too few legs");
        require(stake > 0, "stake=0");
        require(naiveProbabilityBps > 0 && naiveProbabilityBps <= 10_000, "bad probability");
        bytes32 legsHash = hashLegs(legs);
        draftId = nextDraftId++;
        drafts[draftId] = Draft({
            bettor: msg.sender,
            legsHash: legsHash,
            stake: stake,
            naiveProbabilityBps: naiveProbabilityBps,
            settled: false,
            won: false
        });
        stakeToken.safeTransferFrom(msg.sender, address(this), stake);
        emit ParlayDraftOpened(draftId, msg.sender, legsHash, stake, naiveProbabilityBps);
    }

    function ownerSettle(uint256 draftId, bool won) external onlyOwner {
        Draft storage draft = drafts[draftId];
        require(draft.bettor != address(0), "missing draft");
        require(!draft.settled, "settled");
        draft.settled = true;
        draft.won = won;
        emit ParlayDraftSettled(draftId, won);
    }

    function hashLegs(Leg[] calldata legs) public pure returns (bytes32) {
        bytes32 acc = keccak256("ADJUDEX_PARLAY_PROTOTYPE_V1");
        for (uint256 i = 0; i < legs.length; i++) {
            require(legs[i].marketId > 0, "market=0");
            require(legs[i].side <= 1, "bad side");
            acc = keccak256(abi.encode(acc, legs[i].marketId, legs[i].side));
        }
        return acc;
    }
}
