// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LiquidityVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stake;
    address public factory;
    uint256 public totalOutstandingDebt;

    mapping(address => uint256) public marketDebt;
    mapping(address => uint256) public marketSurplus;
    mapping(address => bool) public registeredMarket;

    event FactorySet(address indexed factory);
    event MarketRegistered(address indexed market, uint256 seedAmount);
    event DebtRepaid(address indexed market, uint256 repaid, uint256 surplus);
    event SurplusClaimed(address indexed market, address indexed recipient, uint256 amount);

    constructor(address stakeToken) Ownable(msg.sender) {
        require(stakeToken != address(0), "stake=0");
        stake = IERC20(stakeToken);
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "not factory");
        _;
    }

    function setFactory(address nextFactory) external onlyOwner {
        require(nextFactory != address(0), "factory=0");
        factory = nextFactory;
        emit FactorySet(nextFactory);
    }

    function registerMarket(address market, uint256 seedAmount) external nonReentrant onlyFactory {
        require(market != address(0), "market=0");
        require(!registeredMarket[market], "registered");
        registeredMarket[market] = true;
        marketDebt[market] = seedAmount;
        totalOutstandingDebt += seedAmount;
        if (seedAmount > 0) {
            stake.safeTransfer(market, seedAmount);
            uint256 yesAmount = seedAmount / 2;
            ISeededLiquidityMarket(market).seedFromVault(yesAmount, seedAmount - yesAmount);
        }
        emit MarketRegistered(market, seedAmount);
    }

    function repay(uint256 amount) external nonReentrant {
        require(registeredMarket[msg.sender], "not market");
        uint256 debt = marketDebt[msg.sender];
        require(debt > 0 || amount > 0, "nothing to repay");
        if (amount > 0) {
            stake.safeTransferFrom(msg.sender, address(this), amount);
        }
        uint256 repaid = amount > debt ? debt : amount;
        uint256 surplus = amount > debt ? amount - debt : 0;
        marketDebt[msg.sender] = debt - repaid;
        totalOutstandingDebt -= repaid;
        marketSurplus[msg.sender] += surplus;
        emit DebtRepaid(msg.sender, repaid, surplus);
    }

    function claimSurplus(address market, address recipient) external nonReentrant onlyOwner returns (uint256 amount) {
        require(recipient != address(0), "recipient=0");
        amount = marketSurplus[market];
        require(amount > 0, "no surplus");
        marketSurplus[market] = 0;
        stake.safeTransfer(recipient, amount);
        emit SurplusClaimed(market, recipient, amount);
    }
}

interface ISeededLiquidityMarket {
    function seedFromVault(uint256 yesAmount, uint256 noAmount) external;
}
