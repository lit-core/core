import React from 'react';
import type { ManifestRunEntry } from '../types.js';

interface DeltaChartProps {
  runs: ManifestRunEntry[];
  baselineRun?: ManifestRunEntry;
  metric?: 'gzipBytes' | 'rawBytes' | 'brotliBytes';
  title?: string;
}

export const DeltaChart: React.FC<DeltaChartProps> = ({ runs, baselineRun, metric = 'gzipBytes', title = 'Bundle size comparison' }) => {
  if (!runs || runs.length === 0) return null;

  const baselineBytes = baselineRun?.[metric] || runs.find((r) => r.featureId === 'baseline')?.[metric] || 1;
  const maxBytes = Math.max(...runs.map((r) => r[metric] || 0), baselineBytes, 1);

  function formatKB(bytes: number) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return (
    <div className="table-card">
      <div className="table-header-bar">
        <span className="table-title">{title}</span>
      </div>

      <div className="bar-chart-container">
        {runs.map((run) => {
          const val = run[metric] || 0;
          const isBaseline = run.featureId === 'baseline';
          const pct = Math.max(4, Math.round((val / maxBytes) * 100));

          return (
            <div key={run.featureId} className="bar-row">
              <div className="bar-label" title={run.featureId}>
                {run.featureId === 'all' ? 'All combined' : run.featureId}
              </div>
              <div className="bar-track">
                <div className={`bar-fill ${isBaseline ? 'baseline' : 'optimized'}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="bar-value">{formatKB(val)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
