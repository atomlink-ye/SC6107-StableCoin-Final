import { useState, useEffect, useCallback } from 'react';
import { type Address } from 'viem';
import { publicClient, CONTRACTS, LIQUIDATION_AUCTION_ABI } from '../contracts';

export interface AuctionData {
  id: bigint;
  user: Address;
  collateralToken: Address;
  collateralTokenSymbol: 'WETH' | 'WBTC' | 'UNKNOWN';
  collateralAmount: bigint;
  targetDebt: bigint;
  minimumBid: bigint;
  highestBid: bigint;
  highestBidder: Address;
  endTime: bigint;
  settled: boolean;
  // Derived
  isExpired: boolean;
  canFinalize: boolean;
  nextMinBid: bigint; // minimum amount for the next valid bid
  timeLeftSeconds: number;
}

const BPS_DENOMINATOR = 10_000n;
const MIN_BID_INCREMENT_BPS = 500n; // 5%
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address;

function computeNextMinBid(auction: { minimumBid: bigint; highestBid: bigint; targetDebt: bigint }): bigint {
  if (auction.highestBid === 0n) return auction.minimumBid;
  const increment = (auction.highestBid * MIN_BID_INCREMENT_BPS) / BPS_DENOMINATOR;
  const next = auction.highestBid + (increment === 0n ? 1n : increment);
  return next > auction.targetDebt ? auction.targetDebt : next;
}

export function useLiquidationAuctions() {
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAuctions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get total auction count
      const nextId = await publicClient.readContract({
        address: CONTRACTS.LIQUIDATION_AUCTION,
        abi: LIQUIDATION_AUCTION_ABI,
        functionName: 'getNextAuctionId',
      });

      if (nextId === 0n) {
        setAuctions([]);
        setLastUpdated(new Date());
        return;
      }

      // Batch-read all auctions
      const ids = Array.from({ length: Number(nextId) }, (_, i) => BigInt(i));
      const calls = ids.map((id) => ({
        address: CONTRACTS.LIQUIDATION_AUCTION,
        abi: LIQUIDATION_AUCTION_ABI,
        functionName: 'getAuction' as const,
        args: [id] as const,
      }));

      const results = await publicClient.multicall({
        contracts: calls as any,
        allowFailure: true,
      });

      const now = BigInt(Math.floor(Date.now() / 1000));
      const parsed: AuctionData[] = [];

      for (let i = 0; i < ids.length; i++) {
        const raw = results[i]?.result as {
          user: Address;
          collateralToken: Address;
          collateralAmount: bigint;
          targetDebt: bigint;
          minimumBid: bigint;
          highestBid: bigint;
          highestBidder: Address;
          endTime: bigint;
          settled: boolean;
        } | undefined;

        if (!raw) continue;

        const isExpired = now >= raw.endTime;
        const canFinalize = !raw.settled && (isExpired || raw.highestBid === raw.targetDebt);
        const nextMinBid = computeNextMinBid(raw);
        const timeLeftSeconds = raw.endTime > now ? Number(raw.endTime - now) : 0;

        const wethLower = CONTRACTS.WETH.toLowerCase();
        const wbtcLower = CONTRACTS.WBTC.toLowerCase();
        const tokenLower = raw.collateralToken.toLowerCase();
        const symbol: AuctionData['collateralTokenSymbol'] =
          tokenLower === wethLower ? 'WETH' : tokenLower === wbtcLower ? 'WBTC' : 'UNKNOWN';

        parsed.push({
          id: ids[i],
          user: raw.user,
          collateralToken: raw.collateralToken,
          collateralTokenSymbol: symbol,
          collateralAmount: raw.collateralAmount,
          targetDebt: raw.targetDebt,
          minimumBid: raw.minimumBid,
          highestBid: raw.highestBid,
          highestBidder: raw.highestBidder,
          endTime: raw.endTime,
          settled: raw.settled,
          isExpired,
          canFinalize,
          nextMinBid,
          timeLeftSeconds,
        });
      }

      // Show unsettled first, then settled; within each group newest first
      parsed.sort((a, b) => {
        if (a.settled !== b.settled) return a.settled ? 1 : -1;
        return Number(b.id - a.id);
      });

      setAuctions(parsed);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load auctions';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(fetchAuctions, 15_000);
    return () => clearInterval(interval);
  }, [fetchAuctions]);

  const activeAuctions = auctions.filter((a) => !a.settled);
  const settledAuctions = auctions.filter((a) => a.settled);

  return { auctions, activeAuctions, settledAuctions, isLoading, error, lastUpdated, refetch: fetchAuctions };
}
