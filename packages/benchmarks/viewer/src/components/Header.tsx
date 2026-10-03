import type React from 'react';
import type { TabView } from './Navigation.js';

interface HeaderProps {
  currentTab: TabView;
  onSelectTab: (tab: TabView) => void;
}

export const Header: React.FC<HeaderProps> = ({ currentTab, onSelectTab }) => {
  const tabs: Array<{ id: TabView; label: string }> = [
    { id: 'matrix', label: 'Overview' },
    { id: 'library', label: 'By library' },
    { id: 'feature', label: 'By feature' },
    { id: 'showcase', label: 'Showcase' },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-zinc-200/80">
      <div className="w-full max-w-[1600px] mx-auto px-6 sm:px-10 lg:px-14 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-baseline gap-2.5 py-6">
          <span className="text-xl font-medium tracking-tight text-zinc-950">lit-core</span>
          <span className="text-zinc-300 font-light text-base">/</span>
          <span className="text-base font-light text-zinc-500">benchmarks</span>
        </div>

        {/* Navigation tabs */}
        <nav className="flex items-center gap-7 sm:gap-8 -mb-px">
          {tabs.map((tab) => {
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`py-6 text-base transition-colors cursor-pointer border-b-2 ${
                  isActive ? 'border-emerald-600 text-zinc-950 font-medium' : 'border-transparent text-zinc-500 font-light hover:text-zinc-950 hover:border-zinc-300'
                }`}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
