import React, { useState } from 'react';
import type { ManifestData, ManifestRunEntry } from '../types.js';

interface MatrixOverviewProps {
  manifest: ManifestData;
  onSelectRun: (suiteId: string, featureId: string) => void;
}

type MetricMode = 'gzipPercent' | 'gzipBytes' | 'rawPercent' | 'rawBytes' | 'brotliPercent' | 'firstRenderMs';

export const MatrixOverview: React.FC<MatrixOverviewProps> = ({ manifest, onSelectRun }) => {
  const [metricMode, setMetricMode] = useState<MetricMode>('gzipPercent');

  const { libraries, features, runs } = manifest;

  // Build lookup map: suiteId -> featureId -> ManifestRunEntry
  const runMap: Record<string, Record<string, ManifestRunEntry>> = {};
  for (const run of runs) {
    if (!runMap[run.suiteId]) runMap[run.suiteId] = {};
    runMap[run.suiteId][run.featureId] = run;
  }

  function renderCellValue(run?: ManifestRunEntry, isBaseline?: boolean) {
    if (!run) {
      return <span style={{ color: 'var(--text-subtle)' }}>-</span>;
    }

    if (isBaseline) {
      if (metricMode === 'gzipPercent' || metricMode === 'rawPercent' || metricMode === 'brotliPercent') {
        return <span style={{ color: 'var(--text-muted)' }}>baseline</span>;
      }
      if (metricMode === 'gzipBytes') {
        return <span>{(run.gzipBytes / 1024).toFixed(1)} KB</span>;
      }
      if (metricMode === 'rawBytes') {
        return <span>{(run.rawBytes / 1024).toFixed(1)} KB</span>;
      }
      if (metricMode === 'firstRenderMs') {
        return <span>{run.firstRenderMs ? `${run.firstRenderMs.toFixed(1)} ms` : '-'}</span>;
      }
    }

    switch (metricMode) {
      case 'gzipPercent': {
        const val = run.gzipPercent ?? 0;
        const color = val <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        return <span style={{ color, fontWeight: 500 }}>{val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}</span>;
      }
      case 'rawPercent': {
        const val = run.rawPercent ?? 0;
        const color = val <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        return <span style={{ color, fontWeight: 500 }}>{val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}</span>;
      }
      case 'brotliPercent': {
        const val = run.brotliPercent ?? 0;
        const color = val <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        return <span style={{ color, fontWeight: 500 }}>{val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}</span>;
      }
      case 'gzipBytes':
        return <span>{(run.gzipBytes / 1024).toFixed(1)} KB</span>;
      case 'rawBytes':
        return <span>{(run.rawBytes / 1024).toFixed(1)} KB</span>;
      case 'firstRenderMs':
        return <span>{run.firstRenderMs ? `${run.firstRenderMs.toFixed(1)} ms` : '-'}</span>;
      default:
        return '-';
    }
  }

  return (
    <div>
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Display metric:</span>
          <div className="filter-pill-list">
            <button type="button" className={`filter-pill ${metricMode === 'gzipPercent' ? 'active' : ''}`} onClick={() => setMetricMode('gzipPercent')}>
              Gzip savings (%)
            </button>
            <button type="button" className={`filter-pill ${metricMode === 'gzipBytes' ? 'active' : ''}`} onClick={() => setMetricMode('gzipBytes')}>
              Gzip size (KB)
            </button>
            <button type="button" className={`filter-pill ${metricMode === 'rawPercent' ? 'active' : ''}`} onClick={() => setMetricMode('rawPercent')}>
              Raw savings (%)
            </button>
            <button type="button" className={`filter-pill ${metricMode === 'rawBytes' ? 'active' : ''}`} onClick={() => setMetricMode('rawBytes')}>
              Raw size (KB)
            </button>
            <button type="button" className={`filter-pill ${metricMode === 'firstRenderMs' ? 'active' : ''}`} onClick={() => setMetricMode('firstRenderMs')}>
              First render (ms)
            </button>
          </div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-header-bar">
          <span className="table-title">Cross-library optimization matrix</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Optimization feature</th>
                <th>Category</th>
                {libraries.map((lib) => (
                  <th key={lib.id} className="numeric">
                    {lib.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.map((feat) => {
                const isBaseline = feat.id === 'baseline';
                return (
                  <tr key={feat.id}>
                    <td>
                      <strong>{feat.name}</strong>
                    </td>
                    <td>
                      <span className="badge-tag">{feat.category}</span>
                    </td>
                    {libraries.map((lib) => {
                      const run = runMap[lib.id]?.[feat.id];
                      return (
                        <td key={lib.id} className="numeric matrix-cell" onClick={() => onSelectRun(lib.id, feat.id)} title={`Click to view ${lib.name} - ${feat.name}`}>
                          {renderCellValue(run, isBaseline)}
                        </td>
                      );
                    })}
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
