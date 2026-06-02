// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Testnet Chainlink AggregatorV3Interface-compatible feed, controllable by an
// off-chain operator. Required on Arbitrum Sepolia because classic Chainlink
// Data Feeds are not deployed there; Data Streams use a different interface.
//
// PRODUCTION NOTE: never use on mainnet. Real markets must point at a true
// Chainlink Aggregator, a Pyth pull oracle, or a Data Streams Verifier.
contract TestAggregatorV3 {
    address public immutable owner;
    uint8 public immutable decimals;
    string public description;

    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _round;

    event AnswerUpdated(int256 indexed current, uint80 indexed round, uint256 updatedAt);

    constructor(uint8 _decimals, string memory _description, int256 initialAnswer) {
        owner = msg.sender;
        decimals = _decimals;
        description = _description;
        _round = 1;
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(initialAnswer, _round, block.timestamp);
    }

    function setAnswer(int256 answer) external {
        require(msg.sender == owner, "not owner");
        _round += 1;
        _answer = answer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(answer, _round, block.timestamp);
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestRound() external view returns (uint80) {
        return _round;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_round, _answer, _updatedAt, _updatedAt, _round);
    }

    function version() external pure returns (uint256) {
        return 1;
    }
}
