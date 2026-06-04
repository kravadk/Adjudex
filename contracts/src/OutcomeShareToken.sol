// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Transferable ERC-20 representing one outcome (YES or NO) of an AMM market.
// Mint/burn are restricted to the owning OutcomeSharePool (the minter), which
// mints on buy / liquidity-surplus and burns on sell / claim. Because the
// shares are now standard ERC-20s they are composable: an on-chain order
// matcher (or any contract) can settle trades by transferring them, which the
// previous internal-balance model could not do.
contract OutcomeShareToken is ERC20 {
    address public immutable minter;
    uint8 private immutable _decimals;

    modifier onlyMinter() {
        require(msg.sender == minter, "not minter");
        _;
    }

    constructor(address minter_, string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        require(minter_ != address(0), "minter=0");
        minter = minter_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    // Minter-authorised burn (no allowance needed): the pool burns a holder's
    // shares as part of sell / claim, which it already gates on the holder.
    function burn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }
}
