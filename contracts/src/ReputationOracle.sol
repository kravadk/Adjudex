// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ERC-8004-shaped agent registry + reputation oracle.
// agentId = keccak256(handle). Permissionless registration.
//
// Two reputation-update paths:
//   1. setReputation(agentId, rep) — self-attest by the agent's own wallet
//      (MVP / debug path; values are advisory).
//   2. setReputationAttested(agentId, newRep, nonce, sig) — EIP-191 signed
//      attestation by the registered `judge` address. Anyone can submit it
//      (gas relay friendly); the signature is the trust anchor, not msg.sender.
//
// `judge` is rotatable by `owner` so a compromised key can be cycled without
// a contract redeploy.
contract ReputationOracle {
    address public immutable owner;
    address public judge;

    struct Agent {
        address wallet;
        string handle;
        uint256 registeredAt;
        bool exists;
    }

    mapping(bytes32 => Agent) public agents;
    mapping(bytes32 => uint256) public reputation;
    // Per-agent monotonic nonce — guards against replay of signed attestations.
    mapping(bytes32 => uint256) public attestationNonce;
    bytes32[] public agentIds;

    event AgentRegistered(bytes32 indexed agentId, address indexed wallet, string handle);
    event ReputationUpdated(bytes32 indexed agentId, uint256 oldRep, uint256 newRep);
    event ReputationAttested(
        bytes32 indexed agentId,
        uint256 oldRep,
        uint256 newRep,
        uint256 nonce,
        address indexed relayer
    );
    event JudgeRotated(address indexed previousJudge, address indexed newJudge);

    constructor(address _judge) {
        owner = msg.sender;
        // Allow zero at deploy time; judge can be set later. Self-attest
        // path stays usable so testnet bring-up isn't blocked.
        judge = _judge;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function rotateJudge(address newJudge) external onlyOwner {
        require(newJudge != address(0), "judge=0");
        emit JudgeRotated(judge, newJudge);
        judge = newJudge;
    }

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
        // Only the agent's own wallet can self-attest. Production path:
        // setReputationAttested below — anyone can relay a judge-signed update.
        require(agents[agentId].wallet == msg.sender, "not agent");
        uint256 old = reputation[agentId];
        reputation[agentId] = rep;
        emit ReputationUpdated(agentId, old, rep);
    }

    // Digest the judge signs (EIP-191 personal_sign):
    //   keccak256(chainId, address(this), agentId, newRep, nonce)
    // The relayer (anyone) submits {agentId, newRep, nonce, sig}.
    function reputationDigest(
        bytes32 agentId,
        uint256 newRep,
        uint256 nonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(block.chainid, address(this), agentId, newRep, nonce)
        );
    }

    function setReputationAttested(
        bytes32 agentId,
        uint256 newRep,
        uint256 nonce,
        bytes calldata signature
    ) external {
        require(judge != address(0), "judge unset");
        require(agents[agentId].exists, "no agent");
        require(nonce == attestationNonce[agentId], "bad nonce");
        require(signature.length == 65, "sig length");

        bytes32 raw = reputationDigest(agentId, newRep, nonce);
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", raw)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == judge, "bad sig");

        attestationNonce[agentId] = nonce + 1;
        uint256 old = reputation[agentId];
        reputation[agentId] = newRep;
        emit ReputationUpdated(agentId, old, newRep);
        emit ReputationAttested(agentId, old, newRep, nonce, msg.sender);
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
