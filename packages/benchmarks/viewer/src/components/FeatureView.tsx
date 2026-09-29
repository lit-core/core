import React from 'react';
import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';
import { DiagnosticsViewer } from './DiagnosticsViewer.js';
import { MetricCards } from './MetricCards.js';

interface FeatureViewProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  selectedFeatureId: string;
  selectedResult: StandaloneBenchmarkResult | null;
  onSelectFeature: (featureId: string) => void;
  onSelectSuite: (suiteId: string) => void;
  onOpenShowcase: () => void;
}

export const FeatureView: React.FC<FeatureViewProps> = ({ manifest, selectedSuiteId, selectedFeatureId, selectedResult, onSelectFeature, onSelectSuite, onOpenShowcase }) => {
  const { features, libraries, runs } = manifest;

  // Filter runs for this feature across all libraries
  const featureRuns = runs.filter((r) => r.featureId === selectedFeatureId);
  const currentFeature = features.find((f) => f.id === selectedFeatureId);

  return (
    <div>
      {/* Feature selector pills */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Optimization:</span>
          <div className="filter-pill-list">
            {features.map((feat) => (
              <button key={feat.id} type="button" className={`filter-pill ${selectedFeatureId === feat.id ? 'active' : ''}`} onClick={() => onSelectFeature(feat.id)}>
                {feat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {currentFeature && (
        <div className="info-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="info-title">{currentFeature.name}</h2>
            <p className="info-description">{currentFeature.description}</p>
          </div>

          {selectedResult && (
            <button type="button" className="btn-primary" onClick={onOpenShowcase}>
              Open showcase →
            </button>
          )}
        </div>
      )}

      {/* Cross-library comparison table for this feature */}
      <div className="table-card">
        <div className="table-header-bar">
          <span className="table-title">Comparison across design systems</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Component library</th>
                <th>Package</th>
                <th className="numeric">Gzip size</th>
                <th className="numeric">Gzip savings</th>
                <th className="numeric">Raw size</th>
                <th className="numeric">Raw savings</th>
                <th className="numeric">Build time</th>
                <th className="numeric">First render</th>
                <th className="numeric">Speedup</th>
              </tr>
            </thead>
            <tbody>
              {libraries.map((lib) => {
                const run = featureRuns.find((r) => r.suiteId === lib.id);
                const isSelected = selectedSuiteId === lib.id;
                const isBaseline = selectedFeatureId === 'baseline';

                if (!run) {
                  return (
                    <tr key={lib.id}>
                      <td>
                        <strong>{lib.name}</strong>
                      </td>
                      <td>
                        <code>{lib.packageName}</code>
                      </td>
                      <td colSpan={7} style={{ color: 'var(--text-subtle)', textAlign: 'center' }}>
                        Not yet evaluated
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={lib.id} className={isSelected ? 'row-selected' : undefined} style={{ cursor: 'pointer' }} onClick={() => onSelectSuite(lib.id)} title={`Click to inspect ${lib.name}`}>
                    <td>
                      <strong>{lib.name}</strong>
                    </td>
                    <td>
                      <code>{lib.packageName}</code>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected result metrics */}
      {selectedResult && (
        <MetricCards
          metrics={selectedResult.metrics}
          baseline={selectedResult.baseline}
          deltas={selectedResult.deltas}
          runtime={selectedResult.runtime}
          isBaseline={selectedResult.feature.isBaseline}
        />
      )}

      {/* Diagnostics panel */}
      {selectedResult?.diagnostics && <DiagnosticsViewer diagnostics={selectedResult.diagnostics} />}
    </div>
  );
};
