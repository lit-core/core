import type React from 'react';
import { Fragment } from 'react';
import type { ManifestRunEntry } from '../types.js';

interface DeltaChartProps {
  runs: ManifestRunEntry[];
  baselineRun?: ManifestRunEntry;
  metric?: 'gzipBytes' | 'rawBytes' | 'brotliBytes';
  title?: string;
}

export const DeltaChart: React.FC<DeltaChartProps> = ({ runs, baselineRun, metric = 'gzipBytes', title = 'Optimization deltas' }) => {
  if (!runs || runs.length === 0) return null;

  const baseline = baselineRun || runs.find((r) => r.featureId === 'baseline');
  const baselineBytes = baseline?.[metric] || 1;
  const maxBytes = Math.max(...runs.map((r) => r[metric] || 0), baselineBytes, 1);

  // Group: baseline first, all combined second (pinned together for macro comparison), then individual tools
  const allRun = runs.find((r) => r.featureId === 'all');
  const individualRuns = runs.filter((r) => r.featureId !== 'baseline' && r.featureId !== 'all');

  const orderedRuns: Array<{ run: ManifestRunEntry; isMacro: boolean }> = [];
  if (baseline) orderedRuns.push({ run: baseline, isMacro: true });
  if (allRun) orderedRuns.push({ run: allRun, isMacro: true });
  for (const r of individualRuns) {
    orderedRuns.push({ run: r, isMacro: false });
  }

  function formatKB(bytes: number) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return (
    <div className="flex flex-col gap-3">
      {title && <h2 className="text-lg font-medium text-zinc-950 tracking-tight px-1">{title}</h2>}

      <div className="bg-white rounded-2xl overflow-hidden p-8 flex flex-col gap-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
        {orderedRuns.map(({ run }, idx) => {
          const val = run[metric] || 0;
          const isBaseline = run.featureId === 'baseline';
          const isAll = run.featureId === 'all';
          const pct = Math.max(4, Math.round((val / maxBytes) * 100));

          const deltaBytes = val - baselineBytes;
          const deltaPercent = baselineBytes > 0 ? (deltaBytes / baselineBytes) * 100 : 0;
          const isGood = deltaBytes < -50;
          const isNeutral = Math.abs(deltaBytes) <= 50;

          // Render a subtle divider between macro tier and individual passes
          const showDividerAfter = isAll && individualRuns.length > 0 && idx === 1;

          return (
            <Fragment key={run.featureId}>
              <div
                className={`grid grid-cols-[220px_1fr_130px] items-center gap-6 py-1.5 px-3 rounded-xl transition-colors ${
                  isAll ? 'bg-emerald-50/50' : isBaseline ? 'bg-zinc-50' : 'hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-center gap-2 truncate" title={run.featureId}>
                  <span className={`text-base truncate ${isAll ? 'font-medium text-emerald-950' : isBaseline ? 'font-medium text-zinc-900' : 'font-normal text-zinc-800'}`}>
                    {isBaseline ? 'Baseline (Standard Vite)' : isAll ? 'All combined' : run.featureId}
                  </span>
                </div>

                <div className="h-2.5 bg-zinc-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-300 ${isAll ? 'bg-emerald-600' : isBaseline ? 'bg-zinc-400' : 'bg-zinc-800'}`} style={{ width: `${pct}%` }} />
                </div>

                <div className="flex items-center justify-end gap-2 text-right">
                  <span className={`text-base tabular-nums ${isAll ? 'font-medium text-zinc-900' : 'font-normal text-zinc-900'}`}>{formatKB(val)}</span>
                  <span className={`text-base tabular-nums font-light w-16 text-right ${isBaseline ? 'text-zinc-400' : isNeutral ? 'text-zinc-400' : isGood ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {isBaseline ? 'ref' : deltaPercent > 0 ? `+${deltaPercent.toFixed(1)}%` : `${deltaPercent.toFixed(1)}%`}
                  </span>
                </div>
              </div>

              {showDividerAfter && <div className="my-1 pt-3 px-3 text-base text-zinc-500 font-light">Individual compiler passes</div>}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
};
