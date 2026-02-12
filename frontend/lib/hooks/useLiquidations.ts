import { useState, useEffect, useCallback } from 'react';
import { parseAbiItem, type Address } from 'viem';
import { publicClient, CONTRACTS, STABLE_COIN_ENGINE_ABI } from '../contracts';

const COLLATERAL_DEPOSITED_EVENT = parseAbiItem(
  'event CollateralDeposited(address indexed user, address indexed tokenCollateralAddress, uint256 amountCollateral)'
);

// Block at which StableCoinEngine was deployed on Sepolia (from broadcast artifacts).
// Starting from this block avoids scanning millions of empty blocks before the contract existed.
const ENGINE_DEPLOY_BLOCK = 10_235_251n;

export interface UserPosition {
  address: Address;
  healthFactor: bigint;
  healthFactorDisplay: string;
  totalDebtSC: bigint;
  collateralValueUsd: bigint;
  wethCollateral: bigint;
  wbtcCollateral: bigint;
  status: 'safe' | 'at-risk' | 'liquidatable';
}

const MAX_UINT256 = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);

const HF_MIN = 1_000_000_000_000_000_000n;   // 1.0e18
const HF_WARN = 1_500_000_000_000_000_000n;  // 1.5e18

function classifyHF(hf: bigint): UserPosition['status'] {
  if (hf < HF_MIN) return 'liquidatable';
  if (hf < HF_WARN) return 'at-risk';
  return 'safe';
}

function formatHF(hf: bigint): string {
  if (hf === MAX_UINT256) return '∞';
  return (Number(hf) / 1e18).toFixed(3);
}

export function useLiquidations() {
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchPositions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Step 1 — discover all users who have ever deposited collateral.
      // publicnode caps eth_getLogs at 50,000 blocks per request, so we chunk.
      // Start from the known deployment block to skip millions of empty blocks.
      const CHUNK = 49_999n;
      const latestBlock = await publicClient.getBlockNumber();
      const allLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];

      for (let from = ENGINE_DEPLOY_BLOCK; from <= latestBlock; from += CHUNK) {
        const to = from + CHUNK - 1n < latestBlock ? from + CHUNK - 1n : latestBlock;
        const chunk = await publicClient.getLogs({
          address: CONTRACTS.STABLE_COIN_ENGINE,
          event: COLLATERAL_DEPOSITED_EVENT,
          fromBlock: from,
          toBlock: to,
        });
        allLogs.push(...chunk);
      }
      const logs = allLogs;

      const uniqueUsers = [
        ...new Set(logs.map((l) => l.args.user as Address)),
      ];

      if (uniqueUsers.length === 0) {
        setPositions([]);
        setLastUpdated(new Date());
        return;
      }

      // Step 2 — batch-read each user's health factor, account info, and collateral
      const BATCH = 50;
      const allPositions: UserPosition[] = [];

      for (let i = 0; i < uniqueUsers.length; i += BATCH) {
        const batch = uniqueUsers.slice(i, i + BATCH);

        const calls = batch.flatMap((user) => [
          {
            address: CONTRACTS.STABLE_COIN_ENGINE,
            abi: STABLE_COIN_ENGINE_ABI,
            functionName: 'getHealthFactor',
            args: [user],
          },
          {
            address: CONTRACTS.STABLE_COIN_ENGINE,
            abi: STABLE_COIN_ENGINE_ABI,
            functionName: 'getAccountInformation',
            args: [user],
          },
          {
            address: CONTRACTS.STABLE_COIN_ENGINE,
            abi: STABLE_COIN_ENGINE_ABI,
            functionName: 'getCollateralBalanceOfUser',
            args: [user, CONTRACTS.WETH],
          },
          {
            address: CONTRACTS.STABLE_COIN_ENGINE,
            abi: STABLE_COIN_ENGINE_ABI,
            functionName: 'getCollateralBalanceOfUser',
            args: [user, CONTRACTS.WBTC],
          },
        ] as const);

        const results = await publicClient.multicall({
          contracts: calls as any,
          allowFailure: true,
        });

        for (let j = 0; j < batch.length; j++) {
          const user = batch[j];
          const base = j * 4;
          const hf = results[base]?.result as bigint | undefined;
          const accountInfo = results[base + 1]?.result as
            | readonly [bigint, bigint]
            | undefined;
          const weth = results[base + 2]?.result as bigint | undefined;
          const wbtc = results[base + 3]?.result as bigint | undefined;

          // Skip users with no debt
          if (!accountInfo || accountInfo[0] === 0n) continue;

          const healthFactor = hf ?? 0n;

          allPositions.push({
            address: user,
            healthFactor,
            healthFactorDisplay: formatHF(healthFactor),
            totalDebtSC: accountInfo[0],
            collateralValueUsd: accountInfo[1],
            wethCollateral: weth ?? 0n,
            wbtcCollateral: wbtc ?? 0n,
            status: classifyHF(healthFactor),
          });
        }
      }

      // Sort: liquidatable first, then at-risk, then safe — within each group by HF asc
      allPositions.sort((a, b) => {
        const order = { liquidatable: 0, 'at-risk': 1, safe: 2 } as const;
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status];
        }
        if (a.healthFactor < b.healthFactor) return -1;
        if (a.healthFactor > b.healthFactor) return 1;
        return 0;
      });

      setPositions(allPositions);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load positions';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 15_000);
    return () => clearInterval(interval);
  }, [fetchPositions]);

  const counts = {
    total: positions.length,
    atRisk: positions.filter((p) => p.status === 'at-risk').length,
    liquidatable: positions.filter((p) => p.status === 'liquidatable').length,
  };

  return { positions, isLoading, error, lastUpdated, counts, refetch: fetchPositions };
}
