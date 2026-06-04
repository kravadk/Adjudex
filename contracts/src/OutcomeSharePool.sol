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
        require(side <= uint8(Side.NO), "bad side");
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
        require(side <= uint8(Side.NO), "bad side");
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
        require(msg.sender == liquidityVault, "not vault");
        require(!resolved, "resolved");
        require(yesAmount > 0 && noAmount > 0, "zero");
        yesReserve += yesAmount;
        noReserve += noAmount;
        emit VaultSeeded(yesAmount, noAmount);
        emit LiquidityAdded(msg.sender, yesAmount, noAmount);
    }

    // Add `amount` collateral as a complete set, preserving the current price.
    // Mints LP shares pro-rata; any over-supplied side is returned to the
    // provider as tradeable outcome shares (Gnosis addFunding semantics).
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused returns (uint256 minted) {
        require(!resolved, "resolved");
        require(amount > 0, "zero");
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
        require(minted > 0, "no lp minted");
        totalLpShares += minted;
        lpBalanceOf[msg.sender] += minted;
        emit LiquidityAdded(msg.sender, amount, amount);
    }

    // Burn LP shares: receive the merged complete set as collateral plus the
    // residual outcome shares of the heavier side.
    function removeLiquidity(uint256 lpAmount) external nonReentrant returns (uint256 collateralOut) {
        require(lpAmount > 0, "zero");
        require(lpBalanceOf[msg.sender] >= lpAmount, "insufficient lp");
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
        require(!resolved, "resolved");
        require(block.timestamp < deadline, "deadline passed");
        require(amount > 0, "zero amount");
        sharesOut = quoteBuy(side, amount);
        require(sharesOut > 0, "zero shares");
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
        require(!resolved, "resolved");
        require(block.timestamp < deadline, "deadline passed");
        require(shares > 0, "zero shares");
        // Recompute the pre-fee collateral R so reserve bookkeeping matches.
        (uint256 reserve, uint256 opposite) = side == uint8(Side.YES)
            ? (yesReserve, noReserve)
            : (noReserve, yesReserve);
        require(reserve > 0 && opposite > 0, "no liquidity");
        uint256 b = reserve + shares + opposite;
        uint256 r = (b - Math.sqrt(b * b - 4 * shares * opposite)) / 2;
        if (r >= opposite) r = opposite - 1;
        amountOut = _netOfFee(r);
        require(amountOut > 0, "zero amount");

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
        require(msg.sender == resolver, "not resolver");
        require(!resolved, "resolved");
        require(side <= uint8(Side.NO), "bad side");
        resolved = true;
        resolvedSide = Side(side);
        emit MarketResolved(side);
    }

    // Winning shares redeem 1:1 for collateral (complete-set backing). The
    // trading fee was already taken on buy/sell, so redemption is fee-free.
    function claim(uint8 side, uint256 shares) external nonReentrant returns (uint256 payout) {
        require(resolved, "not resolved");
        require(side == uint8(resolvedSide), "losing side");
        require(shares > 0, "zero shares");

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
