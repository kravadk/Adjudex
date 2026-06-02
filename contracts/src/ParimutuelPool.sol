// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

// Parimutuel pool with USDC settlement, soulbound position NFT-shape, and a
// refund-after-grace fallback so stuck markets never lock capital forever.
contract ParimutuelPool {
    enum Side { YES, NO }

    IERC20 public immutable stake;
    bytes32 public immutable specHash;
    // 14-day grace window after deadline. If the resolver fails to call
    // resolve() by deadline + GRACE, anyone can `refundAfterGrace` their stake.
    uint256 public constant REFUND_GRACE = 14 days;
    // Hard ceiling on fee (basis points). Constructor must respect this.
    // 500 bps = 5%. Anything higher rejects deployment.
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 public immutable deadline;

    // Platform fee taken from each winning claim. 150 = 1.50%. Routed to
    // feeRecipient on claim. refundAfterGrace bypasses the fee — the market
    // failed to resolve, so it's a 1:1 stake-recovery path.
    uint256 public immutable feeBps;
    address public immutable feeRecipient;

    // Mutable so the creator can hand off resolution authority to a soft-
    // market verifier (AIJudgeVerifier) post-construction.
    address public resolver;

    uint256 public yesPool;
    uint256 public noPool;
    uint256 public bettorCount;
    uint256 public nextPositionId = 1;
    bool public resolved;
    Side public resolvedSide;

    uint256 private _lock = 1;

    struct Position {
        address bettor;
        Side side;
        uint256 amount;
        bool claimed;
    }
    mapping(uint256 => Position) public positions;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event BetPlaced(address indexed bettor, uint8 side, uint256 amount, uint256 indexed positionId);
    event MarketResolved(uint8 side);
    event Claimed(address indexed bettor, uint256 indexed positionId, uint256 payout);
    event Refunded(address indexed bettor, uint256 indexed positionId, uint256 amount);
    event ResolverTransferred(address indexed previousResolver, address indexed newResolver);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event FeeCollected(address indexed recipient, uint256 amount, uint256 indexed positionId);

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address stakeToken,
        bytes32 _specHash,
        address _resolver,
        uint256 _deadline,
        uint256 _feeBps,
        address _feeRecipient
    ) {
        require(stakeToken != address(0), "stake=0");
        require(_resolver != address(0), "resolver=0");
        require(_deadline > block.timestamp, "deadline in past");
        require(_feeBps <= MAX_FEE_BPS, "fee too high");
        // Either fee is zero AND recipient may be unset, OR fee > 0 AND
        // recipient must be a real address. This rules out the bug where
        // a non-zero fee silently burns to address(0).
        require(
            _feeBps == 0 || _feeRecipient != address(0),
            "feeRecipient=0"
        );
        stake = IERC20(stakeToken);
        specHash = _specHash;
        resolver = _resolver;
        deadline = _deadline;
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
    }

    function getYesPct() external view returns (uint256) {
        uint256 total = yesPool + noPool;
        if (total == 0) return 5000;
        return (yesPool * 10000) / total;
    }
    function getTotalVolume() external view returns (uint256) { return yesPool + noPool; }
    function getBettorCount() external view returns (uint256) { return bettorCount; }

    function name() external pure returns (string memory) { return "PariAI Position"; }
    function symbol() external pure returns (string memory) { return "PARIPOS"; }

    // The creator (or any current resolver) can hand off authority. Used to
    // wire a soft market to AIJudgeVerifier after the pool is created.
    function transferResolver(address newResolver) external {
        require(msg.sender == resolver, "not resolver");
        require(newResolver != address(0), "zero");
        require(!resolved, "resolved");
        address prev = resolver;
        resolver = newResolver;
        emit ResolverTransferred(prev, newResolver);
    }

    // CEI: Checks -> Effects -> Interactions. transferFrom is the last step.
    function bet(uint8 side, uint256 amount) external nonReentrant returns (uint256 positionId) {
        require(!resolved, "resolved");
        require(block.timestamp < deadline, "deadline passed");
        require(side <= uint8(Side.NO), "bad side");
        require(amount > 0, "zero amount");

        if (side == uint8(Side.YES)) yesPool += amount;
        else noPool += amount;
        bettorCount += 1;

        positionId = nextPositionId++;
        positions[positionId] = Position({
            bettor: msg.sender,
            side: Side(side),
            amount: amount,
            claimed: false
        });
        ownerOf[positionId] = msg.sender;
        balanceOf[msg.sender] += 1;

        emit BetPlaced(msg.sender, side, amount, positionId);
        emit Transfer(address(0), msg.sender, positionId);

        require(stake.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
    }

    function resolve(uint8 side) external nonReentrant {
        require(msg.sender == resolver, "not resolver");
        require(!resolved, "already resolved");
        require(side <= uint8(Side.NO), "bad side");
        resolved = true;
        resolvedSide = Side(side);
        emit MarketResolved(side);
    }

    function claim(uint256 positionId) external nonReentrant returns (uint256 payout) {
        require(resolved, "not resolved");
        Position storage position = positions[positionId];
        require(position.bettor == msg.sender, "not owner");
        require(!position.claimed, "claimed");
        position.claimed = true;

        uint256 winningPool = resolvedSide == Side.YES ? yesPool : noPool;
        uint256 gross = 0;
        if (position.side == resolvedSide) {
            // Defensive: a winning bettor implies winningPool >= their stake.
            // If somehow zero, fail loudly rather than silently paying zero.
            require(winningPool > 0, "no winners");
            uint256 totalPool = yesPool + noPool;
            gross = (position.amount * totalPool) / winningPool;
        }

        // Platform fee taken from gross winnings. Loser payout is zero —
        // fee math is a no-op for them. Refund-after-grace path is
        // fee-free (separate function below).
        uint256 fee = 0;
        if (gross > 0 && feeBps > 0) {
            fee = (gross * feeBps) / 10000;
            payout = gross - fee;
        } else {
            payout = gross;
        }

        emit Claimed(msg.sender, positionId, payout);
        if (fee > 0) {
            emit FeeCollected(feeRecipient, fee, positionId);
            require(stake.transfer(feeRecipient, fee), "fee transfer failed");
        }
        if (payout > 0) {
            require(stake.transfer(msg.sender, payout), "transfer failed");
        }
    }

    // Stake-recovery fallback if the market never resolved by deadline + GRACE.
    // Returns 1:1 stake to the bettor.
    function refundAfterGrace(uint256 positionId) external nonReentrant returns (uint256 amount) {
        require(!resolved, "resolved");
        require(block.timestamp >= deadline + REFUND_GRACE, "too early");
        Position storage position = positions[positionId];
        require(position.bettor == msg.sender, "not owner");
        require(!position.claimed, "claimed");
        position.claimed = true;
        amount = position.amount;
        emit Refunded(msg.sender, positionId, amount);
        require(stake.transfer(msg.sender, amount), "transfer failed");
    }
}
