import React, { useState } from 'react';
import type { ManifestData } from '../types.js';

interface ShowcaseViewerProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  selectedFeatureId: string;
  onSelectSuite: (suiteId: string) => void;
  onSelectFeature: (featureId: string) => void;
}

type ViewportMode = 'full' | 'tablet' | 'mobile';

export const ShowcaseViewer: React.FC<ShowcaseViewerProps> = ({ manifest, selectedSuiteId, selectedFeatureId, onSelectSuite, onSelectFeature }) => {
  const [viewport, setViewport] = useState<ViewportMode>('full');
  const [iframeKey, setIframeKey] = useState<number>(Date.now());

  const { libraries, runs } = manifest;
  const suiteRuns = runs.filter((r) => r.suiteId === selectedSuiteId);
  const selectedLib = libraries.find((l) => l.id === selectedSuiteId);

  // Compute HTML path
  const htmlPath = `./results/${selectedSuiteId}/${selectedFeatureId}.html`;

  const viewportWidths: Record<ViewportMode, string> = {
    full: '100%',
    tablet: '768px',
    mobile: '390px',
  };

  return (
    <div>
      {/* Library selector */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Library:</span>
          <div className="filter-pill-list">
            {libraries.map((lib) => (
              <button key={lib.id} type="button" className={`filter-pill ${selectedSuiteId === lib.id ? 'active' : ''}`} onClick={() => onSelectSuite(lib.id)}>
                {lib.name}
              </button>
            ))}
          </div>
        </div>

        {selectedLib && <code>{selectedLib.packageName}</code>}
      </div>

      {/* Feature selector */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Optimization:</span>
          <div className="filter-pill-list">
            {suiteRuns.map((r) => (
              <button key={r.featureId} type="button" className={`filter-pill ${selectedFeatureId === r.featureId ? 'active' : ''}`} onClick={() => onSelectFeature(r.featureId)}>
                {r.featureId === 'baseline' ? 'Baseline' : r.featureId === 'all' ? 'All combined' : r.featureId}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Showcase container */}
      <div className="showcase-container">
        <div className="showcase-toolbar">
          <div className="showcase-meta">
            <span style={{ fontWeight: 600 }}>{selectedLib?.name || selectedSuiteId}</span>
            <span style={{ color: 'var(--text-subtle)' }}>/</span>
            <span>{selectedFeatureId}</span>
          </div>

          <div className="showcase-controls">
            <button type="button" className={`viewport-btn ${viewport === 'full' ? 'active' : ''}`} onClick={() => setViewport('full')}>
              Desktop
            </button>
            <button type="button" className={`viewport-btn ${viewport === 'tablet' ? 'active' : ''}`} onClick={() => setViewport('tablet')}>
              Tablet
            </button>
            <button type="button" className={`viewport-btn ${viewport === 'mobile' ? 'active' : ''}`} onClick={() => setViewport('mobile')}>
              Mobile
            </button>

            <button type="button" className="viewport-btn" onClick={() => setIframeKey(Date.now())} title="Reload component showcase">
              Reload
            </button>

            <a href={htmlPath} target="_blank" rel="noopener noreferrer" className="viewport-btn">
              Open full page ↗
            </a>
          </div>
        </div>

        <div className="iframe-wrapper" style={{ maxWidth: viewportWidths[viewport] }}>
          <iframe
            key={iframeKey}
            src={htmlPath}
            title={`${selectedSuiteId} ${selectedFeatureId} component showcase`}
            className="showcase-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
};
