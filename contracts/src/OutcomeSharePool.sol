// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

interface ILiquidityVault {
    function repay(uint256 amount) external;
}

contract OutcomeSharePool is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum Side { YES, NO }

    IERC20 public immutable stake;
    bytes32 public immutable specHash;
    uint256 public immutable deadline;
    uint256 public immutable feeBps;
    address public immutable feeRecipient;
    address public immutable resolver;
    address public immutable liquidityVault;

    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public yesShares;
    uint256 public noShares;
    bool public resolved;
    Side public resolvedSide;

    mapping(address => uint256) public yesBalanceOf;
    mapping(address => uint256) public noBalanceOf;

    event SharesBought(address indexed trader, uint8 side, uint256 amount, uint256 shares);
    event SharesSold(address indexed trader, uint8 side, uint256 shares, uint256 amount);
    event LiquidityAdded(address indexed provider, uint256 yesAmount, uint256 noAmount);
    event LiquidityRemoved(address indexed provider, uint256 amount);
    event MarketResolved(uint8 side);
    event Claimed(address indexed trader, uint8 side, uint256 shares, uint256 payout);
    event VaultSeeded(uint256 yesAmount, uint256 noAmount);

    constructor(
        address stakeToken,
        bytes32 _specHash,
        address _resolver,
        uint256 _deadline,
        uint256 _feeBps,
        address _feeRecipient,
        address _liquidityVault
    ) {
        require(stakeToken != address(0), "stake=0");
        require(_resolver != address(0), "resolver=0");
        require(_deadline > block.timestamp, "deadline in past");
        require(_feeBps <= 500, "fee too high");
        require(_feeBps == 0 || _feeRecipient != address(0), "feeRecipient=0");
        stake = IERC20(stakeToken);
        specHash = _specHash;
        resolver = _resolver;
        deadline = _deadline;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        liquidityVault = _liquidityVault;
    }

    function quoteBuy(uint8 side, uint256 amount) public view returns (uint256 sharesOut) {
        require(side <= uint8(Side.NO), "bad side");
        if (amount == 0) return 0;
        (uint256 reserve, uint256 supply) = side == uint8(Side.YES)
            ? (yesReserve, yesShares)
            : (noReserve, noShares);
        if (supply == 0 || reserve == 0) return amount;
        uint256 oppositeReserve = side == uint8(Side.YES) ? noReserve : yesReserve;
        if (oppositeReserve == 0) return (amount * supply) / reserve;
        return (amount * oppositeReserve) / (reserve + amount);
    }

    function quoteSell(uint8 side, uint256 shares) public view returns (uint256 amountOut) {
        require(side <= uint8(Side.NO), "bad side");
        if (shares == 0) return 0;
        (uint256 reserve, uint256 supply) = side == uint8(Side.YES)
            ? (yesReserve, yesShares)
            : (noReserve, noShares);
        if (supply == 0) return 0;
        uint256 oppositeReserve = side == uint8(Side.YES) ? noReserve : yesReserve;
        if (oppositeReserve == 0) return (shares * reserve) / supply;
        return (shares * reserve) / (oppositeReserve + shares);
    }

    function seedFromVault(uint256 yesAmount, uint256 noAmount) external nonReentrant {
        require(msg.sender == liquidityVault, "not vault");
        require(!resolved, "resolved");
        require(yesAmount > 0 || noAmount > 0, "zero");
        yesReserve += yesAmount;
        noReserve += noAmount;
        emit VaultSeeded(yesAmount, noAmount);
        emit LiquidityAdded(msg.sender, yesAmount, noAmount);
    }

    function addLiquidity(uint256 yesAmount, uint256 noAmount) external nonReentrant whenNotPaused {
        require(!resolved, "resolved");
        require(yesAmount > 0 || noAmount > 0, "zero");
        if (yesAmount > 0) {
            yesReserve += yesAmount;
            stake.safeTransferFrom(msg.sender, address(this), yesAmount);
        }
        if (noAmount > 0) {
            noReserve += noAmount;
            stake.safeTransferFrom(msg.sender, address(this), noAmount);
        }
        emit LiquidityAdded(msg.sender, yesAmount, noAmount);
    }

    function buy(uint8 side, uint256 amount) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        require(!resolved, "resolved");
        require(block.timestamp < deadline, "deadline passed");
        sharesOut = quoteBuy(side, amount);
        require(sharesOut > 0, "zero shares");
        if (side == uint8(Side.YES)) {
            yesReserve += amount;
            yesShares += sharesOut;
            yesBalanceOf[msg.sender] += sharesOut;
        } else {
            noReserve += amount;
            noShares += sharesOut;
            noBalanceOf[msg.sender] += sharesOut;
        }
        stake.safeTransferFrom(msg.sender, address(this), amount);
        emit SharesBought(msg.sender, side, amount, sharesOut);
    }

    function sell(uint8 side, uint256 shares) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(!resolved, "resolved");
        require(block.timestamp < deadline, "deadline passed");
        amountOut = quoteSell(side, shares);
        require(amountOut > 0, "zero amount");
        if (side == uint8(Side.YES)) {
            require(yesBalanceOf[msg.sender] >= shares, "insufficient");
            yesBalanceOf[msg.sender] -= shares;
            yesShares -= shares;
            yesReserve -= amountOut;
        } else {
            require(noBalanceOf[msg.sender] >= shares, "insufficient");
            noBalanceOf[msg.sender] -= shares;
            noShares -= shares;
            noReserve -= amountOut;
        }
        stake.safeTransfer(msg.sender, amountOut);
        emit SharesSold(msg.sender, side, shares, amountOut);
    }

    function resolve(uint8 side) external nonReentrant {
        require(msg.sender == resolver, "not resolver");
        require(!resolved, "resolved");
        require(side <= uint8(Side.NO), "bad side");
        resolved = true;
        resolvedSide = Side(side);
        emit MarketResolved(side);
    }

    function claim(uint8 side, uint256 shares) external nonReentrant returns (uint256 payout) {
        require(resolved, "not resolved");
        require(side == uint8(resolvedSide), "losing side");
        require(shares > 0, "zero shares");

        if (side == uint8(Side.YES)) {
            require(yesBalanceOf[msg.sender] >= shares, "insufficient");
            payout = quoteSell(side, shares);
            yesBalanceOf[msg.sender] -= shares;
            yesShares -= shares;
            yesReserve -= payout;
        } else {
            require(noBalanceOf[msg.sender] >= shares, "insufficient");
            payout = quoteSell(side, shares);
            noBalanceOf[msg.sender] -= shares;
            noShares -= shares;
            noReserve -= payout;
        }

        uint256 fee = feeBps == 0 ? 0 : (payout * feeBps) / 10_000;
        if (fee > 0) stake.safeTransfer(feeRecipient, fee);
        stake.safeTransfer(msg.sender, payout - fee);
        emit Claimed(msg.sender, side, shares, payout - fee);
    }

    function repayVault(uint256 amount) external nonReentrant {
        require(msg.sender == resolver, "not resolver");
        require(resolved, "not resolved");
        require(liquidityVault != address(0), "vault=0");
        require(amount > 0, "bad amount");
        if (resolvedSide == Side.YES) {
            require(amount <= noReserve, "exceeds surplus");
            noReserve -= amount;
        } else {
            require(amount <= yesReserve, "exceeds surplus");
            yesReserve -= amount;
        }
        stake.forceApprove(liquidityVault, amount);
        ILiquidityVault(liquidityVault).repay(amount);
    }
}
