// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Testnet-only USDC faucet token. 6 decimals to match USDC. Permissionless mint.
// NOT for mainnet. Real Arbitrum One USDC: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
