import { ArrowRight, CheckCircle2, Zap } from 'lucide-react';
import type React from 'react';
import { useMemo } from 'react';
import { getManifestScenarios, getScenarioForFeature } from '../scenarios-registry.js';
import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';
import { DiagnosticsViewer } from './DiagnosticsViewer.js';
import { Dropdown } from './Dropdown.js';
import { MetricCards } from './MetricCards.js';

interface FeatureViewProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  selectedFeatureId: string;
  selectedResult: StandaloneBenchmarkResult | null;
  onSelectFeature: (featureId: string) => void;
  onSelectSuite: (suiteId: string) => void;
  onOpenShowcase?: (suiteId?: string, featureId?: string) => void;
}

export const FeatureView: React.FC<FeatureViewProps> = ({ manifest, selectedSuiteId, selectedFeatureId, selectedResult, onSelectFeature, onSelectSuite, onOpenShowcase }) => {
  const { features, libraries, runs } = manifest;

  // Filter runs for this feature across all libraries
  const featureRuns = runs.filter((r) => r.featureId === selectedFeatureId);

  const baselineFeat = features.find((f) => f.id === 'baseline');
  const allFeat = features.find((f) => f.id === 'all');
  const individualFeats = features.filter((f) => f.id !== 'baseline' && f.id !== 'all');

  const allScenarios = useMemo(() => getManifestScenarios(manifest), [manifest]);
  const currentScenario = useMemo(() => getScenarioForFeature(selectedFeatureId, manifest), [selectedFeatureId, manifest]);

  return (
    <div className="flex flex-col gap-10">
      {/* Feature selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Dropdown
            label="Optimization"
            icon={Zap}
            value={selectedFeatureId}
            options={[
              ...(allFeat ? [{ value: 'all', label: 'All combined', group: 'Macro options' }] : []),
              ...(baselineFeat ? [{ value: 'baseline', label: 'Baseline', group: 'Macro options' }] : []),
              ...individualFeats.map((feat) => ({
                value: feat.id,
                label: feat.name,
                description: feat.category,
                group: 'Compiler passes',
              })),
            ]}
            onChange={onSelectFeature}
          />
        </div>

        {onOpenShowcase && (
          <button
            type="button"
            className="inline-flex items-center gap-2 px-5 py-2 text-base font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-all shadow-none cursor-pointer"
            onClick={() => onOpenShowcase(selectedSuiteId, selectedFeatureId)}
          >
            <span>Showcase</span>
            <ArrowRight className="w-4 h-4 stroke-[1.75]" />
          </button>
        )}
      </div>

      {/* Target scenario context card */}
      {currentScenario && selectedFeatureId !== 'baseline' && (
        <div className="p-6 sm:p-7 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 flex flex-col gap-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5 max-w-3xl">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20">Target evaluation scenario</span>
                <h3 className="text-base font-medium text-zinc-950 tracking-tight">{currentScenario.name}</h3>
              </div>
              <p className="text-base font-light text-zinc-600 leading-relaxed">{currentScenario.description}</p>
            </div>

            {onOpenShowcase && (
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-base font-medium transition-all shrink-0 cursor-pointer shadow-none"
                onClick={() => onOpenShowcase(selectedSuiteId, selectedFeatureId)}
              >
                <span>View scenario in showcase</span>
                <ArrowRight className="w-4 h-4 stroke-[1.75]" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-4 border-t border-zinc-100">
            <div className="flex flex-col gap-1">
              <span className="text-base font-light text-zinc-400">Tested canonical components</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {currentScenario.componentConcepts.slice(0, 6).map((concept) => (
                  <span key={concept} className="px-2 py-0.5 rounded-md bg-zinc-50 text-zinc-700 text-base font-light ring-1 ring-zinc-900/5 font-mono">
                    {concept}
                  </span>
                ))}
                {currentScenario.componentConcepts.length > 6 && (
                  <span className="px-2 py-0.5 rounded-md bg-zinc-50 text-zinc-400 text-base font-light">+{currentScenario.componentConcepts.length - 6} more</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-base font-light text-zinc-400">Co-evaluated compiler passes</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {currentScenario.relevantFeatures.map((fId) => {
                  const isCurrent = fId === selectedFeatureId;
                  const feat = features.find((f) => f.id === fId);
                  return (
                    <button
                      key={fId}
                      type="button"
                      className={`px-2 py-0.5 rounded-md text-base transition-colors cursor-pointer ${
                        isCurrent ? 'bg-emerald-100 text-emerald-800 font-medium ring-1 ring-emerald-600/30' : 'bg-zinc-100/80 text-zinc-700 font-light hover:bg-zinc-200/80'
                      }`}
                      onClick={() => onSelectFeature(fId)}
                    >
                      {feat?.name.split(' (')[0] || fId}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-base font-light text-zinc-400">Verification</span>
              <div className="flex items-center gap-2 text-emerald-700 mt-1">
                <CheckCircle2 className="w-4 h-4 stroke-[2]" />
                <span className="text-base font-medium">Equivalence tested in Chromium</span>
              </div>
              <span className="text-base font-light text-zinc-500">Full DOM structure verified via Playwright.</span>
            </div>
          </div>
        </div>
      )}

      {/* When All Combined is selected, show scenario overview list */}
      {selectedFeatureId === 'all' && (
        <div className="p-6 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-base font-medium text-zinc-950 tracking-tight">Scenarios unified in the combined pipeline</h3>
            <span className="text-base font-light text-zinc-500">{allScenarios.length} scenarios</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allScenarios.map((sc) => (
              <div
                key={sc.id}
                className="p-4 rounded-xl bg-zinc-50/70 hover:bg-zinc-100/70 transition-colors flex flex-col gap-1.5 cursor-pointer"
                onClick={() => {
                  const feat = sc.relevantFeatures[0] || 'all';
                  onSelectFeature(feat);
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-zinc-900">{sc.name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
                </div>
                <span className="text-base font-light text-zinc-500 line-clamp-2">{sc.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-library comparison table with heading outside the box */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Comparison across design systems</h2>
          <span className="text-base font-light text-zinc-500">{libraries.length} design systems evaluated</span>
        </div>

        <div className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="bg-white border-b-2 border-zinc-900/10">
                <tr>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight min-w-[240px]">Component library</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight min-w-[220px]">Package</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[120px]">Gzip size</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[120px]">Gzip delta</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[120px]">Raw size</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[120px]">Raw delta</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[120px]">Build time</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right min-w-[130px]">First render</th>
                </tr>
              </thead>
              <tbody>
                {libraries.map((lib, idx) => {
                  const run = featureRuns.find((r) => r.suiteId === lib.id);
                  const isSelected = selectedSuiteId === lib.id;
                  const isBaseline = selectedFeatureId === 'baseline';
                  const baselineRun = runs.find((r) => r.suiteId === lib.id && r.featureId === 'baseline');

                  if (!run) {
                    return (
                      <tr key={lib.id} className={`transition-colors hover:bg-zinc-100/60 ${idx % 2 === 1 ? 'bg-zinc-50/70' : 'bg-white'}`}>
                        <td className="py-3.5 px-6 font-normal text-zinc-900">{lib.name}</td>
                        <td className="py-3.5 px-6">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-zinc-100 text-zinc-600">{lib.packageName}</span>
                        </td>
                        <td colSpan={6} className="py-3.5 px-6 text-center text-base font-light text-zinc-500">
                          Not yet evaluated
                        </td>
                      </tr>
                    );
                  }

                  const gzipDelta =
                    baselineRun?.gzipBytes && baselineRun.gzipBytes > 0 && run.gzipBytes ? ((run.gzipBytes - baselineRun.gzipBytes) / baselineRun.gzipBytes) * 100 : (run.gzipPercent ?? 0);
                  const rawDelta = baselineRun?.rawBytes && baselineRun.rawBytes > 0 && run.rawBytes ? ((run.rawBytes - baselineRun.rawBytes) / baselineRun.rawBytes) * 100 : (run.rawPercent ?? 0);
                  const speedup =
                    baselineRun?.firstRenderMs && run.firstRenderMs && baselineRun.firstRenderMs > 0
                      ? ((baselineRun.firstRenderMs - run.firstRenderMs) / baselineRun.firstRenderMs) * 100
                      : run.speedupPercent;

                  return (
                    <tr
                      key={lib.id}
                      className={`transition-colors cursor-pointer ${isSelected ? 'bg-zinc-100/90 font-medium' : idx % 2 === 1 ? 'bg-zinc-50/70 hover:bg-zinc-100/60' : 'bg-white hover:bg-zinc-100/60'}`}
                      onClick={() => onSelectSuite(lib.id)}
                      title={`Click to inspect ${lib.name}`}
                    >
                      <td className={`py-3.5 px-6 ${isSelected ? 'font-medium text-zinc-950' : 'font-normal text-zinc-900'}`}>{lib.name}</td>
                      <td className="py-3.5 px-6">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-zinc-100 text-zinc-600">{lib.packageName}</span>
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-700">{(run.gzipBytes / 1024).toFixed(1)} KB</td>
                      <td
                        className={`py-3.5 px-6 text-right tabular-nums ${
                          isBaseline
                            ? 'text-zinc-500 font-light'
                            : gzipDelta <= -0.1
                              ? 'text-emerald-700 font-normal'
                              : Math.abs(gzipDelta) <= 0.1
                                ? 'text-zinc-500 font-light'
                                : 'text-rose-700 font-normal'
                        }`}
                      >
                        {isBaseline ? 'baseline' : gzipDelta > 0 ? `+${gzipDelta.toFixed(1)}%` : `${gzipDelta.toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-700">{(run.rawBytes / 1024).toFixed(1)} KB</td>
                      <td
                        className={`py-3.5 px-6 text-right tabular-nums ${
                          isBaseline
                            ? 'text-zinc-500 font-light'
                            : rawDelta <= -0.1
                              ? 'text-emerald-700 font-normal'
                              : Math.abs(rawDelta) <= 0.1
                                ? 'text-zinc-500 font-light'
                                : 'text-rose-700 font-normal'
                        }`}
                      >
                        {isBaseline ? 'baseline' : rawDelta > 0 ? `+${rawDelta.toFixed(1)}%` : `${rawDelta.toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{run.buildTimeMs ? `${run.buildTimeMs.toFixed(0)} ms` : '—'}</td>
                      <td className="py-3.5 px-6 text-right tabular-nums">
                        {run.firstRenderMs ? (
                          <div className="flex flex-col items-end">
                            <span className="text-zinc-950 font-normal">{run.firstRenderMs.toFixed(2)} ms</span>
                            {speedup !== undefined && Math.abs(speedup) > 0.5 ? (
                              <span className={`text-base font-light tabular-nums ${speedup > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {speedup > 0 ? `+${speedup.toFixed(1)}%` : `${speedup.toFixed(1)}%`}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-zinc-500 font-light">—</span>
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

      {/* Selected result metrics */}
      {selectedResult && (
        <MetricCards
          metrics={selectedResult.metrics}
          baseline={selectedResult.baseline}
          deltas={selectedResult.deltas}
          runtime={selectedResult.runtime}
          isBaseline={selectedResult.feature.isBaseline}
          baselineRun={runs.find((r) => r.suiteId === selectedSuiteId && r.featureId === 'baseline')}
        />
      )}

      {/* Diagnostics panel */}
      {selectedResult?.diagnostics && <DiagnosticsViewer diagnostics={selectedResult.diagnostics} />}
    </div>
  );
};
