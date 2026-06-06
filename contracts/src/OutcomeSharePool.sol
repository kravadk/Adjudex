// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OutcomeShareToken} from "./OutcomeShareToken.sol";

interface ILiquidityVault {
    function repay(uint256 amount) external;
}

// Binary outcome AMM with a real constant-product invariant (x*y=k), modelled
// on the Gnosis Fixed-Product Market Maker. Collateral is handled as complete
// sets: 1 USDC <-> 1 YES + 1 NO, and a winning share redeems 1:1 after
// resolution. Liquidity providers hold LP shares and earn from the spread the
// invariant creates; the protocol fee is skimmed to feeRecipient on each trade.
//
// Reserves (yesReserve, noReserve) are the AMM's outcome-token inventory; their
// product is the invariant k, preserved by every buy/sell and only re-based by
// add/remove liquidity. yesShares/noShares track outstanding USER-held shares
// for redemption solvency.
//
// Reverts use custom errors (cheaper deployed bytecode than revert strings,
// which matters because MarketFactory embeds this contract's creation code).
contract OutcomeSharePool is ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum Side { YES, NO }

    error Zero();
    error BadSide();
    error NotResolver();
    error AlreadyResolved();
    error NotResolved();
    error DeadlinePassed();
    error DeadlineInPast();
    error FeeTooHigh();
    error FeeRecipientZero();
    error StakeZero();
    error ResolverZero();
    error VaultZero();
    error NotVault();
    error NoLpMinted();
    error InsufficientLp();
    error NoLiquidity();
    error LosingSide();
    error ExceedsSurplus();
    error BadAmount();

    IERC20 public immutable stake;
    bytes32 public immutable specHash;
    uint256 public immutable deadline;
    uint256 public immutable feeBps;
    address public immutable feeRecipient;
    address public immutable resolver;
    address public immutable liquidityVault;

    uint256 public yesReserve;
    uint256 public noReserve;
    uint256 public totalLpShares;
    bool public resolved;
    Side public resolvedSide;

    // Outcome shares are transferable ERC-20s minted/burned by this pool, so an
    // order matcher (or any contract) can settle trades by moving them.
    OutcomeShareToken public immutable yesToken;
    OutcomeShareToken public immutable noToken;

    mapping(address => uint256) public lpBalanceOf;

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
        if (stakeToken == address(0)) revert StakeZero();
        if (_resolver == address(0)) revert ResolverZero();
        if (_deadline <= block.timestamp) revert DeadlineInPast();
        if (_feeBps > 500) revert FeeTooHigh();
        if (_feeBps != 0 && _feeRecipient == address(0)) revert FeeRecipientZero();
        stake = IERC20(stakeToken);
        specHash = _specHash;
        resolver = _resolver;
        deadline = _deadline;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        liquidityVault = _liquidityVault;
        yesToken = new OutcomeShareToken(address(this), "Adjudex YES Share", "aYES", 6);
        noToken = new OutcomeShareToken(address(this), "Adjudex NO Share", "aNO", 6);
    }

    // Constant-product invariant. Zero until the pool is seeded with liquidity.
    function invariant() external view returns (uint256) {
        return yesReserve * noReserve;
    }

    // Back-compat views (same selectors as the former public mappings / counters)
    // now backed by the ERC-20 share tokens.
    function yesShares() external view returns (uint256) {
        return yesToken.totalSupply();
    }

    function noShares() external view returns (uint256) {
        return noToken.totalSupply();
    }

    function yesBalanceOf(address account) external view returns (uint256) {
        return yesToken.balanceOf(account);
    }

    function noBalanceOf(address account) external view returns (uint256) {
        return noToken.balanceOf(account);
    }

    function _netOfFee(uint256 amount) internal view returns (uint256) {
        return feeBps == 0 ? amount : amount - (amount * feeBps) / 10_000;
    }

    // Shares received for spending `amount` collateral (fee already deducted).
    // x*y=k: buying side S with net `a` pushes a into both reserves, then the
    // trader takes the side-S excess so the product is preserved.
    function quoteBuy(uint8 side, uint256 amount) public view returns (uint256 sharesOut) {
        if (side > uint8(Side.NO)) revert BadSide();
        if (amount == 0) return 0;
        uint256 net = _netOfFee(amount);
        (uint256 reserve, uint256 opposite) = side == uint8(Side.YES)
            ? (yesReserve, noReserve)
            : (noReserve, yesReserve);
        // Unseeded pool bootstraps at 1:1 so the first liquidity defines price.
        if (reserve == 0 || opposite == 0) return net;
        uint256 k = reserve * opposite;
        uint256 denom = opposite + net;
        // Ceil so the ending product is >= k — rounding favours the pool (LPs),
        // never the trader.
        uint256 endingReserve = (k + denom - 1) / denom;
        return reserve + net - endingReserve;
    }

    // Collateral returned (fee already deducted) for selling `shares` of `side`.
    // Solves (reserve+shares-R)(opposite-R)=k for R via the quadratic root.
    function quoteSell(uint8 side, uint256 shares) public view returns (uint256 amountOut) {
        if (side > uint8(Side.NO)) revert BadSide();
        if (shares == 0) return 0;
        (uint256 reserve, uint256 opposite) = side == uint8(Side.YES)
            ? (yesReserve, noReserve)
            : (noReserve, yesReserve);
        if (reserve == 0 || opposite == 0) return 0;
        uint256 b = reserve + shares + opposite;
        uint256 disc = b * b - 4 * shares * opposite;
        uint256 r = (b - Math.sqrt(disc)) / 2;
        if (r >= opposite) r = opposite - 1; // never drain the opposite reserve
        return _netOfFee(r);
    }

    // Vault-seeded liquidity (no LP shares minted to the vault; the vault
    // reclaims via repayVault after resolution). Defines the opening line.
    function seedFromVault(uint256 yesAmount, uint256 noAmount) external nonReentrant {
        if (msg.sender != liquidityVault) revert NotVault();
        if (resolved) revert AlreadyResolved();
        if (yesAmount == 0 || noAmount == 0) revert Zero();
        yesReserve += yesAmount;
        noReserve += noAmount;
        emit VaultSeeded(yesAmount, noAmount);
        emit LiquidityAdded(msg.sender, yesAmount, noAmount);
    }

    // Add `amount` collateral as a complete set, preserving the current price.
    // Mints LP shares pro-rata; any over-supplied side is returned to the
    // provider as tradeable outcome shares (Gnosis addFunding semantics).
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused returns (uint256 minted) {
        if (resolved) revert AlreadyResolved();
        if (amount == 0) revert Zero();
        stake.safeTransferFrom(msg.sender, address(this), amount);

        if (totalLpShares == 0 || yesReserve == 0 || noReserve == 0) {
            yesReserve += amount;
            noReserve += amount;
            minted = amount;
        } else {
            uint256 weight = Math.max(yesReserve, noReserve);
            minted = (amount * totalLpShares) / weight;
            uint256 sendYes = amount - (amount * yesReserve) / weight;
            uint256 sendNo = amount - (amount * noReserve) / weight;
            yesReserve += amount;
            noReserve += amount;
            if (sendYes > 0) {
                yesReserve -= sendYes;
                yesToken.mint(msg.sender, sendYes);
            }
            if (sendNo > 0) {
                noReserve -= sendNo;
                noToken.mint(msg.sender, sendNo);
            }
        }
        if (minted == 0) revert NoLpMinted();
        totalLpShares += minted;
        lpBalanceOf[msg.sender] += minted;
        emit LiquidityAdded(msg.sender, amount, amount);
    }

    // Burn LP shares: receive the merged complete set as collateral plus the
    // residual outcome shares of the heavier side.
    function removeLiquidity(uint256 lpAmount) external nonReentrant returns (uint256 collateralOut) {
        if (lpAmount == 0) revert Zero();
        if (lpBalanceOf[msg.sender] < lpAmount) revert InsufficientLp();
        uint256 supply = totalLpShares;
        uint256 sendYes = (yesReserve * lpAmount) / supply;
        uint256 sendNo = (noReserve * lpAmount) / supply;

        lpBalanceOf[msg.sender] -= lpAmount;
        totalLpShares -= lpAmount;
        yesReserve -= sendYes;
        noReserve -= sendNo;

        collateralOut = Math.min(sendYes, sendNo);
        uint256 surplusYes = sendYes - collateralOut;
        uint256 surplusNo = sendNo - collateralOut;
        if (surplusYes > 0) yesToken.mint(msg.sender, surplusYes);
        if (surplusNo > 0) noToken.mint(msg.sender, surplusNo);
        if (collateralOut > 0) stake.safeTransfer(msg.sender, collateralOut);
        emit LiquidityRemoved(msg.sender, collateralOut);
    }

    function buy(uint8 side, uint256 amount) external nonReentrant whenNotPaused returns (uint256 sharesOut) {
        if (resolved) revert AlreadyResolved();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (amount == 0) revert Zero();
        sharesOut = quoteBuy(side, amount);
        if (sharesOut == 0) revert Zero();
        uint256 net = _netOfFee(amount);

        if (side == uint8(Side.YES)) {
            yesReserve = yesReserve + net - sharesOut;
            noReserve += net;
            yesToken.mint(msg.sender, sharesOut);
        } else {
            noReserve = noReserve + net - sharesOut;
            yesReserve += net;
            noToken.mint(msg.sender, sharesOut);
        }

        stake.safeTransferFrom(msg.sender, address(this), amount);
        uint256 fee = amount - net;
        if (fee > 0) stake.safeTransfer(feeRecipient, fee);
        emit SharesBought(msg.sender, side, amount, sharesOut);
    }

    function sell(uint8 side, uint256 shares) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        if (resolved) revert AlreadyResolved();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (shares == 0) revert Zero();
        // Recompute the pre-fee collateral R so reserve bookkeeping matches.
        (uint256 reserve, uint256 opposite) = side == uint8(Side.YES)
            ? (yesReserve, noReserve)
            : (noReserve, yesReserve);
        if (reserve == 0 || opposite == 0) revert NoLiquidity();
        uint256 b = reserve + shares + opposite;
        uint256 r = (b - Math.sqrt(b * b - 4 * shares * opposite)) / 2;
        if (r >= opposite) r = opposite - 1;
        amountOut = _netOfFee(r);
        if (amountOut == 0) revert Zero();

        if (side == uint8(Side.YES)) {
            yesToken.burn(msg.sender, shares); // reverts if balance < shares
            yesReserve = yesReserve + shares - r;
            noReserve -= r;
        } else {
            noToken.burn(msg.sender, shares);
            noReserve = noReserve + shares - r;
            yesReserve -= r;
        }

        uint256 fee = r - amountOut;
        if (fee > 0) stake.safeTransfer(feeRecipient, fee);
        stake.safeTransfer(msg.sender, amountOut);
        emit SharesSold(msg.sender, side, shares, amountOut);
    }

    function resolve(uint8 side) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (resolved) revert AlreadyResolved();
        if (side > uint8(Side.NO)) revert BadSide();
        resolved = true;
        resolvedSide = Side(side);
        emit MarketResolved(side);
    }

    // Winning shares redeem 1:1 for collateral (complete-set backing). The
    // trading fee was already taken on buy/sell, so redemption is fee-free.
    function claim(uint8 side, uint256 shares) external nonReentrant returns (uint256 payout) {
        if (!resolved) revert NotResolved();
        if (side != uint8(resolvedSide)) revert LosingSide();
        if (shares == 0) revert Zero();

        if (side == uint8(Side.YES)) {
            yesToken.burn(msg.sender, shares);
        } else {
            noToken.burn(msg.sender, shares);
        }
        payout = shares;
        stake.safeTransfer(msg.sender, payout);
        emit Claimed(msg.sender, side, shares, payout);
    }

    // After resolution the losing-side reserve is surplus collateral the vault
    // seeded; return it so vault accounting closes.
    function repayVault(uint256 amount) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver();
        if (!resolved) revert NotResolved();
        if (liquidityVault == address(0)) revert VaultZero();
        if (amount == 0) revert BadAmount();
        if (resolvedSide == Side.YES) {
            if (amount > noReserve) revert ExceedsSurplus();
            noReserve -= amount;
        } else {
            if (amount > yesReserve) revert ExceedsSurplus();
            yesReserve -= amount;
        }
        stake.forceApprove(liquidityVault, amount);
        ILiquidityVault(liquidityVault).repay(amount);
    }
}
