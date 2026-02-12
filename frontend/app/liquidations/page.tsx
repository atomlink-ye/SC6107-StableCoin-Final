'use client';

import { useState, useMemo } from 'react';
import { formatEther } from 'viem';
import { useAccount, useReadContract } from 'wagmi';
import Header from '@/app/components/Header';
import { useLiquidations, type UserPosition } from '@/lib/hooks/useLiquidations';
import { useLiquidationAuctions, type AuctionData } from '@/lib/hooks/useLiquidationAuctions';
import { useStartLiquidation, usePlaceBid, useFinalizeAuction, useRefreshSCOracle } from '@/lib/hooks/useContractWrite';
import { CONTRACTS, STABLE_COIN_ENGINE_ABI, ERC20_ABI, activeChain } from '@/lib/contracts';
import { cn } from '@/lib/utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

function fmtHF(hf: bigint) {
  if (hf === MAX_UINT256) return '∞';
  return (Number(hf) / 1e18).toFixed(3);
}
function fmtSC(wei: bigint, decimals = 4) {
  return Number(formatEther(wei)).toFixed(decimals);
}
function fmtTime(seconds: number): string {
  if (seconds <= 0) return 'Expired';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Small reusable atoms ────────────────────────────────────────────────────

function HFBadge({ hf, display }: { hf: bigint; display: string }) {
  const liq = hf !== MAX_UINT256 && hf < 1_000_000_000_000_000_000n;
  const risk = !liq && hf !== MAX_UINT256 && hf < 1_500_000_000_000_000_000n;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border',
      liq  && 'bg-red-500/15 text-red-400 border-red-500/30',
      risk && 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      !liq && !risk && 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', liq ? 'bg-red-400' : risk ? 'bg-amber-400' : 'bg-emerald-400')} />
      {display}
    </span>
  );
}

function StatusPill({ status }: { status: UserPosition['status'] }) {
  const cfg = {
    liquidatable: { cls: 'bg-red-500/10 text-red-400 border-red-500/20',     label: 'LIQUIDATABLE' },
    'at-risk':    { cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20', label: 'AT RISK' },
    safe:         { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'SAFE' },
  } as const;
  const { cls, label } = cfg[status];
  return <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold border tracking-wider', cls)}>{label}</span>;
}

function SpinnerBtn({
  onClick, disabled, pending, label, pendingLabel, className,
}: {
  onClick: () => void; disabled?: boolean; pending?: boolean;
  label: string; pendingLabel?: string; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || pending}
      className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer', className,
        (disabled || pending) && 'opacity-50 cursor-not-allowed'
      )}
    >
      {pending ? (
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 border-2 border-current/40 border-t-current rounded-full animate-spin" />
          {pendingLabel ?? 'Pending…'}
        </span>
      ) : label}
    </button>
  );
}

// ─── Start-Auction Dialog ────────────────────────────────────────────────────

function StartAuctionDialog({
  position, liquidationBonus, onClose, onSuccess,
}: {
  position: UserPosition; liquidationBonus: number;
  onClose: () => void; onSuccess: () => void;
}) {
  const [selectedToken, setSelectedToken] = useState<'WETH' | 'WBTC'>('WETH');
  const [debtAmount, setDebtAmount] = useState('');
  const { execute, isPending, error, step } = useStartLiquidation();

  const totalDebt = Number(fmtSC(position.totalDebtSC, 6));
  const debtFloat = parseFloat(debtAmount) || 0;
  const seizedUsd = debtFloat * (1 + liquidationBonus / 100);

  const validationError =
    debtFloat <= 0 ? 'Enter an amount > 0' :
    debtFloat > totalDebt ? `Exceeds position debt (${totalDebt.toFixed(4)} SC)` : null;

  const handleStart = async () => {
    if (validationError) return;
    const tokenAddr = selectedToken === 'WETH' ? CONTRACTS.WETH : CONTRACTS.WBTC;
    const hash = await execute(tokenAddr, position.address, debtAmount);
    if (hash) onSuccess();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-base">⚖️</span>
            <h2 className="text-sm font-bold text-slate-100">Start Liquidation Auction</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none border-none bg-transparent cursor-pointer">✕</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Info banner */}
          <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-4 py-3 text-xs text-indigo-300 leading-relaxed">
            Starting an auction seizes the borrower's collateral and opens an English auction. Bidders then compete with SC — the winner receives the collateral. You do <strong>not</strong> need SC to start the auction.
          </div>

          {/* Position summary */}
          <div className="bg-[#1a1a24] rounded-xl p-4 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Target Position</p>
            <Row label="User" value={`${position.address.slice(0, 10)}…${position.address.slice(-8)}`} mono />
            <Row label="Health Factor"><HFBadge hf={position.healthFactor} display={position.healthFactorDisplay} /></Row>
            <Row label="Total Debt" value={`${fmtSC(position.totalDebtSC)} SC`} red />
          </div>

          {/* Collateral to seize */}
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Collateral to auction</p>
            <div className="grid grid-cols-2 gap-2">
              {(['WETH', 'WBTC'] as const).map((tok) => {
                const bal = Number(formatEther(tok === 'WETH' ? position.wethCollateral : position.wbtcCollateral)).toFixed(4);
                return (
                  <button key={tok} onClick={() => setSelectedToken(tok)}
                    className={cn('flex flex-col items-center gap-1 py-3 rounded-xl border text-sm font-semibold transition-all cursor-pointer',
                      selectedToken === tok ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' : 'border-[#1e1e2e] bg-[#0a0a0f] text-slate-400 hover:border-[#2e2e3e]'
                    )}>
                    {tok === 'WETH' ? '⟠' : '₿'} {tok}
                    <span className="text-[10px] font-normal text-slate-500">Deposited: {bal}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Debt to cover */}
          <div>
            <div className="flex justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Debt to cover</p>
            </div>
            <div className="relative">
              <input type="number" min="0" step="any" placeholder="0.0" value={debtAmount}
                onChange={(e) => setDebtAmount(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 pr-16" />
              <button onClick={() => setDebtAmount(totalDebt.toFixed(6))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-semibold cursor-pointer border-none bg-transparent">MAX</button>
            </div>
            {debtAmount && validationError && <p className="mt-1.5 text-[11px] text-red-400">{validationError}</p>}
          </div>

          {/* Estimate */}
          {debtFloat > 0 && !validationError && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Auction Summary</p>
              <Row label="Debt covered" value={`${debtFloat.toFixed(4)} SC`} />
              <Row label={`Collateral seized (USD, +${liquidationBonus}% bonus)`} value={`≈ $${seizedUsd.toFixed(2)}`} green />
            </div>
          )}

          {error && <p className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">{error}</p>}

          <button onClick={handleStart} disabled={isPending || !!validationError || !debtAmount || step === 'success'}
            className={cn('w-full py-3 rounded-xl text-sm font-bold transition-all border-none cursor-pointer',
              step === 'success' ? 'bg-emerald-500/20 text-emerald-400 cursor-default' :
              isPending ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed' :
              validationError || !debtAmount ? 'bg-[#1a1a24] text-slate-600 cursor-not-allowed' :
              'bg-amber-500/90 hover:bg-amber-500 text-black'
            )}>
            {isPending ? <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />Starting Auction…</span>
              : step === 'success' ? '✓ Auction Started' : 'Start Auction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bid Dialog ───────────────────────────────────────────────────────────────

function BidDialog({ auction, onClose, onSuccess }: { auction: AuctionData; onClose: () => void; onSuccess: () => void }) {
  const [bidAmount, setBidAmount] = useState('');
  const { execute, isPending, error, step } = usePlaceBid();
  const { address } = useAccount();

  const { data: scBalance } = useReadContract({
    address: CONTRACTS.STABLE_COIN, abi: ERC20_ABI, functionName: 'balanceOf', args: [address!],
    query: { enabled: !!address },
  });

  const scBalFmt = scBalance ? Number(formatEther(scBalance)).toFixed(4) : '0';
  const bidFloat = parseFloat(bidAmount) || 0;
  const nextMinBidFloat = Number(formatEther(auction.nextMinBid));
  const targetDebtFloat = Number(formatEther(auction.targetDebt));
  const scBalFloat = scBalance ? Number(formatEther(scBalance)) : 0;

  // If bidder wins: collateral = (collateralAmount * bidAmount) / targetDebt
  const collateralWon = auction.targetDebt > 0n
    ? Number(formatEther(auction.collateralAmount)) * bidFloat / targetDebtFloat
    : 0;

  const validationError =
    bidFloat <= 0 ? 'Enter an amount > 0' :
    bidFloat < nextMinBidFloat ? `Minimum bid is ${nextMinBidFloat.toFixed(4)} SC` :
    bidFloat > targetDebtFloat ? `Cannot exceed target debt (${targetDebtFloat.toFixed(4)} SC)` :
    bidFloat > scBalFloat ? `Insufficient SC balance (${scBalFmt} SC)` : null;

  const handleBid = async () => {
    if (validationError) return;
    const hash = await execute(auction.id, bidAmount);
    if (hash) onSuccess();
  };

  const stepLabel: Record<string, string> = { idle: 'Approve & Bid', approving: 'Approving SC…', executing: 'Placing Bid…', success: '✓ Bid Placed' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <span className="text-base">🔨</span>
            <h2 className="text-sm font-bold text-slate-100">Place Bid — Auction #{auction.id.toString()}</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none border-none bg-transparent cursor-pointer">✕</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Auction info */}
          <div className="bg-[#1a1a24] rounded-xl p-4 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Auction Details</p>
            <Row label="Liquidated User" value={`${auction.user.slice(0, 10)}…${auction.user.slice(-8)}`} mono />
            <Row label="Collateral" value={`${Number(formatEther(auction.collateralAmount)).toFixed(4)} ${auction.collateralTokenSymbol}`} />
            <Row label="Target Debt" value={`${targetDebtFloat.toFixed(4)} SC`} red />
            <Row label="Highest Bid"
              value={auction.highestBid === 0n ? 'None' : `${Number(formatEther(auction.highestBid)).toFixed(4)} SC`}
              green={auction.highestBid > 0n} />
            <Row label="Time Left" value={fmtTime(auction.timeLeftSeconds)}
              className={auction.timeLeftSeconds < 300 ? 'text-red-400' : 'text-slate-200'} />
          </div>

          {/* Bid input */}
          <div>
            <div className="flex justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Bid (SC)</p>
              <span className="text-[10px] text-slate-500">Balance: <span className="text-slate-300">{scBalFmt} SC</span></span>
            </div>
            <div className="relative">
              <input type="number" min="0" step="any" placeholder={nextMinBidFloat.toFixed(4)}
                value={bidAmount} onChange={(e) => setBidAmount(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50 pr-16" />
              <button onClick={() => setBidAmount(Math.min(targetDebtFloat, scBalFloat).toFixed(6))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-amber-500 font-semibold cursor-pointer border-none bg-transparent">MAX</button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Minimum: {nextMinBidFloat.toFixed(4)} SC {auction.highestBid > 0n ? '(5% increment)' : ''}</p>
            {bidAmount && validationError && <p className="mt-1 text-[11px] text-red-400">{validationError}</p>}
          </div>

          {/* Payout estimate */}
          {bidFloat > 0 && !validationError && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider">If You Win</p>
              <Row label="You spend" value={`${bidFloat.toFixed(4)} SC`} />
              <Row label={`You receive (${auction.collateralTokenSymbol})`} value={`${collateralWon.toFixed(6)} ${auction.collateralTokenSymbol}`} green />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Winning requires highest bid at auction end, or bidding the full target debt.
              </p>
            </div>
          )}

          {/* Step indicator */}
          {isPending && (
            <div className="flex items-center gap-4 text-xs text-slate-400">
              {(['approving', 'executing'] as const).map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full',
                    step === s ? 'bg-amber-400 animate-pulse' :
                    s === 'approving' && step === 'executing' ? 'bg-emerald-500' : 'bg-slate-700'
                  )} />
                  <span className={step === s ? 'text-amber-400' : ''}>{s === 'approving' ? 'Approve SC' : 'Place Bid'}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">{error}</p>}

          <button onClick={handleBid} disabled={isPending || !!validationError || !bidAmount || step === 'success'}
            className={cn('w-full py-3 rounded-xl text-sm font-bold transition-all border-none cursor-pointer',
              step === 'success' ? 'bg-emerald-500/20 text-emerald-400 cursor-default' :
              isPending ? 'bg-amber-500/20 text-amber-400 cursor-not-allowed' :
              validationError || !bidAmount ? 'bg-[#1a1a24] text-slate-600 cursor-not-allowed' :
              'bg-emerald-500/90 hover:bg-emerald-500 text-black'
            )}>
            {isPending
              ? <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-current/40 border-t-current rounded-full animate-spin" />{stepLabel[step] ?? 'Processing…'}</span>
              : stepLabel[step] ?? 'Approve & Bid'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function Row({ label, value, children, mono, red, green, className }: {
  label: string; value?: string; children?: React.ReactNode;
  mono?: boolean; red?: boolean; green?: boolean; className?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-400">{label}</span>
      {children ?? (
        <span className={cn('text-xs font-semibold',
          mono && 'font-mono', red && 'text-red-400', green && 'text-emerald-400',
          !red && !green && 'text-slate-200', className
        )}>{value}</span>
      )}
    </div>
  );
}

// ─── Refresh SC Oracle button ─────────────────────────────────────────────────
// The SC price feed is a MockV3Aggregator with no auto-update.
// After 3 hours its timestamp goes stale and every tx reverts with OracleLib__StalePrice.
// This button calls updateAnswer($1.00) to reset the timer.

function RefreshOracleButton() {
  const { execute, isPending, step } = useRefreshSCOracle();
  const [done, setDone] = useState(false);

  const handleRefresh = async () => {
    const hash = await execute();
    if (hash) setDone(true);
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isPending}
      title="The SC mock price feed expires every 3 h. Click to refresh it and unblock transactions."
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer',
        done
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
          : isPending
            ? 'bg-amber-500/10 text-amber-400 border-amber-500/25 cursor-not-allowed'
            : 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/20'
      )}
    >
      {isPending ? (
        <>
          <span className="w-3 h-3 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" />
          Refreshing…
        </>
      ) : done ? (
        <>✓ Oracle Live</>
      ) : (
        <>⚠ Refresh SC Oracle</>
      )}
    </button>
  );
}

// ─── Finalize button (inline, self-contained hook instance) ──────────────────

function FinalizeButton({ auctionId, onSuccess }: { auctionId: bigint; onSuccess: () => void }) {
  const { execute, isPending } = useFinalizeAuction();
  const handleFinalize = async () => {
    const hash = await execute(auctionId);
    if (hash) onSuccess();
  };
  return (
    <SpinnerBtn
      onClick={handleFinalize} pending={isPending}
      label="Finalize" pendingLabel="Finalizing…"
      className="bg-indigo-500/10 text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/20"
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type PageTab = 'positions' | 'auctions';
type PosFilter = 'all' | 'at-risk' | 'liquidatable';

export default function LiquidationsPage() {
  const [tab, setTab] = useState<PageTab>('positions');
  const [posFilter, setPosFilter] = useState<PosFilter>('all');
  const [startAuctionFor, setStartAuctionFor] = useState<UserPosition | null>(null);
  const [bidFor, setBidFor] = useState<AuctionData | null>(null);

  const { positions, isLoading: posLoading, error: posError, lastUpdated, counts, refetch: refetchPos } = useLiquidations();
  const { auctions, activeAuctions, isLoading: aucLoading, error: aucError, refetch: refetchAuctions } = useLiquidationAuctions();

  const { data: liquidationBonusRaw } = useReadContract({
    address: CONTRACTS.STABLE_COIN_ENGINE, abi: STABLE_COIN_ENGINE_ABI, functionName: 'getLiquidationBonus',
  });
  const liquidationBonus = liquidationBonusRaw ? Number(liquidationBonusRaw) : 10;

  const filteredPositions = useMemo(() => {
    if (posFilter === 'all') return positions;
    return positions.filter((p) => p.status === posFilter);
  }, [positions, posFilter]);

  const timeSince = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) : null;
  const isLoading = tab === 'positions' ? posLoading : aucLoading;
  const refetch = tab === 'positions' ? refetchPos : refetchAuctions;

  return (
    <div className="min-h-screen bg-black">
      <Header />

      <main className="max-w-[1400px] mx-auto px-6 py-7 pb-16">
        {/* Network badge */}
        <div className="mb-4 flex justify-end">
          <span className={cn('text-[11px] px-3 py-1 rounded-[20px] border font-semibold tracking-wide',
            activeChain.id === 11155111 ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          )}>● {activeChain.name}</span>
        </div>

        {/* Title */}
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-100">Liquidation Monitor</h1>
            <p className="text-sm text-slate-500 mt-1">
              Monitor underwater positions and participate in English-auction liquidations.
            </p>
          </div>
          {/* The SC price feed is a mock that expires every 3h — keep it fresh */}
          <RefreshOracleButton />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Positions',       value: counts.total,          color: 'text-slate-200' },
            { label: 'At Risk (HF < 1.5)',     value: counts.atRisk,         color: 'text-amber-400' },
            { label: 'Liquidatable (HF < 1.0)',value: counts.liquidatable,   color: 'text-red-400'   },
            { label: 'Active Auctions',        value: activeAuctions.length, color: 'text-indigo-400'},
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[#1e1e2e] bg-[#0d0d14] px-4 py-3">
              <div className="text-[11px] text-slate-500 mb-1">{s.label}</div>
              <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex gap-1 bg-[#0d0d14] border border-[#1e1e2e] rounded-xl p-1">
            {([
              { key: 'positions', label: 'Positions' },
              { key: 'auctions', label: `Auctions (${activeAuctions.length} active)` },
            ] as { key: PageTab; label: string }[]).map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn('px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border-none',
                  tab === t.key ? 'bg-[#1a1a24] text-slate-100 shadow' : 'text-slate-500 bg-transparent hover:text-slate-300'
                )}>{t.label}</button>
            ))}
          </div>
          <button onClick={refetch} disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-[#1e1e2e] rounded-lg cursor-pointer bg-transparent disabled:opacity-50">
            <span className={cn('text-sm', isLoading && 'animate-spin')}>↻</span>
            {timeSince !== null ? `${timeSince}s ago` : 'Refresh'}
          </button>
        </div>

        {/* ── POSITIONS TAB ───────────────────────────────────────────────── */}
        {tab === 'positions' && (
          <div className="flex flex-col gap-4">
            {/* Sub-filter */}
            <div className="flex gap-1 bg-[#0d0d14] border border-[#1e1e2e] rounded-xl p-1 w-fit">
              {([
                { key: 'all',          label: 'All' },
                { key: 'at-risk',      label: `At Risk (${counts.atRisk})` },
                { key: 'liquidatable', label: `Liquidatable (${counts.liquidatable})` },
              ] as { key: PosFilter; label: string }[]).map((f) => (
                <button key={f.key} onClick={() => setPosFilter(f.key)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border-none',
                    posFilter === f.key ? 'bg-[#1a1a24] text-slate-100' : 'text-slate-500 bg-transparent hover:text-slate-300'
                  )}>{f.label}</button>
              ))}
            </div>

            <div className="bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl overflow-hidden">
              {posLoading && filteredPositions.length === 0 && (
                <div className="flex flex-col items-center py-20 gap-3">
                  <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                  <p className="text-sm text-slate-500">Scanning on-chain positions…</p>
                </div>
              )}
              {posError && (
                <div className="flex flex-col items-center py-16 gap-3">
                  <p className="text-sm text-red-400 text-center max-w-sm">{posError}</p>
                  <button onClick={refetchPos} className="px-4 py-1.5 text-xs text-amber-400 border border-amber-500/30 rounded-lg cursor-pointer bg-transparent">Retry</button>
                </div>
              )}
              {!posLoading && !posError && filteredPositions.length === 0 && (
                <div className="flex flex-col items-center py-20 gap-3">
                  <span className="text-4xl">✅</span>
                  <p className="text-sm text-slate-400">No {posFilter !== 'all' ? posFilter : 'active'} positions found.</p>
                </div>
              )}
              {filteredPositions.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#1e1e2e]">
                        {['User', 'Health Factor', 'Status', 'SC Debt', 'Collateral (USD)', 'WETH', 'WBTC', ''].map((c) => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPositions.map((pos, i) => {
                        const canStart = pos.status === 'liquidatable';
                        return (
                          <tr key={pos.address} className={cn('border-b border-[#13131c] transition-colors',
                            i % 2 === 0 ? 'bg-transparent' : 'bg-[#0a0a10]',
                            canStart ? 'hover:bg-red-500/5' : 'hover:bg-[#12121a]'
                          )}>
                            <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                              {pos.address.slice(0, 8)}…{pos.address.slice(-6)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap"><HFBadge hf={pos.healthFactor} display={pos.healthFactorDisplay} /></td>
                            <td className="px-4 py-3 whitespace-nowrap"><StatusPill status={pos.status} /></td>
                            <td className="px-4 py-3 text-xs text-red-400 font-semibold whitespace-nowrap">
                              {fmtSC(pos.totalDebtSC)} <span className="text-slate-500 font-normal">SC</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-emerald-400 font-semibold whitespace-nowrap">
                              ${Number(formatEther(pos.collateralValueUsd)).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-xs text-[#627EEA] whitespace-nowrap">{fmtSC(pos.wethCollateral)}</td>
                            <td className="px-4 py-3 text-xs text-[#F7931A] whitespace-nowrap">{fmtSC(pos.wbtcCollateral)}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <SpinnerBtn
                                onClick={() => setStartAuctionFor(pos)}
                                disabled={!canStart}
                                label={canStart ? 'Start Auction' : 'Healthy'}
                                className={canStart
                                  ? 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/20'
                                  : 'bg-transparent text-slate-600 border-slate-800 cursor-not-allowed'}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {filteredPositions.length > 0 && (
                <div className="px-4 py-2.5 border-t border-[#1e1e2e] flex justify-between text-[11px] text-slate-600">
                  <span>{filteredPositions.length} position{filteredPositions.length !== 1 ? 's' : ''}</span>
                  <span>Auto-refreshes every 15s</span>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-[11px] text-slate-600">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> HF ≥ 1.5 Safe</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> 1.0 ≤ HF &lt; 1.5 At Risk</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /> HF &lt; 1.0 Liquidatable</span>
            </div>
          </div>
        )}

        {/* ── AUCTIONS TAB ─────────────────────────────────────────────────── */}
        {tab === 'auctions' && (
          <div className="flex flex-col gap-4">
            {aucLoading && auctions.length === 0 && (
              <div className="flex flex-col items-center py-20 gap-3 bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                <p className="text-sm text-slate-500">Loading auctions…</p>
              </div>
            )}
            {aucError && (
              <div className="flex flex-col items-center py-16 gap-3 bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl">
                <p className="text-sm text-red-400">{aucError}</p>
                <button onClick={refetchAuctions} className="px-4 py-1.5 text-xs text-amber-400 border border-amber-500/30 rounded-lg cursor-pointer bg-transparent">Retry</button>
              </div>
            )}
            {!aucLoading && !aucError && auctions.length === 0 && (
              <div className="flex flex-col items-center py-20 gap-3 bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl">
                <span className="text-4xl">🔔</span>
                <p className="text-sm text-slate-400">No auctions yet. Start one from the Positions tab.</p>
              </div>
            )}
            {auctions.length > 0 && (
              <div className="bg-[#0d0d14] border border-[#1e1e2e] rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#1e1e2e]">
                        {['ID', 'User', 'Collateral', 'Target Debt', 'Highest Bid', 'Min Next Bid', 'Time Left', 'Status', ''].map((c) => (
                          <th key={c} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {auctions.map((a, i) => {
                        const isActive = !a.settled;
                        return (
                          <tr key={a.id.toString()} className={cn('border-b border-[#13131c] transition-colors',
                            i % 2 === 0 ? 'bg-transparent' : 'bg-[#0a0a10]',
                            isActive ? 'hover:bg-indigo-500/3' : 'opacity-60'
                          )}>
                            <td className="px-4 py-3 text-xs text-slate-400 font-mono">#{a.id.toString()}</td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">
                              {a.user.slice(0, 8)}…{a.user.slice(-6)}
                            </td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap">
                              <span className={a.collateralTokenSymbol === 'WETH' ? 'text-[#627EEA]' : 'text-[#F7931A]'}>
                                {Number(formatEther(a.collateralAmount)).toFixed(4)} {a.collateralTokenSymbol}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-red-400 font-semibold whitespace-nowrap">
                              {Number(formatEther(a.targetDebt)).toFixed(4)} SC
                            </td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap">
                              {a.highestBid === 0n
                                ? <span className="text-slate-500">None</span>
                                : <span className="text-emerald-400 font-semibold">{Number(formatEther(a.highestBid)).toFixed(4)} SC</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-amber-400 whitespace-nowrap">
                              {a.settled ? '—' : `${Number(formatEther(a.nextMinBid)).toFixed(4)} SC`}
                            </td>
                            <td className="px-4 py-3 text-xs whitespace-nowrap">
                              {a.settled
                                ? <span className="text-slate-500">Settled</span>
                                : <span className={a.timeLeftSeconds < 300 ? 'text-red-400' : 'text-slate-300'}>{fmtTime(a.timeLeftSeconds)}</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {a.settled
                                ? <span className="text-[10px] px-2 py-0.5 rounded border bg-slate-700/20 text-slate-500 border-slate-700/30">SETTLED</span>
                                : a.isExpired
                                  ? <span className="text-[10px] px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">EXPIRED</span>
                                  : <span className="text-[10px] px-2 py-0.5 rounded border bg-indigo-500/10 text-indigo-400 border-indigo-500/20">LIVE</span>}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {isActive && !a.isExpired && (
                                  <SpinnerBtn
                                    onClick={() => setBidFor(a)}
                                    label="Bid"
                                    className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20"
                                  />
                                )}
                                {isActive && a.canFinalize && (
                                  <FinalizeButton auctionId={a.id} onSuccess={refetchAuctions} />
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2.5 border-t border-[#1e1e2e] flex justify-between text-[11px] text-slate-600">
                  <span>{auctions.length} auction{auctions.length !== 1 ? 's' : ''} total · {activeAuctions.length} active</span>
                  <span>Auto-refreshes every 15s</span>
                </div>
              </div>
            )}

            {/* Auction explainer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {[
                { icon: '1️⃣', title: 'Start', desc: 'Anyone calls Start Auction on an underwater position. Collateral is seized and the auction begins.' },
                { icon: '2️⃣', title: 'Bid', desc: 'Bidders compete with SC. Each bid must be ≥5% higher than the last. The previous bidder is refunded.' },
                { icon: '3️⃣', title: 'Finalize', desc: 'After time expires (or full-debt bid), anyone finalizes. Winner gets collateral proportional to their bid.' },
              ].map((step) => (
                <div key={step.title} className="bg-[#0d0d14] border border-[#1e1e2e] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span>{step.icon}</span>
                    <span className="font-bold text-slate-200">{step.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Dialogs */}
      {startAuctionFor && (
        <StartAuctionDialog
          position={startAuctionFor}
          liquidationBonus={liquidationBonus}
          onClose={() => setStartAuctionFor(null)}
          onSuccess={() => { setStartAuctionFor(null); refetchPos(); refetchAuctions(); setTab('auctions'); }}
        />
      )}
      {bidFor && (
        <BidDialog
          auction={bidFor}
          onClose={() => setBidFor(null)}
          onSuccess={() => { setBidFor(null); refetchAuctions(); }}
        />
      )}

      <footer className="border-t border-[#1e1e2e] py-5 px-6 text-center text-xs text-gray-700">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center">
          <span>SC Protocol — MakerDAO-style Collateralized Stablecoin</span>
          <span>Built with Foundry · Next.js · Viem · Tailwind CSS</span>
        </div>
      </footer>
    </div>
  );
}
