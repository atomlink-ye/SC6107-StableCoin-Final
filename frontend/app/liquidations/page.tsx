'use client';

import { useState, useMemo } from 'react';
import { formatEther } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import Header from '@/app/components/Header';
import { useLiquidations, type UserPosition } from '@/lib/hooks/useLiquidations';
import { useLiquidate } from '@/lib/hooks/useContractWrite';
import { CONTRACTS, STABLE_COIN_ENGINE_ABI, ERC20_ABI, activeChain } from '@/lib/contracts';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Filter = 'all' | 'at-risk' | 'liquidatable';

// ─── Health Factor Badge ──────────────────────────────────────────────────────

function HFBadge({ hf, display }: { hf: bigint; display: string }) {
  const MAX = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const isInfinite = hf === MAX;
  const isLiquidatable = !isInfinite && hf < 1_000_000_000_000_000_000n;
  const isAtRisk = !isInfinite && !isLiquidatable && hf < 1_500_000_000_000_000_000n;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border',
        isLiquidatable && 'bg-red-500/15 text-red-400 border-red-500/30',
        isAtRisk && 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        !isLiquidatable && !isAtRisk && 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      )}
    >
      <span className={cn(
        'w-1.5 h-1.5 rounded-full',
        isLiquidatable && 'bg-red-400',
        isAtRisk && 'bg-amber-400',
        !isLiquidatable && !isAtRisk && 'bg-emerald-400'
      )} />
      {display}
    </span>
  );
}

// ─── Status Pill ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: UserPosition['status'] }) {
  const map = {
    liquidatable: 'bg-red-500/10 text-red-400 border-red-500/20',
    'at-risk':     'bg-amber-500/10 text-amber-400 border-amber-500/20',
    safe:          'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  } as const;
  const label = {
    liquidatable: 'LIQUIDATABLE',
    'at-risk':    'AT RISK',
    safe:         'SAFE',
  } as const;

  return (
    <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border tracking-wider', map[status])}>
      {label[status]}
    </span>
  );
}

// ─── Liquidation Dialog ───────────────────────────────────────────────────────

interface LiquidationDialogProps {
  position: UserPosition;
  liquidationBonus: number;
  onClose: () => void;
  onSuccess: () => void;
}

function LiquidationDialog({ position, liquidationBonus, onClose, onSuccess }: LiquidationDialogProps) {
  const [selectedToken, setSelectedToken] = useState<'WETH' | 'WBTC'>('WETH');
  const [debtAmount, setDebtAmount] = useState('');
  const { execute, isPending, error, step } = useLiquidate();
  const { address } = useAccount();

  // Read liquidator's own SC balance
  const { data: scBalance } = useReadContract({
    address: CONTRACTS.STABLE_COIN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address!],
    query: { enabled: !!address },
  });

  const scBalanceFormatted = scBalance ? Number(formatEther(scBalance)).toFixed(4) : '0';
  const maxDebt = scBalance ? formatEther(scBalance) : '0';

  const debtFloat = parseFloat(debtAmount) || 0;
  const totalDebtSCFloat = Number(formatEther(position.totalDebtSC));
  const collateralUsdFloat = Number(formatEther(position.collateralValueUsd));

  // Estimated collateral received (debt * (1 + bonus/100)) expressed in USD
  const estimatedPayoutUsd = debtFloat * (1 + liquidationBonus / 100);
  // Which token's balance to show
  const collateralForToken = selectedToken === 'WETH'
    ? Number(formatEther(position.wethCollateral))
    : Number(formatEther(position.wbtcCollateral));

  const maxDebtAllowed = Math.min(totalDebtSCFloat, parseFloat(maxDebt) || 0);

  const validationError =
    debtFloat <= 0 ? 'Enter an amount greater than 0' :
    debtFloat > totalDebtSCFloat ? `Exceeds position debt (${totalDebtSCFloat.toFixed(4)} SC)` :
    debtFloat > parseFloat(maxDebt) ? `Exceeds your SC balance (${scBalanceFormatted} SC)` :
    null;

  const handleLiquidate = async () => {
    if (validationError) return;
    const tokenAddress = selectedToken === 'WETH' ? CONTRACTS.WETH : CONTRACTS.WBTC;
    const hash = await execute(tokenAddress, position.address, debtAmount);
    if (hash) onSuccess();
  };

  const stepLabel: Record<string, string> = {
    idle:      'Liquidate',
    approving: 'Approving SC…',
    executing: 'Liquidating…',
    success:   'Done!',
    error:     'Retry',
  };

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-base">🔨</span>
            <h2 className="text-sm font-bold text-slate-100">Liquidate Position</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none border-none bg-transparent cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Position summary */}
          <div className="bg-[#1a1a24] rounded-xl p-4 flex flex-col gap-2.5">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">
              Target Position
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">User</span>
              <span className="text-xs font-mono text-slate-200">
                {position.address.slice(0, 10)}…{position.address.slice(-8)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">Health Factor</span>
              <HFBadge hf={position.healthFactor} display={position.healthFactorDisplay} />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">Total Debt</span>
              <span className="text-xs font-semibold text-red-400">
                {totalDebtSCFloat.toFixed(4)} SC
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-400">Collateral Value</span>
              <span className="text-xs font-semibold text-emerald-400">
                ${collateralUsdFloat.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Select collateral token to receive */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Collateral to receive
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['WETH', 'WBTC'] as const).map((token) => {
                const bal = token === 'WETH'
                  ? Number(formatEther(position.wethCollateral)).toFixed(4)
                  : Number(formatEther(position.wbtcCollateral)).toFixed(4);
                return (
                  <button
                    key={token}
                    onClick={() => setSelectedToken(token)}
                    className={cn(
                      'flex flex-col items-center gap-1 py-3 px-4 rounded-xl border text-sm font-semibold transition-all cursor-pointer',
                      selectedToken === token
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                        : 'border-[#1e1e2e] bg-[#0a0a0f] text-slate-400 hover:border-[#2e2e3e]'
                    )}
                  >
                    <span>{token === 'WETH' ? '⟠' : '₿'} {token}</span>
                    <span className="text-[10px] font-normal text-slate-500">
                      Available: {bal}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Debt to cover input */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                SC Debt to Cover
              </label>
              <span className="text-[10px] text-slate-500">
                Your SC: <span className="text-slate-300">{scBalanceFormatted}</span>
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0.0"
                value={debtAmount}
                onChange={(e) => setDebtAmount(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 pr-16"
              />
              <button
                onClick={() => setDebtAmount(maxDebtAllowed.toFixed(6))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 hover:text-amber-400 font-semibold cursor-pointer border-none bg-transparent"
              >
                MAX
              </button>
            </div>
            {validationError && debtAmount && (
              <p className="mt-1.5 text-[11px] text-red-400">{validationError}</p>
            )}
          </div>

          {/* Payout estimate */}
          {debtFloat > 0 && !validationError && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex flex-col gap-1.5">
              <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider mb-0.5">
                Estimated Reward
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">You repay</span>
                <span className="text-xs font-semibold text-slate-200">
                  {debtFloat.toFixed(4)} SC
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  Collateral seized (USD, {liquidationBonus}% bonus)
                </span>
                <span className="text-xs font-semibold text-emerald-400">
                  ≈ ${estimatedPayoutUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">Profit (USD)</span>
                <span className="text-xs font-semibold text-emerald-400">
                  ≈ ${(estimatedPayoutUsd - debtFloat).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Step indicator */}
          {isPending && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {['approving', 'executing'].map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <div className={cn(
                    'w-2 h-2 rounded-full',
                    step === s ? 'bg-amber-400 animate-pulse' :
                    (s === 'approving' && step === 'executing') ? 'bg-emerald-500' :
                    'bg-slate-700'
                  )} />
                  <span className={cn(step === s ? 'text-amber-400' : '')}>
                    {s === 'approving' ? 'Approve SC' : 'Liquidate'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleLiquidate}
            disabled={isPending || !!validationError || !debtAmount || step === 'success'}
            className={cn(
              'w-full py-3 rounded-xl text-sm font-bold transition-all duration-200 border-none cursor-pointer',
              step === 'success'
                ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                : isPending
                  ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed'
                  : validationError || !debtAmount
                    ? 'bg-[#1a1a24] text-slate-600 cursor-not-allowed'
                    : 'bg-red-500/90 hover:bg-red-500 text-white'
            )}
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" />
                {stepLabel[step] ?? 'Processing…'}
              </span>
            ) : stepLabel[step] ?? 'Liquidate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LiquidationsPage() {
  const { positions, isLoading, error, lastUpdated, counts, refetch } = useLiquidations();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedPosition, setSelectedPosition] = useState<UserPosition | null>(null);

  // Fetch protocol-level liquidation bonus
  const { data: liquidationBonusRaw } = useReadContract({
    address: CONTRACTS.STABLE_COIN_ENGINE,
    abi: STABLE_COIN_ENGINE_ABI,
    functionName: 'getLiquidationBonus',
  });
  const liquidationBonus = liquidationBonusRaw ? Number(liquidationBonusRaw) : 10;

  const filtered = useMemo(() => {
    if (filter === 'all') return positions;
    return positions.filter((p) => p.status === filter);
  }, [positions, filter]);

  const timeSinceUpdate = lastUpdated
    ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
    : null;

  return (
    <div className="min-h-screen bg-black">
      <Header />

      <main className="max-w-[1400px] mx-auto px-6 py-7 pb-16">
        {/* Network badge */}
        <div className="mb-4 flex justify-end">
          <span className={cn(
            'text-[11px] px-3 py-1 rounded-[20px] border font-semibold tracking-wide',
            activeChain.id === 11155111
              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          )}>
            ● {activeChain.name}
          </span>
        </div>

        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-100">Liquidation Monitor</h1>
          <p className="text-sm text-slate-500 mt-1">
            All active debt positions sorted by health factor. Positions below 1.0 are eligible for liquidation.
          </p>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Positions', value: counts.total, color: 'text-slate-200', bg: 'bg-[#0d0d14]' },
            { label: 'At Risk (HF < 1.5)', value: counts.atRisk, color: 'text-amber-400', bg: 'bg-amber-500/5' },
            { label: 'Liquidatable (HF < 1.0)', value: counts.liquidatable, color: 'text-red-400', bg: 'bg-red-500/5' },
            {
              label: 'Last Updated',
              value: timeSinceUpdate !== null ? `${timeSinceUpdate}s ago` : '—',
              color: 'text-slate-400',
              bg: 'bg-[#0d0d14]',
            },
          ].map((stat) => (
            <div key={stat.label} className={cn('rounded-xl border border-[#1e1e2e] px-4 py-3', stat.bg)}>
              <div className="text-[11px] text-slate-500 font-medium mb-1">{stat.label}</div>
              <div className={cn('text-2xl font-bold', stat.color)}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs + refresh */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-1 bg-[#0d0d14] border border-[#1e1e2e] rounded-xl p-1">
            {([
              { key: 'all',          label: 'All Positions' },
              { key: 'at-risk',      label: `At Risk (${counts.atRisk})` },
              { key: 'liquidatable', label: `Liquidatable (${counts.liquidatable})` },
            ] as { key: Filter; label: string }[]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer border-none',
                  filter === tab.key
                    ? 'bg-[#1a1a24] text-slate-100 shadow'
                    : 'text-slate-500 bg-transparent hover:text-slate-300'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={refetch}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1e1e2e] rounded-lg transition-colors cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={cn('text-sm', isLoading && 'animate-spin')}>↻</span>
            Refresh
          </button>
        </div>

        {/* Table */}
        <div className="bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl overflow-hidden">
          {/* Loading state */}
          {isLoading && positions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Scanning on-chain positions…</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-3xl">⚠️</span>
              <p className="text-sm text-red-400 text-center max-w-sm">{error}</p>
              <button
                onClick={refetch}
                className="mt-1 px-4 py-1.5 text-xs text-amber-400 border border-amber-500/30 rounded-lg cursor-pointer bg-transparent hover:bg-amber-500/10 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-4xl">✅</span>
              <p className="text-sm text-slate-400">
                {filter === 'all'
                  ? 'No active positions found yet.'
                  : `No ${filter} positions right now.`}
              </p>
            </div>
          )}

          {/* Data table */}
          {filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e2e]">
                    {[
                      'User',
                      'Health Factor',
                      'Status',
                      'SC Debt',
                      'Collateral (USD)',
                      'WETH',
                      'WBTC',
                      '',
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((pos, i) => {
                    const debtSC = Number(formatEther(pos.totalDebtSC)).toFixed(4);
                    const collUsd = Number(formatEther(pos.collateralValueUsd)).toFixed(2);
                    const weth = Number(formatEther(pos.wethCollateral)).toFixed(4);
                    const wbtc = Number(formatEther(pos.wbtcCollateral)).toFixed(4);
                    const canLiquidate = pos.status === 'liquidatable';

                    return (
                      <tr
                        key={pos.address}
                        className={cn(
                          'border-b border-[#13131c] transition-colors',
                          i % 2 === 0 ? 'bg-transparent' : 'bg-[#0a0a10]',
                          canLiquidate && 'bg-red-500/3 hover:bg-red-500/5',
                          !canLiquidate && 'hover:bg-[#12121a]'
                        )}
                      >
                        {/* User */}
                        <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                          {pos.address.slice(0, 8)}…{pos.address.slice(-6)}
                        </td>

                        {/* Health Factor */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <HFBadge hf={pos.healthFactor} display={pos.healthFactorDisplay} />
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusPill status={pos.status} />
                        </td>

                        {/* SC Debt */}
                        <td className="px-4 py-3 text-xs text-red-400 font-semibold whitespace-nowrap">
                          {debtSC} <span className="text-slate-500 font-normal">SC</span>
                        </td>

                        {/* Collateral USD */}
                        <td className="px-4 py-3 text-xs text-emerald-400 font-semibold whitespace-nowrap">
                          ${collUsd}
                        </td>

                        {/* WETH */}
                        <td className="px-4 py-3 text-xs text-[#627EEA] whitespace-nowrap">
                          {weth}
                        </td>

                        {/* WBTC */}
                        <td className="px-4 py-3 text-xs text-[#F7931A] whitespace-nowrap">
                          {wbtc}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedPosition(pos)}
                            disabled={!canLiquidate}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer border',
                              canLiquidate
                                ? 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/20 hover:border-red-500/40'
                                : 'bg-transparent text-slate-600 border-slate-800 cursor-not-allowed'
                            )}
                          >
                            {canLiquidate ? 'Liquidate' : 'Healthy'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Table footer */}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-[#1e1e2e] flex items-center justify-between text-[11px] text-slate-600">
              <span>{filtered.length} position{filtered.length !== 1 ? 's' : ''} shown</span>
              <span>Auto-refreshes every 15s</span>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> HF ≥ 1.5 — Safe
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> 1.0 ≤ HF &lt; 1.5 — At Risk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" /> HF &lt; 1.0 — Liquidatable
          </span>
          <span className="ml-auto">
            Liquidation bonus: +{liquidationBonus}% collateral reward for liquidators
          </span>
        </div>
      </main>

      {/* Liquidation Dialog */}
      {selectedPosition && (
        <LiquidationDialog
          position={selectedPosition}
          liquidationBonus={liquidationBonus}
          onClose={() => setSelectedPosition(null)}
          onSuccess={() => {
            setSelectedPosition(null);
            refetch();
          }}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] py-5 px-6 text-center text-xs text-gray-700">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center">
          <span>SC Protocol — MakerDAO-style Collateralized Stablecoin</span>
          <span>Built with Foundry · Next.js · Viem · Tailwind CSS</span>
        </div>
      </footer>
    </div>
  );
}
