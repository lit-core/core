import React from 'react';

export type TabView = 'matrix' | 'library' | 'feature' | 'showcase' | 'components' | 'json';

interface NavigationProps {
  currentTab: TabView;
  onSelectTab: (tab: TabView) => void;
  hasShowcase?: boolean;
}

export const Navigation: React.FC<NavigationProps> = ({ currentTab, onSelectTab }) => {
  const tabs: Array<{ id: TabView; label: string }> = [
    { id: 'matrix', label: 'Overview matrix' },
    { id: 'library', label: 'By library' },
    { id: 'feature', label: 'By feature' },
    { id: 'showcase', label: 'Showcase' },
    { id: 'components', label: 'Components' },
    { id: 'json', label: 'Raw data' },
  ];

  return (
    <nav className="nav-tabs">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" className={`nav-tab-btn ${currentTab === tab.id ? 'active' : ''}`} onClick={() => onSelectTab(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
};
