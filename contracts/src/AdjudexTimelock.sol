// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

// Governance timelock for Adjudex owner-controlled actions — most importantly
// AIJudgeVerifier.overrideAndFinalize (the manual dispute escape hatch) and
// MarketFactory.pause. Transfer each Ownable2Step contract's ownership to an
// instance of this timelock so privileged calls must go through a mandatory
// minDelay + multisig proposer/executor flow instead of a single hot owner key.
//
// This hardens resolution: a malicious or compromised owner key can no longer
// instantly override a disputed market — every override is queued for `minDelay`
// and publicly visible (CallScheduled event) before it can execute, giving
// challengers time to react. Standard OpenZeppelin TimelockController; deploy
// with scripts/deploy-timelock.ts, then point transfer-ownership at it.
contract AdjudexTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
