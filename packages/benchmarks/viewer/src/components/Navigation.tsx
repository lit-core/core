import type React from 'react';

export type TabView = 'matrix' | 'library' | 'feature' | 'showcase';

interface NavigationProps {
  currentTab: TabView;
  onSelectTab: (tab: TabView) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentTab, onSelectTab }) => {
  const tabs: Array<{ id: TabView; label: string }> = [
    { id: 'matrix', label: 'Overview' },
    { id: 'library', label: 'By library' },
    { id: 'feature', label: 'By feature' },
    { id: 'showcase', label: 'Showcase' },
  ];

  return (
    <nav className="flex justify-center items-center gap-7 sm:gap-8 border-b border-zinc-200/80 w-full transition-all">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`py-6 text-base transition-colors cursor-pointer border-b-2 -mb-px ${
              isActive
                ? 'border-emerald-600 text-zinc-950 font-medium'
                : 'border-transparent text-zinc-500 font-light hover:text-zinc-950 hover:border-zinc-300'
            }`}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
