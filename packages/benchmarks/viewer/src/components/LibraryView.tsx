import React from 'react';
import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';
import { DeltaChart } from './DeltaChart.js';
import { MetricCards } from './MetricCards.js';

interface LibraryViewProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  selectedFeatureId: string;
  selectedResult: StandaloneBenchmarkResult | null;
  onSelectSuite: (suiteId: string) => void;
  onSelectFeature: (featureId: string) => void;
  onOpenShowcase: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ manifest, selectedSuiteId, selectedFeatureId, selectedResult, onSelectSuite, onSelectFeature, onOpenShowcase }) => {
  const { libraries, runs } = manifest;

  // Filter runs for the currently selected library
  const suiteRuns = runs.filter((r) => r.suiteId === selectedSuiteId);
  const baselineRun = suiteRuns.find((r) => r.featureId === 'baseline');
  const currentRun = suiteRuns.find((r) => r.featureId === selectedFeatureId);

  const selectedLib = libraries.find((l) => l.id === selectedSuiteId);

  return (
    <div>
      {/* Library selector pills */}
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

      {/* Feature selector pills */}
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

        {currentRun?.htmlPath && (
          <button type="button" className="btn-primary" onClick={onOpenShowcase}>
            Open showcase →
          </button>
        )}
      </div>

      {/* Metric cards for the selected run */}
      {selectedResult && (
        <MetricCards
          metrics={selectedResult.metrics}
          baseline={selectedResult.baseline}
          deltas={selectedResult.deltas}
          runtime={selectedResult.runtime}
          isBaseline={selectedResult.feature.isBaseline}
        />
      )}

      {/* Delta chart */}
      {suiteRuns.length > 1 && <DeltaChart runs={suiteRuns} baselineRun={baselineRun} metric="gzipBytes" title={`Optimization deltas for ${selectedLib?.name || selectedSuiteId}`} />}

      {/* Runs table */}
      <div className="table-card">
        <div className="table-header-bar">
          <span className="table-title">Feature runs for {selectedLib?.name || selectedSuiteId}</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th className="numeric">Gzip size</th>
                <th className="numeric">Gzip delta</th>
                <th className="numeric">Raw size</th>
                <th className="numeric">Raw delta</th>
                <th className="numeric">Build time</th>
                <th className="numeric">First render</th>
                <th className="numeric">Speedup</th>
                <th>Showcase</th>
              </tr>
            </thead>
            <tbody>
              {suiteRuns.map((run) => {
                const isSelected = run.featureId === selectedFeatureId;
                const isBaseline = run.featureId === 'baseline';

                return (
                  <tr key={run.featureId} className={isSelected ? 'row-selected' : undefined} style={{ cursor: 'pointer' }} onClick={() => onSelectFeature(run.featureId)}>
                    <td>
                      <strong>{isBaseline ? 'Baseline (Vite)' : run.featureId === 'all' ? 'All combined' : run.featureId}</strong>
                    </td>
                    <td className="numeric">{(run.gzipBytes / 1024).toFixed(1)} KB</td>
                    <td
                      className="numeric"
                      style={{
                        color: isBaseline ? 'var(--text-muted)' : (run.gzipPercent ?? 0) <= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontWeight: isBaseline ? 400 : 500,
                      }}
                    >
                      {isBaseline ? 'baseline' : run.gzipPercent > 0 ? `+${run.gzipPercent.toFixed(1)}%` : `${run.gzipPercent.toFixed(1)}%`}
                    </td>
                    <td className="numeric">{(run.rawBytes / 1024).toFixed(1)} KB</td>
                    <td
                      className="numeric"
                      style={{
                        color: isBaseline ? 'var(--text-muted)' : (run.rawPercent ?? 0) <= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontWeight: isBaseline ? 400 : 500,
                      }}
                    >
                      {isBaseline ? 'baseline' : run.rawPercent > 0 ? `+${run.rawPercent.toFixed(1)}%` : `${run.rawPercent.toFixed(1)}%`}
                    </td>
                    <td className="numeric">{run.buildTimeMs ? `${run.buildTimeMs.toFixed(1)} ms` : '-'}</td>
                    <td className="numeric">{run.firstRenderMs ? `${run.firstRenderMs.toFixed(2)} ms` : '-'}</td>
                    <td
                      className="numeric"
                      style={{
                        color: isBaseline || !run.speedupPercent ? 'var(--text-muted)' : run.speedupPercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                        fontWeight: isBaseline ? 400 : 500,
                      }}
                    >
                      {isBaseline || !run.speedupPercent ? '-' : run.speedupPercent >= 0 ? `+${run.speedupPercent.toFixed(1)}%` : `${run.speedupPercent.toFixed(1)}%`}
                    </td>
                    <td>{run.htmlPath ? <span style={{ color: 'var(--accent-dark)', fontWeight: 500 }}>View →</span> : <span style={{ color: 'var(--text-subtle)' }}>-</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
