// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ERC-8004-shaped agent registry + reputation oracle.
// agentId = keccak256(handle). Permissionless registration.
contract ReputationOracle {
    struct Agent {
        address wallet;
        string handle;
        uint256 registeredAt;
        bool exists;
    }

    mapping(bytes32 => Agent) public agents;
    mapping(bytes32 => uint256) public reputation;
    bytes32[] public agentIds;

    event AgentRegistered(bytes32 indexed agentId, address indexed wallet, string handle);
    event ReputationUpdated(bytes32 indexed agentId, uint256 oldRep, uint256 newRep);

    function registerAgent(string calldata handle) external returns (bytes32 agentId) {
        agentId = keccak256(bytes(handle));
        require(!agents[agentId].exists, "exists");
        agents[agentId] = Agent({
            wallet: msg.sender,
            handle: handle,
            registeredAt: block.timestamp,
            exists: true
        });
        agentIds.push(agentId);
        emit AgentRegistered(agentId, msg.sender, handle);
    }

    function setReputation(bytes32 agentId, uint256 rep) external {
        // Only the agent's own wallet can self-attest. Production: gate via
        // signed attestation from the Judge contract.
        require(agents[agentId].wallet == msg.sender, "not agent");
        uint256 old = reputation[agentId];
        reputation[agentId] = rep;
        emit ReputationUpdated(agentId, old, rep);
    }

    function getReputation(bytes32 agentId) external view returns (uint256) {
        return reputation[agentId];
    }

    function getAgent(bytes32 agentId)
        external
        view
        returns (address wallet, string memory handle, uint256 registeredAt)
    {
        Agent storage a = agents[agentId];
        return (a.wallet, a.handle, a.registeredAt);
    }

    function agentCount() external view returns (uint256) {
        return agentIds.length;
    }
}
