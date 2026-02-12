'use client';

import { useState } from 'react';
import { useWriteContract, usePublicClient, useAccount } from 'wagmi';
import {
  parseEther,
  type Address,
  ContractFunctionExecutionError,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { CONTRACTS, ERC20_ABI, STABLE_COIN_ENGINE_ABI, LIQUIDATION_AUCTION_ABI, MOCK_V3_AGGREGATOR_ABI } from '../contracts';

// Human-readable messages for each custom error name
const ERROR_MESSAGES: Record<string, (args?: readonly unknown[]) => string> = {
  StableCoinEngine__BreaksHealthFactor: (args) =>
    `Health factor too low${args?.[0] ? ` (would be ${(Number(args[0]) / 1e18).toFixed(4)})` : ''} — reduce mint amount or add more collateral`,
  StableCoinEngine__BurnAmountExceedsMinted: (args) =>
    `Burn amount exceeds your debt${args?.[0] && args?.[1] ? ` (burning ${(Number(args[0]) / 1e18).toFixed(4)}, minted ${(Number(args[1]) / 1e18).toFixed(4)})` : ''}`,
  StableCoinEngine__InsufficientCollateral: () =>
    'Insufficient collateral deposited',
  StableCoinEngine__HealthFactorOk: () =>
    'Position is healthy — cannot be liquidated',
  StableCoinEngine__HealthFactorNotImproved: () =>
    'Liquidation did not improve the health factor',
  StableCoinEngine__AmountMustBeMoreThanZero: () =>
    'Amount must be greater than zero',
  StableCoinEngine__TransferFailed: () =>
    'Token transfer failed — check your balance and allowance',
  StableCoinEngine__MintFailed: () =>
    'Stablecoin mint failed',
  StableCoinEngine__TokenNotAllowed: (args) =>
    `Token not accepted as collateral: ${args?.[0] ?? ''}`,
  StableCoinEngine__DebtReservedForAuction: () =>
    'Debt is reserved for an active liquidation auction',
};

function parseContractError(error: unknown): string {
  if (error instanceof ContractFunctionExecutionError) {
    // Try to get the decoded custom error
    const cause = error.cause as { data?: { errorName?: string; args?: readonly unknown[] } };
    const errorName = cause?.data?.errorName;
    if (errorName && ERROR_MESSAGES[errorName]) {
      return ERROR_MESSAGES[errorName](cause.data?.args);
    }
    if (errorName) {
      return `Contract error: ${errorName.replace('StableCoinEngine__', '').replace(/([A-Z])/g, ' $1').trim()}`;
    }
    // Fall back to shortMessage which is much cleaner than the full message
    return error.shortMessage ?? error.message;
  }
  return (error as Error).message;
}

type Step = 'idle' | 'approving' | 'executing' | 'success' | 'error';

interface UseApproveAndExecuteProps {
  tokenAddress?: Address; // If provided, check allowance and approve
  spenderAddress?: Address;
  amount?: bigint;
  contractAddress: Address;
  abi: any;
  functionName: string;
  args: any[];
}

// Helper hook for the pattern
function useApproveAndExecute() {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { address: userAddress } = useAccount();
  const e2ePrivateKey = process.env.NEXT_PUBLIC_E2E_PRIVATE_KEY as `0x${string}` | undefined;
  const e2eRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;

  const e2eAccount = e2ePrivateKey ? privateKeyToAccount(e2ePrivateKey) : null;
  const e2eWalletClient =
    e2eAccount && e2eRpcUrl
      ? createWalletClient({
          account: e2eAccount,
          chain: sepolia,
          transport: http(e2eRpcUrl),
        })
      : null;

  const activeAddress = userAddress ?? e2eAccount?.address;
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const GAS_CAP = 15_000_000n; // Sepolia block gas limit is 16,777,216; stay under it
  const withGasBuffer = (gas: bigint) => {
    const buffered = (gas * 12n) / 10n + 50_000n;
    return buffered > GAS_CAP ? GAS_CAP : buffered;
  };

  const estimateGasWithBuffer = async (params: {
    address: Address;
    abi: any;
    functionName: string;
    args: any[];
  }) => {
    if (!publicClient || !activeAddress) {
      return undefined;
    }

    try {
      const estimated = await publicClient.estimateContractGas({
        account: activeAddress,
        address: params.address,
        abi: params.abi,
        functionName: params.functionName,
        args: params.args,
      });
      return withGasBuffer(estimated);
    } catch {
      // Estimation failed (e.g. simulation reverts). Use the cap so viem never
      // submits an unbounded gas value that exceeds the network block gas limit.
      return GAS_CAP;
    }
  };

  const execute = async ({
    tokenAddress,
    spenderAddress,
    amount,
    contractAddress,
    abi,
    functionName,
    args
  }: UseApproveAndExecuteProps) => {
    setIsPending(true);
    setError(null);
    setStep('idle');

    try {
      if (!userAddress && (!e2eWalletClient || !e2eAccount)) {
        throw new Error('Wallet not connected');
      }

      // Approval Flow
      if (tokenAddress && spenderAddress && amount && amount > 0n) {
        // Check allowance
        if (!publicClient) throw new Error("Public client not available");
        if (!activeAddress) throw new Error("Wallet not connected");

        const allowance = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [activeAddress, spenderAddress]
        });

        if (allowance < amount) {
          setStep('approving');
          const approveGas = await estimateGasWithBuffer({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spenderAddress, amount],
          });

          const approveHash = userAddress
            ? await writeContractAsync({
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [spenderAddress, amount],
                gas: approveGas,
              })
            : await e2eWalletClient!.writeContract({
                account: e2eAccount!,
                address: tokenAddress,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [spenderAddress, amount],
                gas: approveGas,
              });
          
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      // Execution Flow
      setStep('executing');
      const executionGas = await estimateGasWithBuffer({
        address: contractAddress,
        abi,
        functionName,
        args,
      });

      const hash = userAddress
        ? await writeContractAsync({
            address: contractAddress,
            abi,
            functionName,
            args,
            gas: executionGas,
          })
        : await e2eWalletClient!.writeContract({
            account: e2eAccount!,
            address: contractAddress,
            abi,
            functionName,
            args,
            gas: executionGas,
          });

      if (!publicClient) throw new Error("Public client not available");
      await publicClient.waitForTransactionReceipt({ hash });
      setStep('success');
      return hash;
    } catch (err) {
      console.error(err);
      const errorMessage = parseContractError(err);
      setError(errorMessage);
      setStep('error');
      // We don't re-throw here to let the UI handle the error state via the hook return
      // But if the caller needs to know, they can check error state
      return null;
    } finally {
      setIsPending(false);
    }
  };

  return { execute, isPending, error, step };
}

export function useDepositCollateral() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();
  
  const execute = async (tokenAddress: string, amount: string) => {
    const amountWei = parseEther(amount);
    return executeBase({
      tokenAddress: tokenAddress as Address,
      spenderAddress: CONTRACTS.STABLE_COIN_ENGINE,
      amount: amountWei,
      contractAddress: CONTRACTS.STABLE_COIN_ENGINE,
      abi: STABLE_COIN_ENGINE_ABI,
      functionName: 'depositCollateral',
      args: [tokenAddress as Address, amountWei]
    });
  };

  return { execute, isPending, error, step };
}

export function useMintStableCoin() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();
  
  const execute = async (amount: string) => {
    const amountWei = parseEther(amount);
    return executeBase({
      // No approval needed for minting (Engine mints SC)
      contractAddress: CONTRACTS.STABLE_COIN_ENGINE,
      abi: STABLE_COIN_ENGINE_ABI,
      functionName: 'mintStableCoin',
      args: [amountWei]
    });
  };

  return { execute, isPending, error, step };
}

export function useBurnStableCoin() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();
  
  const execute = async (amount: string) => {
    const amountWei = parseEther(amount);
    return executeBase({
      tokenAddress: CONTRACTS.STABLE_COIN, // Need to approve SC transfer to Engine
      spenderAddress: CONTRACTS.STABLE_COIN_ENGINE,
      amount: amountWei,
      contractAddress: CONTRACTS.STABLE_COIN_ENGINE,
      abi: STABLE_COIN_ENGINE_ABI,
      functionName: 'burnStableCoin',
      args: [amountWei]
    });
  };

  return { execute, isPending, error, step };
}

export function useWithdrawCollateral() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();

  const execute = async (tokenAddress: string, amount: string) => {
    const amountWei = parseEther(amount);
    return executeBase({
      // No approval needed for redeeming collateral
      contractAddress: CONTRACTS.STABLE_COIN_ENGINE,
      abi: STABLE_COIN_ENGINE_ABI,
      functionName: 'redeemCollateral',
      args: [tokenAddress as Address, amountWei]
    });
  };

  return { execute, isPending, error, step };
}

/**
 * Phase 1 — Start a liquidation auction on an underwater position.
 * liquidate() does NOT take SC from the caller; it seizes the user's collateral
 * and hands it to the LiquidationAuction contract to run an English auction.
 */
export function useStartLiquidation() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();

  const execute = async (
    collateralToken: string,
    userToLiquidate: string,
    debtToCover: string
  ) => {
    const debtWei = parseEther(debtToCover);
    return executeBase({
      // No token approval — liquidate() does not pull SC from the caller
      contractAddress: CONTRACTS.STABLE_COIN_ENGINE,
      abi: STABLE_COIN_ENGINE_ABI,
      functionName: 'liquidate',
      args: [collateralToken as Address, userToLiquidate as Address, debtWei],
    });
  };

  return { execute, isPending, error, step };
}

/**
 * Phase 2 — Place a bid on an active liquidation auction.
 * Approves SC to the LiquidationAuction contract, then calls placeBid().
 * The previous highest bidder is automatically refunded by the contract.
 */
export function usePlaceBid() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();

  const execute = async (auctionId: bigint, bidAmount: string) => {
    const bidWei = parseEther(bidAmount);
    return executeBase({
      tokenAddress: CONTRACTS.STABLE_COIN,
      spenderAddress: CONTRACTS.LIQUIDATION_AUCTION,
      amount: bidWei,
      contractAddress: CONTRACTS.LIQUIDATION_AUCTION,
      abi: LIQUIDATION_AUCTION_ABI,
      functionName: 'placeBid',
      args: [auctionId, bidWei],
    });
  };

  return { execute, isPending, error, step };
}

/**
 * Phase 3 — Finalize a completed auction.
 * Can be called by anyone once the auction has expired or the highest bid
 * equals the target debt. No SC approval required.
 */
export function useFinalizeAuction() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();

  const execute = async (auctionId: bigint) => {
    return executeBase({
      contractAddress: CONTRACTS.LIQUIDATION_AUCTION,
      abi: LIQUIDATION_AUCTION_ABI,
      functionName: 'finalizeAuction',
      args: [auctionId],
    });
  };

  return { execute, isPending, error, step };
}

/**
 * Refreshes the SC MockV3Aggregator price feed on Sepolia.
 * The OracleLib has a 3-hour stale timeout; calling updateAnswer() resets
 * the updatedAt timestamp so every transaction stops reverting with StalePrice.
 * updateAnswer() is public — no special permissions required.
 */
export function useRefreshSCOracle() {
  const { execute: executeBase, isPending, error, step } = useApproveAndExecute();

  const execute = async () => {
    return executeBase({
      contractAddress: CONTRACTS.SC_PRICE_FEED,
      abi: MOCK_V3_AGGREGATOR_ABI,
      functionName: 'updateAnswer',
      args: [100_000_000n], // $1.00 with 8 decimals
    });
  };

  return { execute, isPending, error, step };
}
