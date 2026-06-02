// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// BetQuoteVerifier — EIP-712 verifier for signed bet quotes.
//
// The backend (services/api) signs a `BetQuote` with the platform quote
// signer key. Clients submit the signed quote alongside the bet; on-chain
// callers verify the signature, the deadline, and the slippage bounds
// before executing the bet.
//
// Integration:
//   1. Client calls POST /v1/bet-quotes → backend returns BetQuote +
//      signature (this contract's chainId/address bound via EIP-712 domain).
//   2. Client calls a quote-aware bet wrapper (added to ParimutuelPool in
//      a future upgrade) that re-verifies via this contract.
//
// Until the Pool wrapper exists, this contract serves as a standalone
// public verifier so the front-end and any external integrator can sanity
// check the backend signer against on-chain truth.
contract BetQuoteVerifier {
    address public immutable quoteSigner;

    // EIP-712 type hash for the BetQuote struct.
    bytes32 public constant BET_QUOTE_TYPEHASH =
        keccak256(
            "BetQuote(address pool,uint256 marketId,uint8 side,uint256 stake,uint256 minShares,uint256 maxPoolImpactBps,uint256 deadline,uint256 nonce,address bettor)"
        );

    // EIP-712 domain separator components.
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
    bytes32 public immutable nameHash;
    bytes32 public immutable versionHash;

    // Replay protection: each (bettor, nonce) can be consumed only once.
    mapping(address => mapping(uint256 => bool)) public consumedNonces;

    event QuoteConsumed(address indexed bettor, uint256 indexed nonce, bytes32 indexed quoteHash);

    struct BetQuote {
        address pool;
        uint256 marketId;
        uint8 side;
        uint256 stake;
        uint256 minShares;
        uint256 maxPoolImpactBps;
        uint256 deadline;
        uint256 nonce;
        address bettor;
    }

    constructor(address _quoteSigner) {
        require(_quoteSigner != address(0), "signer=0");
        quoteSigner = _quoteSigner;
        nameHash = keccak256(bytes("Adjudex Bet Quote"));
        versionHash = keccak256(bytes("1"));
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                nameHash,
                versionHash,
                block.chainid,
                address(this)
            )
        );
    }

    function hashQuote(BetQuote calldata q) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BET_QUOTE_TYPEHASH,
                q.pool,
                q.marketId,
                q.side,
                q.stake,
                q.minShares,
                q.maxPoolImpactBps,
                q.deadline,
                q.nonce,
                q.bettor
            )
        );
    }

    function digest(BetQuote calldata q) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), hashQuote(q)));
    }

    function verify(BetQuote calldata q, bytes calldata signature) public view returns (bool) {
        require(signature.length == 65, "sig length");
        bytes32 h = digest(q);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(h, v, r, s);
        return recovered != address(0) && recovered == quoteSigner;
    }

    /// Consume a quote: enforces signature, deadline, nonce uniqueness.
    /// Reverts if the quote is invalid or already used. Returns the
    /// quote hash so callers can log it in their own events.
    function consume(BetQuote calldata q, bytes calldata signature) external returns (bytes32) {
        require(block.timestamp <= q.deadline, "expired");
        require(q.bettor == msg.sender, "bettor mismatch");
        require(!consumedNonces[q.bettor][q.nonce], "nonce used");
        require(verify(q, signature), "bad sig");
        consumedNonces[q.bettor][q.nonce] = true;
        bytes32 h = hashQuote(q);
        emit QuoteConsumed(q.bettor, q.nonce, h);
        return h;
    }
}
