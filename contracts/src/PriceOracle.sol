// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
    function decimals() external view returns (uint8);
}

// PriceOracle V1: dual-source.
//   1) `setPrice(key, price, ts)` - operator-pushed testnet value
//   2) `setFeed(key, aggregator)` - Chainlink AggregatorV3 (when available)
// `getPrice(key)` prefers Chainlink if a feed is registered; else manual.
// All prices normalised to 8 decimals.
contract PriceOracle {
    address public immutable owner;

    struct ManualPrice {
        uint256 price;
        uint256 updatedAt;
        bool exists;
    }

    mapping(bytes32 => ManualPrice) public manual;
    mapping(bytes32 => address) public feeds;

    event PriceSet(bytes32 indexed key, uint256 price, uint256 updatedAt);
    event FeedSet(bytes32 indexed key, address feed);

    constructor() { owner = msg.sender; }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function setPrice(bytes32 key, uint256 price, uint256 updatedAt) external onlyOwner {
        manual[key] = ManualPrice({ price: price, updatedAt: updatedAt, exists: true });
        emit PriceSet(key, price, updatedAt);
    }

    function setFeed(bytes32 key, address aggregator) external onlyOwner {
        feeds[key] = aggregator;
        emit FeedSet(key, aggregator);
    }

    function getPrice(bytes32 key) external view returns (uint256 price, uint256 updatedAt) {
        address feed = feeds[key];
        if (feed != address(0)) {
            (, int256 answer, , uint256 ts, ) = AggregatorV3Interface(feed).latestRoundData();
            require(answer > 0, "bad feed");
            uint8 dec = AggregatorV3Interface(feed).decimals();
            uint256 raw = uint256(answer);
            if (dec == 8) return (raw, ts);
            if (dec < 8) return (raw * (10 ** (8 - dec)), ts);
            return (raw / (10 ** (dec - 8)), ts);
        }
        ManualPrice memory m = manual[key];
        require(m.exists, "no price");
        return (m.price, m.updatedAt);
    }

    function keyFor(string calldata symbol) external pure returns (bytes32) {
        return keccak256(bytes(symbol));
    }
}
