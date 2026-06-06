// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestUSDC} from "../contracts/src/TestUSDC.sol";
import {ParimutuelPool} from "../contracts/src/ParimutuelPool.sol";
import {OutcomeSharePool} from "../contracts/src/OutcomeSharePool.sol";
import {AdjudexOrderMatcher} from "../contracts/src/AdjudexOrderMatcher.sol";
import {AdjudexTimelock} from "../contracts/src/AdjudexTimelock.sol";
import {ExclusiveOutcomeRegistry} from "../contracts/src/ExclusiveOutcomeRegistry.sol";
import {ExclusiveGroupSettler} from "../contracts/src/ExclusiveGroupSettler.sol";

// Bytecode-level tests for the core money paths. Run: `forge test -vvv`
// (one-time: `forge install foundry-rs/forge-std`).

contract ParimutuelTest is Test {
    TestUSDC usdc;
    ParimutuelPool pool;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        usdc = new TestUSDC();
        // resolver = this, feeBps = 0 for exact pari-mutuel math.
        pool = new ParimutuelPool(address(usdc), bytes32("spec"), address(this), block.timestamp + 1 days, 0, address(0), address(0));
    }

    function _bet(address u, uint8 side, uint256 amt) internal returns (uint256 pid) {
        usdc.mint(u, amt);
        vm.startPrank(u);
        usdc.approve(address(pool), amt);
        pid = pool.bet(side, amt);
        vm.stopPrank();
    }

    function test_winner_takes_whole_pool() public {
        uint256 aPos = _bet(alice, 0, 100e6); // YES
        _bet(bob, 1, 100e6); // NO
        pool.resolve(0); // YES wins
        vm.prank(alice);
        uint256 payout = pool.claim(aPos);
        assertEq(payout, 200e6, "sole YES winner takes entire pool");
        assertEq(usdc.balanceOf(alice), 200e6);
    }

    function test_pro_rata_split() public {
        uint256 a = _bet(alice, 0, 150e6); // YES
        uint256 b = _bet(bob, 0, 50e6); // YES
        _bet(address(0xCAFE), 1, 100e6); // NO loses
        pool.resolve(0);
        vm.prank(alice);
        uint256 pa = pool.claim(a);
        vm.prank(bob);
        uint256 pb = pool.claim(b);
        // total pool 300, winning pool 200 -> 1.5x. 150*1.5=225, 50*1.5=75.
        assertEq(pa, 225e6);
        assertEq(pb, 75e6);
        assertLe(pa + pb, 300e6, "payouts never exceed the pool");
    }
}

contract AmmTest is Test {
    TestUSDC usdc;
    OutcomeSharePool osp;
    address lp = address(0x11);
    address trader = address(0x22);

    function setUp() public {
        usdc = new TestUSDC();
        osp = new OutcomeSharePool(address(usdc), bytes32("spec"), address(this), block.timestamp + 1 days, 0, address(0), address(this));
        usdc.mint(lp, 1_000_000e6);
        vm.startPrank(lp);
        usdc.approve(address(osp), 1_000_000e6);
        osp.addLiquidity(1_000_000e6);
        vm.stopPrank();
    }

    function test_buy_grows_invariant_and_roundtrip_loses() public {
        uint256 kBefore = osp.invariant();
        usdc.mint(trader, 1000e6);
        vm.startPrank(trader);
        usdc.approve(address(osp), 1000e6);
        uint256 shares = osp.buy(0, 100e6); // buy YES
        assertGt(shares, 0);
        assertGe(osp.invariant(), kBefore, "constant product never decreases on buy");
        uint256 back = osp.sell(0, shares); // immediately sell back
        vm.stopPrank();
        assertLe(back, 100e6, "round-trip never returns more than spent");
    }

    function test_resolve_then_winning_shares_redeem_1to1() public {
        usdc.mint(trader, 1000e6);
        vm.startPrank(trader);
        usdc.approve(address(osp), 1000e6);
        uint256 shares = osp.buy(0, 200e6); // YES
        vm.stopPrank();
        osp.resolve(0); // YES wins (this = resolver)
        vm.prank(trader);
        uint256 payout = osp.claim(0, shares);
        assertEq(payout, shares, "winning shares redeem 1:1");
    }
}

contract OrderMatcherTest is Test {
    TestUSDC usdc;
    OutcomeSharePool osp;
    AdjudexOrderMatcher matcher;
    uint256 sellerPk = 0xA11;
    uint256 buyerPk = 0xB0B;
    address seller;
    address buyer;

    function setUp() public {
        seller = vm.addr(sellerPk);
        buyer = vm.addr(buyerPk);
        usdc = new TestUSDC();
        matcher = new AdjudexOrderMatcher();
        osp = new OutcomeSharePool(address(usdc), bytes32("spec"), address(this), block.timestamp + 1 days, 0, address(0), address(this));
        // Seed the pool, then let the seller acquire YES shares to sell.
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(osp), 1_000_000e6);
        osp.addLiquidity(1_000_000e6);
        usdc.mint(seller, 500e6);
        vm.startPrank(seller);
        usdc.approve(address(osp), 500e6);
        osp.buy(0, 500e6); // seller now holds YES shares
        vm.stopPrank();
    }

    function _order(address maker, AdjudexOrderMatcher.OrderType ot, uint256 shares, uint256 priceBps, uint256 nonce)
        internal
        view
        returns (AdjudexOrderMatcher.OrderIntent memory o)
    {
        o = AdjudexOrderMatcher.OrderIntent({
            marketId: 1,
            pool: address(osp),
            side: 0, // YES
            orderType: ot,
            amount: shares,
            limitPriceBps: priceBps,
            expiresAt: block.timestamp + 1 hours,
            nonce: nonce,
            maker: maker,
            builder: address(0),
            metadataHash: bytes32(0)
        });
    }

    function _sign(uint256 pk, AdjudexOrderMatcher.OrderIntent memory o) internal view returns (bytes memory) {
        bytes32 digest = matcher.hashOrder(o);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_match_settles_shares_and_cash() public {
        uint256 shares = 50e6;
        uint256 priceBps = 5000; // 0.5
        uint256 cost = (shares * priceBps) / 10_000; // 25e6
        IERC20 yes = IERC20(address(osp.yesToken()));

        // Maker = SELL (seller), taker = BUY (buyer). Prices cross (equal).
        AdjudexOrderMatcher.OrderIntent memory makerSell = _order(seller, AdjudexOrderMatcher.OrderType.SELL, shares, priceBps, 1);
        AdjudexOrderMatcher.OrderIntent memory takerBuy = _order(buyer, AdjudexOrderMatcher.OrderType.BUY, shares, priceBps, 2);
        bytes memory makerSig = _sign(sellerPk, makerSell);
        bytes memory takerSig = _sign(buyerPk, takerBuy);

        // Approvals: seller -> shares, buyer -> cash.
        vm.prank(seller);
        yes.approve(address(matcher), shares);
        usdc.mint(buyer, cost);
        vm.prank(buyer);
        usdc.approve(address(matcher), cost);

        uint256 sellerYesBefore = yes.balanceOf(seller);
        AdjudexOrderMatcher.OrderIntent[] memory makers = new AdjudexOrderMatcher.OrderIntent[](1);
        makers[0] = makerSell;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = makerSig;

        matcher.matchOrders(takerBuy, takerSig, makers, sigs, 0, address(0));

        assertEq(yes.balanceOf(buyer), shares, "buyer received shares");
        assertEq(sellerYesBefore - yes.balanceOf(seller), shares, "seller delivered shares");
        assertEq(usdc.balanceOf(seller), cost, "seller received cash");
        assertEq(usdc.balanceOf(buyer), 0, "buyer paid cash");
    }
}

contract MockFactory {
    mapping(uint256 => address) public pools;
    function set(uint256 id, address pool) external { pools[id] = pool; }
    function getMarket(uint256 id) external view returns (address) { return pools[id]; }
}

contract GroupSettlerTest is Test {
    TestUSDC usdc;
    ExclusiveOutcomeRegistry registry;
    MockFactory factory;
    ExclusiveGroupSettler settler;
    OutcomeSharePool poolA;
    OutcomeSharePool poolB;
    uint256 constant ID_A = 101;
    uint256 constant ID_B = 102;

    function setUp() public {
        usdc = new TestUSDC();
        registry = new ExclusiveOutcomeRegistry(); // owner = this
        factory = new MockFactory();
        settler = new ExclusiveGroupSettler(address(registry), address(factory));
        // Child pools resolve through the settler.
        poolA = new OutcomeSharePool(address(usdc), bytes32("A"), address(settler), block.timestamp + 1 days, 0, address(0), address(this));
        poolB = new OutcomeSharePool(address(usdc), bytes32("B"), address(settler), block.timestamp + 1 days, 0, address(0), address(this));
        factory.set(ID_A, address(poolA));
        factory.set(ID_B, address(poolB));
    }

    function test_group_resolution_settles_all_children_atomically() public {
        uint256 g = registry.createGroup("Who wins?");
        registry.linkOutcome(g, ID_A, "A");
        registry.linkOutcome(g, ID_B, "B");
        registry.resolveGroup(g, ID_A); // A wins

        settler.settle(g);

        assertTrue(poolA.resolved(), "winner resolved");
        assertEq(uint8(poolA.resolvedSide()), 0, "winner = YES");
        assertTrue(poolB.resolved(), "loser resolved");
        assertEq(uint8(poolB.resolvedSide()), 1, "loser = NO");
    }

    function test_settle_reverts_before_group_resolved() public {
        uint256 g = registry.createGroup("Pending");
        registry.linkOutcome(g, ID_A, "A");
        registry.linkOutcome(g, ID_B, "B");
        vm.expectRevert(ExclusiveGroupSettler.GroupNotResolved.selector);
        settler.settle(g);
    }
}

contract Counter {
    uint256 public value;

    function inc() external {
        value += 1;
    }
}

contract TimelockTest is Test {
    AdjudexTimelock tl;
    Counter counter;

    function setUp() public {
        address[] memory roles = new address[](1);
        roles[0] = address(this);
        tl = new AdjudexTimelock(100, roles, roles, address(this));
        counter = new Counter();
    }

    function test_override_is_delayed_then_executes() public {
        bytes memory data = abi.encodeCall(Counter.inc, ());
        bytes32 salt = bytes32("s");
        tl.schedule(address(counter), 0, data, bytes32(0), salt, 100);
        bytes32 id = tl.hashOperation(address(counter), 0, data, bytes32(0), salt);
        assertFalse(tl.isOperationReady(id), "not ready before delay");

        vm.expectRevert(); // TimelockController: operation is not ready
        tl.execute(address(counter), 0, data, bytes32(0), salt);

        vm.warp(block.timestamp + 101);
        assertTrue(tl.isOperationReady(id), "ready after delay");
        tl.execute(address(counter), 0, data, bytes32(0), salt);
        assertEq(counter.value(), 1, "delayed op executes after minDelay");
    }
}
