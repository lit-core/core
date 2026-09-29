import React from 'react';
import type { SizeDeltas, SizeMetrics, RuntimeMetrics } from '../types.js';

interface MetricCardsProps {
  metrics?: SizeMetrics;
  baseline?: SizeMetrics;
  deltas?: SizeDeltas;
  runtime?: RuntimeMetrics;
  isBaseline?: boolean;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (abs >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatPercent(pct?: number): string {
  if (pct === undefined || pct === null || Number.isNaN(pct)) return '-';
  const prefix = pct > 0 ? '+' : '';
  return `${prefix}${pct.toFixed(1)}%`;
}

export const MetricCards: React.FC<MetricCardsProps> = ({ metrics, baseline, deltas, runtime, isBaseline }) => {
  if (!metrics) return null;

  return (
    <div className="metric-grid">
      {/* Raw size */}
      <div className="metric-card">
        <span className="metric-title">Raw bundle size</span>
        <div className="metric-value">{formatBytes(metrics.rawBytes)}</div>
        {!isBaseline && deltas && (
          <div className={`metric-delta ${(deltas.rawPercent ?? 0) <= 0 ? 'positive' : 'negative'}`}>
            <span>{formatPercent(deltas.rawPercent)}</span>
            <span>({formatBytes(deltas.rawBytes)})</span>
          </div>
        )}
        {baseline && <div className="metric-sub">Baseline: {formatBytes(baseline.rawBytes)}</div>}
      </div>

      {/* Gzip size */}
      <div className="metric-card">
        <span className="metric-title">Gzip bundle size</span>
        <div className="metric-value">{formatBytes(metrics.gzipBytes)}</div>
        {!isBaseline && deltas && (
          <div className={`metric-delta ${(deltas.gzipPercent ?? 0) <= 0 ? 'positive' : 'negative'}`}>
            <span>{formatPercent(deltas.gzipPercent)}</span>
            <span>({formatBytes(deltas.gzipBytes)})</span>
          </div>
        )}
        {baseline && <div className="metric-sub">Baseline: {formatBytes(baseline.gzipBytes)}</div>}
      </div>

      {/* Brotli size */}
      <div className="metric-card">
        <span className="metric-title">Brotli bundle size</span>
        <div className="metric-value">{formatBytes(metrics.brotliBytes)}</div>
        {!isBaseline && deltas && (
          <div className={`metric-delta ${(deltas.brotliPercent ?? 0) <= 0 ? 'positive' : 'negative'}`}>
            <span>{formatPercent(deltas.brotliPercent)}</span>
            <span>({formatBytes(deltas.brotliBytes)})</span>
          </div>
        )}
        {baseline && <div className="metric-sub">Baseline: {formatBytes(baseline.brotliBytes)}</div>}
      </div>

      {/* Build time */}
      <div className="metric-card">
        <span className="metric-title">Build time</span>
        <div className="metric-value">{metrics.buildTimeMs ? `${metrics.buildTimeMs.toFixed(1)} ms` : '-'}</div>
        {!isBaseline && deltas?.buildTimeMs !== undefined && (
          <div className={`metric-delta ${deltas.buildTimeMs <= 0 ? 'positive' : 'neutral'}`}>
            <span>{deltas.buildTimeMs > 0 ? `+${deltas.buildTimeMs.toFixed(1)} ms` : `${deltas.buildTimeMs.toFixed(1)} ms`}</span>
          </div>
        )}
      </div>

      {/* First render latency */}
      {runtime && runtime.firstRenderMs > 0 && (
        <div className="metric-card">
          <span className="metric-title">First render mount</span>
          <div className="metric-value">{runtime.firstRenderMs.toFixed(2)} ms</div>
          {!isBaseline && (runtime.speedupPercent ?? 0) !== 0 && (
            <div className={`metric-delta ${(runtime.speedupPercent ?? 0) >= 0 ? 'positive' : 'negative'}`}>
              <span>{(runtime.speedupPercent ?? 0) >= 0 ? `+${runtime.speedupPercent?.toFixed(1)}%` : `${runtime.speedupPercent?.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
