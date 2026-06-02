// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ProofAnchor — public registry that emits a discoverable on-chain event
// for every Reclaim zkTLS proof captured off-chain.
//
// The Reclaim payload itself is too large to put on-chain, so the backend
// pins it to IPFS and calls `anchor(sessionId, proofHash, cid)` here.
// Indexers + the AI Judge can then resolve a proof by sessionId without
// trusting any single API server's in-memory store.
//
// `proofHash` is the keccak256 of the canonical-JSON proof payload — the
// same value bound into AIJudgeVerifier.evidenceHash so a verdict can be
// cryptographically tied to a specific on-chain proof anchor.
//
// `cid` is the IPFS content identifier of the pinned payload (typically a
// CIDv1 base32 string). Stored as bytes so non-IPFS storage providers
// (Arweave tx id, etc.) can use the same anchor primitive.
//
// Anyone may call `anchor()` — the proof is authenticated by the signed
// AIJudgeVerifier verdict that references this `proofHash`, not by msg.sender.
// Duplicate anchors for the same sessionId are rejected so the first
// publisher binds the hash.
contract ProofAnchor {
    struct Anchor {
        bytes32 proofHash;
        bytes cid;
        address publisher;
        uint64 anchoredAt;
    }

    mapping(bytes32 => Anchor) public anchors;

    event ProofAnchored(
        bytes32 indexed sessionIdHash,
        bytes32 indexed proofHash,
        address indexed publisher,
        bytes cid,
        uint64 anchoredAt
    );

    function anchor(string calldata sessionId, bytes32 proofHash, bytes calldata cid) external {
        require(proofHash != bytes32(0), "proofHash=0");
        require(cid.length > 0, "cid empty");
        bytes32 key = keccak256(bytes(sessionId));
        require(anchors[key].proofHash == bytes32(0), "anchored");

        anchors[key] = Anchor({
            proofHash: proofHash,
            cid: cid,
            publisher: msg.sender,
            anchoredAt: uint64(block.timestamp)
        });
        emit ProofAnchored(key, proofHash, msg.sender, cid, uint64(block.timestamp));
    }

    function getAnchor(string calldata sessionId)
        external
        view
        returns (Anchor memory)
    {
        return anchors[keccak256(bytes(sessionId))];
    }

    function getAnchorByKey(bytes32 sessionIdHash)
        external
        view
        returns (Anchor memory)
    {
        return anchors[sessionIdHash];
    }

    function isAnchored(string calldata sessionId) external view returns (bool) {
        return anchors[keccak256(bytes(sessionId))].proofHash != bytes32(0);
    }
}
