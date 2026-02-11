'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/' },
  { label: 'Liquidations', href: '/liquidations' },
] as const;

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="bg-[#0a0a0f]/95 border-b border-[#1e1e2e] backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#f59e0b] to-[#d97706] flex items-center justify-center text-base font-extrabold text-black">
            S
          </div>
          <div>
            <div className="text-base font-bold text-[#f1f5f9] leading-[1.2]">
              SC Protocol
            </div>
            <div className="text-[11px] text-[#6b7280] tracking-wider">
              COLLATERALIZED STABLECOIN
            </div>
          </div>
        </Link>

        {/* Center nav */}
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3.5 py-1.5 rounded-md text-sm transition-all duration-200 no-underline ${
                  isActive
                    ? 'font-semibold text-[#f59e0b] bg-[#f59e0b]/10'
                    : 'font-normal text-[#94a3b8] bg-transparent hover:text-[#f1f5f9] hover:bg-[#1a1a24]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right: Connect Button */}
        <div className="flex items-center gap-3">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
