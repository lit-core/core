import { ArrowRight, Boxes, Zap } from 'lucide-react';
import type React from 'react';
import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';
import { DeltaChart } from './DeltaChart.js';
import { Dropdown } from './Dropdown.js';
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
  const allRun = suiteRuns.find((r) => r.featureId === 'all');
  const individualRuns = suiteRuns.filter((r) => r.featureId !== 'baseline' && r.featureId !== 'all');
  const currentRun = suiteRuns.find((r) => r.featureId === selectedFeatureId);

  const selectedLib = libraries.find((l) => l.id === selectedSuiteId);

  return (
    <div className="flex flex-col gap-10">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Dropdown
            label="Library"
            icon={Boxes}
            value={selectedSuiteId}
            options={libraries.map((lib) => ({
              value: lib.id,
              label: lib.name,
              description: lib.packageName,
            }))}
            onChange={onSelectSuite}
          />

          <Dropdown
            label="Optimization"
            icon={Zap}
            value={selectedFeatureId}
            options={[
              ...(allRun ? [{ value: 'all', label: 'All combined', group: 'Macro options' }] : []),
              ...(baselineRun ? [{ value: 'baseline', label: 'Baseline', group: 'Macro options' }] : []),
              ...individualRuns.map((r) => ({
                value: r.featureId,
                label: r.featureId,
                group: 'Compiler passes',
              })),
            ]}
            onChange={onSelectFeature}
          />
        </div>

        {currentRun?.htmlPath && (
          <button
            type="button"
            className="inline-flex items-center gap-2 px-5 py-2 text-base font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-all shadow-none cursor-pointer"
            onClick={onOpenShowcase}
          >
            <span>Showcase</span>
            <ArrowRight className="w-4 h-4 stroke-[1.75]" />
          </button>
        )}
      </div>

      {/* Metric cards */}
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

      {/* Feature breakdown table with heading outside the box */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Feature comparison</h2>
          <span className="text-base font-light text-zinc-500">{selectedLib?.name || selectedSuiteId}</span>
        </div>

        <div className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="bg-white border-b-2 border-zinc-900/10">
                <tr>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight min-w-[240px]">Feature</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">Gzip size</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">Gzip delta</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">Raw size</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">Raw delta</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">Build time</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right">First render</th>
                </tr>
              </thead>
              <tbody>
                {/* 1. Baseline row */}
                {baselineRun && (
                  <tr
                    className={`transition-colors cursor-pointer ${selectedFeatureId === 'baseline' ? 'bg-zinc-100/90 font-medium' : 'bg-zinc-50/90 hover:bg-zinc-100/80'}`}
                    onClick={() => onSelectFeature('baseline')}
                  >
                    <td className="py-3.5 px-6 font-medium text-zinc-900">Baseline (Standard Vite)</td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-normal text-zinc-900">{(baselineRun.gzipBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-3.5 px-6 text-right tabular-nums text-zinc-500 font-light">baseline</td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-normal text-zinc-900">{(baselineRun.rawBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-3.5 px-6 text-right tabular-nums text-zinc-500 font-light">baseline</td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{baselineRun.buildTimeMs ? `${baselineRun.buildTimeMs.toFixed(0)} ms` : '—'}</td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{baselineRun.firstRenderMs ? `${baselineRun.firstRenderMs.toFixed(2)} ms` : '—'}</td>
                  </tr>
                )}

                {/* 2. All optimizations combined row */}
                {allRun && (
                  <tr
                    className={`transition-colors cursor-pointer ${selectedFeatureId === 'all' ? 'bg-emerald-100/80 font-medium' : 'bg-emerald-50/50 hover:bg-emerald-100/40'}`}
                    onClick={() => onSelectFeature('all')}
                  >
                    <td className="py-3.5 px-6 font-medium text-zinc-950">All optimizations combined</td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-medium text-zinc-950">{(allRun.gzipBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-3.5 px-6 text-right tabular-nums text-emerald-700 font-normal">
                      {allRun.gzipPercent > 0 ? `+${allRun.gzipPercent.toFixed(1)}%` : `${allRun.gzipPercent.toFixed(1)}%`}
                    </td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-medium text-zinc-950">{(allRun.rawBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-3.5 px-6 text-right tabular-nums text-emerald-700 font-normal">
                      {allRun.rawPercent > 0 ? `+${allRun.rawPercent.toFixed(1)}%` : `${allRun.rawPercent.toFixed(1)}%`}
                    </td>
                    <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{allRun.buildTimeMs ? `${allRun.buildTimeMs.toFixed(0)} ms` : '—'}</td>
                    <td className="py-3.5 px-6 text-right tabular-nums">
                      <div className="flex flex-col items-end">
                        <span className="text-zinc-950 font-normal">{allRun.firstRenderMs ? `${allRun.firstRenderMs.toFixed(2)} ms` : '—'}</span>
                        {allRun.speedupPercent ? <span className="text-base font-light text-emerald-700 tabular-nums">+{allRun.speedupPercent.toFixed(1)}%</span> : null}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Section header for standalone passes */}
                <tr>
                  <td colSpan={7} className="py-2.5 px-6 bg-zinc-100/80 text-base font-medium text-zinc-700 tracking-tight">
                    Individual compiler passes ({individualRuns.length} standalone passes)
                  </td>
                </tr>

                {/* 3. Individual compiler passes */}
                {individualRuns.map((run, idx) => {
                  const isSelected = run.featureId === selectedFeatureId;
                  const speedup =
                    baselineRun?.firstRenderMs && run.firstRenderMs && baselineRun.firstRenderMs > 0 ? ((baselineRun.firstRenderMs - run.firstRenderMs) / baselineRun.firstRenderMs) * 100 : undefined;

                  return (
                    <tr
                      key={run.featureId}
                      className={`transition-colors cursor-pointer ${isSelected ? 'bg-zinc-100 font-medium' : idx % 2 === 1 ? 'bg-zinc-50/70 hover:bg-zinc-100/60' : 'bg-white hover:bg-zinc-100/60'}`}
                      onClick={() => onSelectFeature(run.featureId)}
                    >
                      <td className="py-3.5 px-6 font-normal text-zinc-900">{run.featureId}</td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-700">{(run.gzipBytes / 1024).toFixed(1)} KB</td>
                      <td
                        className={`py-3.5 px-6 text-right tabular-nums ${
                          (run.gzipPercent ?? 0) <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(run.gzipPercent ?? 0) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                        }`}
                      >
                        {run.gzipPercent > 0 ? `+${run.gzipPercent.toFixed(1)}%` : `${run.gzipPercent.toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-700">{(run.rawBytes / 1024).toFixed(1)} KB</td>
                      <td
                        className={`py-3.5 px-6 text-right tabular-nums ${
                          (run.rawPercent ?? 0) <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(run.rawPercent ?? 0) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                        }`}
                      >
                        {run.rawPercent > 0 ? `+${run.rawPercent.toFixed(1)}%` : `${run.rawPercent.toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{run.buildTimeMs ? `${run.buildTimeMs.toFixed(0)} ms` : '—'}</td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">
                        {run.firstRenderMs ? (
                          <div className="flex flex-col items-end">
                            <span>{run.firstRenderMs.toFixed(2)} ms</span>
                            {speedup && Math.abs(speedup) > 0.5 ? (
                              <span className={`text-base font-light tabular-nums ${speedup > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {speedup > 0 ? `+${speedup.toFixed(1)}%` : `${speedup.toFixed(1)}%`}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
