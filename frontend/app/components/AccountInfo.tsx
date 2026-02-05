'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";

interface AccountInfoProps {
  address?: string;
  walletBalances: {
    eth: string;
    weth: string;
    wbtc: string;
    sc: string;
  };
  collateralBalances: {
    weth: string;
    wbtc: string;
  };
  debt: string;
}

export default function AccountInfo({
  address,
  walletBalances,
  collateralBalances,
  debt
}: AccountInfoProps) {
  const formatAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <Card className="bg-[#0d0d14] border-[#1a1a24] text-slate-200 shadow-lg">
      <CardHeader className="pb-4 border-b border-[#1a1a24]">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            Account Information
          </CardTitle>
          {address && (
            <div className="font-mono text-xs bg-[#1e1e2e] px-2 py-1 rounded text-slate-300 border border-[#2e2e3e]">
              {formatAddress(address)}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
            Wallet Balances
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <BalanceItem label="ETH" value={walletBalances.eth} />
            <BalanceItem label="WETH" value={walletBalances.weth} />
            <BalanceItem label="WBTC" value={walletBalances.wbtc} />
            <BalanceItem label="SC" value={walletBalances.sc} highlight />
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Protocol Position
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <BalanceItem label="WETH Collateral" value={collateralBalances.weth} />
            <BalanceItem label="WBTC Collateral" value={collateralBalances.wbtc} />
            <div className="col-span-2">
              <BalanceItem 
                label="SC Debt" 
                value={debt} 
                valueColor="text-red-400"
                borderColor="border-red-500/20"
                bgColor="bg-red-500/5"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BalanceItem({ 
  label, 
  value, 
  highlight = false,
  valueColor = "text-slate-200",
  borderColor = "border-[#1a1a24]",
  bgColor = "bg-[#13131c]"
}: { 
  label: string; 
  value: string; 
  highlight?: boolean;
  valueColor?: string;
  borderColor?: string;
  bgColor?: string;
}) {
  return (
    <div className={`flex flex-col p-3 rounded-lg border ${borderColor} ${bgColor} transition-colors hover:border-slate-700/50`}>
      <span className="text-[10px] text-slate-500 font-medium mb-1">{label}</span>
      <span className={`text-sm font-mono font-medium ${highlight ? 'text-emerald-400' : valueColor}`}>
        {value}
      </span>
    </div>
  );
}
