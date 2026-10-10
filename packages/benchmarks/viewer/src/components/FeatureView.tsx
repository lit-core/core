import { ArrowRight, Zap } from 'lucide-react';
import type React from 'react';
import type { ManifestData, StandaloneBenchmarkResult } from '../types.js';
import { DiagnosticsViewer } from './DiagnosticsViewer.js';
import { Dropdown } from './Dropdown.js';
import { MetricCards } from './MetricCards.js';
import { DEFAULT_SCENARIOS } from './ScenarioView.js';

interface FeatureViewProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  selectedFeatureId: string;
  selectedResult: StandaloneBenchmarkResult | null;
  onSelectFeature: (featureId: string) => void;
  onSelectSuite: (suiteId: string) => void;
  onOpenShowcase?: () => void;
  onOpenScenario?: (scenarioId?: string) => void;
}

export const FeatureView: React.FC<FeatureViewProps> = ({ manifest, selectedSuiteId, selectedFeatureId, selectedResult, onSelectFeature, onSelectSuite, onOpenScenario }) => {
  const { features, libraries, runs } = manifest;

  // Filter runs for this feature across all libraries
  const featureRuns = runs.filter((r) => r.featureId === selectedFeatureId);

  const baselineFeat = features.find((f) => f.id === 'baseline');
  const allFeat = features.find((f) => f.id === 'all');
  const individualFeats = features.filter((f) => f.id !== 'baseline' && f.id !== 'all');

  const allScenarios = manifest.scenarios && manifest.scenarios.length > 0 ? manifest.scenarios : DEFAULT_SCENARIOS;
  const currentScenario = allScenarios.find((s) => s.relevantFeatures.includes(selectedFeatureId) || (selectedResult?.scenario && selectedResult.scenario.id === s.id));

  return (
    <div className="flex flex-col gap-10">
      {/* Feature selector */}
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

      {/* Target scenario context card */}
      {currentScenario && selectedFeatureId !== 'baseline' && (
        <div className="p-6 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20">Evaluation scenario</span>
              <h3 className="text-base font-medium text-zinc-950 tracking-tight">{currentScenario.name}</h3>
            </div>
            <p className="text-base font-light text-zinc-600 leading-relaxed">{currentScenario.description}</p>
          </div>
          {onOpenScenario && (
            <button
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-100/90 hover:bg-zinc-200/80 text-zinc-800 text-base font-medium transition-all shrink-0 cursor-pointer shadow-none"
              onClick={() => onOpenScenario(currentScenario.id)}
            >
              <span>Inspect scenario</span>
              <ArrowRight className="w-4 h-4 stroke-[1.75]" />
            </button>
          )}
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
