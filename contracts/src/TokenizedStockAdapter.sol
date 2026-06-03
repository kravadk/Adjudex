// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// Registry for tokenized stocks (xStocks/Ondo-style). Markets reference assets
// by ticker. `active` lets the operator handle corp actions (delisting, ticker
// change) without breaking already-settled markets.
contract TokenizedStockAdapter is Ownable {
    struct Asset {
        address token;
        bool active;
    }

    mapping(bytes32 => Asset) public assets;
    bytes32[] public tickers;

    event AssetRegistered(bytes32 indexed ticker, address token);
    event AssetActiveSet(bytes32 indexed ticker, bool active);

    constructor() Ownable(msg.sender) {}

    function register(string calldata ticker, address token) external onlyOwner returns (bytes32 key) {
        require(token != address(0), "token=0");
        key = keccak256(bytes(ticker));
        require(assets[key].token == address(0), "exists");
        assets[key] = Asset({ token: token, active: true });
        tickers.push(key);
        emit AssetRegistered(key, token);
    }

    function setActive(bytes32 key, bool active) external onlyOwner {
        require(assets[key].token != address(0), "unknown");
        assets[key].active = active;
        emit AssetActiveSet(key, active);
    }

    function tokenOf(string calldata ticker) external view returns (address token, bool active) {
        Asset memory a = assets[keccak256(bytes(ticker))];
        return (a.token, a.active);
    }

    function tickerCount() external view returns (uint256) {
        return tickers.length;
    }
}
