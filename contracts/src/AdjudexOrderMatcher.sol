// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract AdjudexOrderMatcher is Ownable2Step, Pausable {
    using ECDSA for bytes32;

    enum OrderType { BUY, SELL }

    struct OrderIntent {
        uint256 marketId;
        address pool;
        uint8 side;
        OrderType orderType;
        uint256 amount;
        uint256 limitPriceBps;
        uint256 expiresAt;
        uint256 nonce;
        address maker;
        address builder;
        bytes32 metadataHash;
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "OrderIntent(uint256 marketId,address pool,uint8 side,uint8 orderType,uint256 amount,uint256 limitPriceBps,uint256 expiresAt,uint256 nonce,address maker,address builder,bytes32 metadataHash)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;
    uint256 public maxFeeRateBps = 500;

    mapping(bytes32 => bool) public cancelled;
    mapping(address => uint256) public minValidNonce;
    mapping(bytes32 => uint256) public filled;

    event OrdersMatched(bytes32 indexed takerHash, uint256 makerCount, uint256 totalAmount);
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event NonceCancelled(address indexed maker, uint256 minNonce);
    event FeeCharged(address indexed recipient, uint256 amount, uint256 feeBps);

    constructor() Ownable(msg.sender) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AdjudexOrderMatcher")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function hashOrder(OrderIntent calldata order) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        ORDER_TYPEHASH,
                        order.marketId,
                        order.pool,
                        order.side,
                        uint8(order.orderType),
                        order.amount,
                        order.limitPriceBps,
                        order.expiresAt,
                        order.nonce,
                        order.maker,
                        order.builder,
                        order.metadataHash
                    )
                )
            )
        );
    }

    function verify(OrderIntent calldata order, bytes calldata signature) public view returns (bool) {
        if (order.maker == address(0) || order.pool == address(0)) return false;
        if (block.timestamp > order.expiresAt) return false;
        if (order.nonce < minValidNonce[order.maker]) return false;
        bytes32 orderHash = hashOrder(order);
        if (cancelled[orderHash]) return false;
        return SignatureChecker.isValidSignatureNow(order.maker, orderHash, signature);
    }

    function cancelOrder(OrderIntent calldata order) external {
        require(order.maker == msg.sender, "not maker");
        bytes32 orderHash = hashOrder(order);
        cancelled[orderHash] = true;
        emit OrderCancelled(orderHash, msg.sender);
    }

    function cancelUpTo(uint256 nonce) external {
        require(nonce > minValidNonce[msg.sender], "nonce too low");
        minValidNonce[msg.sender] = nonce;
        emit NonceCancelled(msg.sender, nonce);
    }

    function matchOrders(
        OrderIntent calldata taker,
        bytes calldata takerSignature,
        OrderIntent[] calldata makers,
        bytes[] calldata makerSignatures,
        uint256 feeBps,
        address feeRecipient
    ) external whenNotPaused returns (uint256 totalAmount) {
        require(feeBps <= maxFeeRateBps, "fee too high");
        require(makers.length == makerSignatures.length, "length mismatch");
        require(verify(taker, takerSignature), "bad taker");
        bytes32 takerHash = hashOrder(taker);
        for (uint256 i = 0; i < makers.length; i++) {
            require(verify(makers[i], makerSignatures[i]), "bad maker");
            require(makers[i].marketId == taker.marketId, "market mismatch");
            require(makers[i].pool == taker.pool, "pool mismatch");
            require(makers[i].side == taker.side, "side mismatch");
            require(makers[i].orderType != taker.orderType, "same type");
            require(_pricesCross(taker, makers[i]), "price no cross");
            bytes32 makerHash = hashOrder(makers[i]);
            filled[makerHash] += makers[i].amount;
            totalAmount += makers[i].amount;
        }
        require(totalAmount > 0, "no fills");
        filled[takerHash] += totalAmount;
        emit OrdersMatched(takerHash, makers.length, totalAmount);
        if (feeBps > 0) emit FeeCharged(feeRecipient, totalAmount, feeBps);
    }

    function setMaxFeeRateBps(uint256 next) external onlyOwner {
        require(next <= 1000, "too high");
        maxFeeRateBps = next;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _pricesCross(OrderIntent calldata a, OrderIntent calldata b) internal pure returns (bool) {
        if (a.orderType == OrderType.BUY) return a.limitPriceBps >= b.limitPriceBps;
        return b.limitPriceBps >= a.limitPriceBps;
    }
}
