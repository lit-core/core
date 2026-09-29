import React from 'react';
import type { ManifestData } from '../types.js';

interface HeaderProps {
  manifest: ManifestData | null;
  onRefresh: () => void;
  loading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onRefresh, loading }) => {
  return (
    <header className="app-header">
      <div className="brand-section">
        <span className="brand-title">lit-core</span>
        <span className="brand-divider">/</span>
        <span className="brand-subtitle">benchmarks</span>
      </div>

      <div className="header-meta">
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading} title="Reload benchmark data from JSON files">
          {loading ? 'Refreshing...' : 'Reload data'}
        </button>
      </div>
    </header>
  );
};
