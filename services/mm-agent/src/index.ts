// Adjudex AI Market-Maker - main loop.
//
// Strategy: counter-balance LP. For each open market compute |yes% - 50%|.
// When deviation exceeds `imbalanceThresholdBps`, place a counter-bet on the
// minority side (= quoting tighter spread on the rich side).
//
// Constraints:
//   - per-market exposure cap (config.maxExposurePerMarketUsdc)
//   - fixed bet size (config.betSizeUsdc)
//   - skip resolved markets
//   - skip markets with zero volume (no signal yet)

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { abis, config } from "./config.js";

const BET_PLACED = parseAbiItem(
  "event BetPlaced(address indexed bettor, uint8 side, uint256 amount, uint256 indexed positionId)",
);

type MarketState = {
  betsYes: number;
  betsNo: number;
  totalStakedUsdc: string;
  lastSeenYesBps: number;
  // On-chain positionIds owned by this agent on this pool with the side
  // they were placed on. Used to claim winnings.
  positions: Array<{ id: string; side: 0 | 1 }>;
};
type AgentState = {
  handle: string;
  startedAt: string;
  ticks: number;
  betsPlaced: number;
  claimsMade: number;
  markets: Record<string, MarketState>;
};

function loadState(handle: string): AgentState {
  return { handle, startedAt: new Date().toISOString(), ticks: 0, betsPlaced: 0, claimsMade: 0, markets: {} };
}

async function ensureAllowance(
  pub: PublicClient,
  wallet: WalletClient,
  owner: Address,
  spender: Address,
  needed: bigint,
) {
  const allowance = (await pub.readContract({
    address: config.stakeToken,
    abi: abis.usdc,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint;
  if (allowance >= needed) return;
  const hash = await wallet.writeContract({
    chain: arbitrumSepolia,
    account: wallet.account!,
    address: config.stakeToken,
    abi: abis.usdc,
    functionName: "approve",
    args: [spender, 2n ** 256n - 1n],
  });
  await pub.waitForTransactionReceipt({ hash });
}

async function ensureBalance(
  pub: PublicClient,
  wallet: WalletClient,
  owner: Address,
  needed: bigint,
) {
  const balance = (await pub.readContract({
    address: config.stakeToken,
    abi: abis.usdc,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;
  if (balance >= needed) return;
  const mintAmount = needed * 10n;
  const hash = await wallet.writeContract({
    chain: arbitrumSepolia,
    account: wallet.account!,
    address: config.stakeToken,
    abi: abis.usdc,
    functionName: "mint",
    args: [owner, mintAmount],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`  minted ${mintAmount} tUSDC to self`);
}

async function listOpenPools(pub: PublicClient): Promise<
  { marketId: bigint; pool: Address; yesPool: bigint; noPool: bigint }[]
> {
  const pools = await listPools(pub);
  const out: { marketId: bigint; pool: Address; yesPool: bigint; noPool: bigint }[] = [];
  for (const { marketId, pool } of pools) {
    const resolved = (await pub.readContract({
      address: pool, abi: abis.pool, functionName: "resolved",
    })) as boolean;
    if (resolved) continue;
    const [yesPool, noPool] = await Promise.all([
      pub.readContract({ address: pool, abi: abis.pool, functionName: "yesPool" }) as Promise<bigint>,
      pub.readContract({ address: pool, abi: abis.pool, functionName: "noPool" }) as Promise<bigint>,
    ]);
    out.push({ marketId, pool, yesPool, noPool });
  }
  return out;
}

async function listPools(pub: PublicClient): Promise<{ marketId: bigint; pool: Address }[]> {
  const next = (await pub.readContract({
    address: config.factory,
    abi: abis.factory,
    functionName: "nextMarketId",
  })) as bigint;
  const total = Number(next);
  if (total <= 1) return [];

  const out: { marketId: bigint; pool: Address }[] = [];
  for (let i = 1; i < total; i++) {
    const pool = (await pub.readContract({
      address: config.factory,
      abi: abis.factory,
      functionName: "getMarket",
      args: [BigInt(i)],
    })) as Address;
    if (pool === "0x0000000000000000000000000000000000000000") continue;
    out.push({ marketId: BigInt(i), pool });
  }
  return out;
}

async function readAgentMarketState(pub: PublicClient, pool: Address, account: Address, lastSeenYesBps: number): Promise<MarketState> {
  const logs = await pub.getLogs({
    address: pool,
    event: BET_PLACED,
    args: { bettor: account },
    fromBlock: 0n,
    toBlock: "latest",
  });
  const positions: MarketState["positions"] = [];
  let betsYes = 0;
  let betsNo = 0;
  let totalStaked = 0n;
  for (const log of logs) {
    const side = Number(log.args.side) as 0 | 1;
    const amount = log.args.amount as bigint;
    const positionId = log.args.positionId as bigint;
    if (side === 0) betsYes += 1;
    else betsNo += 1;
    totalStaked += amount;
    positions.push({ id: positionId.toString(), side });
  }
  return {
    betsYes,
    betsNo,
    totalStakedUsdc: totalStaked.toString(),
    lastSeenYesBps,
    positions,
  };
}

async function claimResolvedWinnings(
  pub: PublicClient,
  wallet: WalletClient,
  account: Address,
  state: AgentState,
) {
  const pools = await listPools(pub);
  for (const { pool } of pools) {
    let resolved: boolean;
    let resolvedSide: number;
    try {
      resolved = (await pub.readContract({
        address: pool, abi: abis.pool, functionName: "resolved",
      })) as boolean;
      if (!resolved) continue;
      resolvedSide = Number(
        (await pub.readContract({
          address: pool, abi: abis.pool, functionName: "resolvedSide",
        })) as number,
      );
    } catch {
      continue;
    }

    const market = await readAgentMarketState(pub, pool, account, 5000);
    if (market.positions.length === 0) continue;
    const remaining: typeof market.positions = [];
    for (const pos of market.positions) {
      try {
        const tuple = (await pub.readContract({
          address: pool,
          abi: abis.pool,
          functionName: "positions",
          args: [BigInt(pos.id)],
        })) as readonly [Address, number, bigint, boolean];
        const claimed = tuple[3];
        if (claimed) continue; // already claimed; drop
        // Only claim winning positions; lost positions stay (no payout). Drop
        // them too - they cannot pay out anything.
        if (pos.side !== resolvedSide) continue;
        const hash = await wallet.writeContract({
          chain: arbitrumSepolia,
          account: wallet.account!,
          address: pool,
          abi: abis.pool,
          functionName: "claim",
          args: [BigInt(pos.id)],
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          state.claimsMade += 1;
          console.log(`  ${pool.slice(0, 10)}... claimed position #${pos.id} (tx ${hash.slice(0, 10)}...)`);
        } else {
          remaining.push(pos);
        }
      } catch (e) {
        console.log(`  ${pool.slice(0, 10)}... claim failed for #${pos.id}: ${(e as Error).message}`);
        remaining.push(pos);
      }
    }
    market.positions = remaining;
    state.markets[pool] = market;
  }
}

async function tick(
  pub: PublicClient,
  wallet: WalletClient,
  account: Address,
  state: AgentState,
) {
  state.ticks += 1;
  await claimResolvedWinnings(pub, wallet, account, state);
  const pools = await listOpenPools(pub);
  console.log(`tick #${state.ticks} - ${pools.length} open markets`);

  for (const { pool, yesPool, noPool } of pools) {
    const total = yesPool + noPool;
    if (total === 0n) {
      console.log(`  ${pool.slice(0, 10)}... empty (skip)`);
      continue;
    }
    const yesBps = Number((yesPool * 10_000n) / total);
    const deviation = Math.abs(yesBps - 5000);
    const market = await readAgentMarketState(pub, pool, account, yesBps);
    state.markets[pool] = market;

    if (deviation < config.imbalanceThresholdBps) {
      console.log(`  ${pool.slice(0, 10)}... yes=${yesBps}bps balanced (skip)`);
      continue;
    }

    const exposure = BigInt(market.totalStakedUsdc);
    if (exposure + config.betSizeUsdc > config.maxExposurePerMarketUsdc) {
      console.log(`  ${pool.slice(0, 10)}... exposure cap reached (skip)`);
      continue;
    }

    const side = yesBps > 5000 ? 1 : 0;
    const sideLabel = side === 0 ? "YES" : "NO";

    await ensureBalance(pub, wallet, account, config.betSizeUsdc);
    await ensureAllowance(pub, wallet, account, pool, config.betSizeUsdc);

    try {
      const hash = await wallet.writeContract({
        chain: arbitrumSepolia,
        account: wallet.account!,
        address: pool,
        abi: abis.pool,
        functionName: "bet",
        args: [side, config.betSizeUsdc],
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
      console.log(`  ${pool.slice(0, 10)}... bet reverted`);
      continue;
      }
      if (side === 0) market.betsYes += 1; else market.betsNo += 1;
      market.totalStakedUsdc = (BigInt(market.totalStakedUsdc) + config.betSizeUsdc).toString();
      state.betsPlaced += 1;
      // Read the just-created position id from contract state.
      try {
        const betPlacedTopic =
          "0x" /* keccak256("BetPlaced(address,uint8,uint256,uint256)") truncated; instead read positions(nextPositionId - 1) */;
        void betPlacedTopic;
        const nextId = (await pub.readContract({
          address: pool,
          abi: abis.pool,
          functionName: "nextPositionId",
        })) as bigint;
        // Our just-placed bet had id = nextId - 1 (positionId increments after bet).
        const ourPositionId = (nextId - 1n).toString();
        market.positions.push({ id: ourPositionId, side: side as 0 | 1 });
      } catch (e) {
        console.log(`  ${pool.slice(0, 10)}... could not parse positionId: ${(e as Error).message}`);
      }
      console.log(`  ${pool.slice(0, 10)}... bet ${sideLabel} ${config.betSizeUsdc} (tx ${hash.slice(0, 10)}...)`);
    } catch (e) {
      console.log(`  ${pool.slice(0, 10)}... bet failed: ${(e as Error).message}`);
    }
  }

}

async function main() {
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);
  const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport });
  const pub = createPublicClient({ chain: arbitrumSepolia, transport });

  console.log(`Adjudex MM agent`);
  console.log(`  handle:   ${config.handle}`);
  console.log(`  wallet:   ${account.address}`);
  console.log(`  factory:  ${config.factory}`);
  console.log(`  interval: ${config.intervalMs}ms`);
  console.log(`  thresh:   ${config.imbalanceThresholdBps}bps`);

  const state = loadState(config.handle);

  const ethBal = await pub.getBalance({ address: account.address });
  if (ethBal < 100_000_000_000_000n) {
    console.log(`  low ETH balance: ${ethBal} wei (need testnet ETH for gas)`);
  }

  const run = async () => {
    try {
      await tick(pub, wallet, account.address, state);
    } catch (e) {
      console.error(`tick error:`, (e as Error).message);
    }
  };

  await run();
  setInterval(run, config.intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

