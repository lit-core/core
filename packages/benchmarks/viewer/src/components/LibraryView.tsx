import { ArrowRight, Boxes, CheckCircle2, Zap } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { ALL_CANONICAL_COMPONENTS } from '../canonical-registry.js';
import { getManifestScenarios } from '../scenarios-registry.js';
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
  onOpenShowcase?: (suiteId?: string, featureId?: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ manifest, selectedSuiteId, selectedFeatureId, selectedResult, onSelectSuite, onSelectFeature, onOpenShowcase }) => {
  const { libraries, features, runs } = manifest;

  const scenarios = useMemo(() => getManifestScenarios(manifest), [manifest]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('data-grid');

  const activeScenario = useMemo(() => {
    return scenarios.find((s) => s.id === selectedScenarioId) || scenarios[0];
  }, [scenarios, selectedScenarioId]);

  // Filter runs for the currently selected library
  const suiteRuns = runs.filter((r) => r.suiteId === selectedSuiteId);
  const baselineRun = suiteRuns.find((r) => r.featureId === 'baseline');
  const allRun = suiteRuns.find((r) => r.featureId === 'all');
  const individualRuns = suiteRuns.filter((r) => r.featureId !== 'baseline' && r.featureId !== 'all');
  const currentRun = suiteRuns.find((r) => r.featureId === selectedFeatureId);

  const selectedLib = libraries.find((l) => l.id === selectedSuiteId);

  // Components in this library tested by the active scenario
  const scenarioComponents = useMemo(() => {
    const conceptSet = new Set(activeScenario.componentConcepts);
    return ALL_CANONICAL_COMPONENTS.filter((comp) => comp.library === selectedSuiteId && conceptSet.has(comp.concept));
  }, [selectedSuiteId, activeScenario]);

  // Scenario runs for this library
  const scenarioRuns = useMemo(() => {
    const relevantIds = new Set(['baseline', ...activeScenario.relevantFeatures]);
    return suiteRuns.filter((r) => relevantIds.has(r.featureId));
  }, [suiteRuns, activeScenario]);

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

      {/* Metric cards */}
      {selectedResult && (
        <MetricCards
          metrics={selectedResult.metrics}
          baseline={selectedResult.baseline}
          deltas={selectedResult.deltas}
          runtime={selectedResult.runtime}
          isBaseline={selectedResult.feature.isBaseline}
          baselineRun={baselineRun}
        />
      )}

      {/* Delta chart */}
      {suiteRuns.length > 1 && <DeltaChart runs={suiteRuns} baselineRun={baselineRun} metric="gzipBytes" title={`Optimization deltas for ${selectedLib?.name || selectedSuiteId}`} />}

      {/* Scenarios evaluated for this library */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 px-1">
          <div>
            <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Scenarios evaluated for {selectedLib?.name || selectedSuiteId}</h2>
            <p className="text-base font-light text-zinc-500 mt-0.5">Comparing baseline against compiler passes within domain-specific real component workloads.</p>
          </div>
          <span className="text-base font-light text-zinc-400">{scenarios.length} scenarios</span>
        </div>

        {/* Scenario pill switcher */}
        <div className="flex flex-wrap gap-2">
          {scenarios.map((s) => {
            const isActive = s.id === activeScenario.id;
            return (
              <button
                key={s.id}
                type="button"
                className={`px-4 py-2 text-base rounded-xl transition-all cursor-pointer shadow-none ${
                  isActive
                    ? 'bg-emerald-700 text-white font-medium shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5'
                    : 'bg-white text-zinc-700 font-light hover:text-zinc-950 hover:bg-zinc-100/80 ring-1 ring-zinc-900/5'
                }`}
                onClick={() => setSelectedScenarioId(s.id)}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        {/* Active scenario context and metrics */}
        <div className="bg-white rounded-2xl p-6 sm:p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <span className="text-base font-light text-zinc-500">Scenario objective</span>
              <p className="text-base font-normal text-zinc-800 leading-relaxed mt-1">{activeScenario.description}</p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-base font-light text-zinc-500">Tested components ({selectedLib?.name})</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {scenarioComponents.map((comp) => (
                  <span key={comp.tag} className="px-2.5 py-1 rounded-md bg-zinc-50 text-zinc-700 text-base font-light ring-1 ring-zinc-900/5 font-mono">
                    {comp.tag}
                  </span>
                ))}
                {scenarioComponents.length === 0 &&
                  activeScenario.componentConcepts.map((concept) => (
                    <span key={concept} className="px-2.5 py-1 rounded-md bg-zinc-50 text-zinc-700 text-base font-light ring-1 ring-zinc-900/5 font-mono">
                      {concept}
                    </span>
                  ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 justify-between">
              <div>
                <span className="text-base font-light text-zinc-500">Equivalence verification</span>
                <div className="flex items-center gap-2 text-emerald-700 mt-1">
                  <CheckCircle2 className="w-5 h-5 stroke-[1.75]" />
                  <span className="text-base font-medium">DOM structure verified</span>
                </div>
                <p className="text-base font-light text-zinc-500 mt-1">Evaluated in real Chromium via Playwright.</p>
              </div>

              {onOpenShowcase && (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-base font-medium transition-colors w-fit cursor-pointer"
                  onClick={() => {
                    const primaryFeat = activeScenario.relevantFeatures[0] || 'all';
                    onOpenShowcase(selectedSuiteId, primaryFeat);
                  }}
                >
                  <span>View in showcase</span>
                  <ArrowRight className="w-4 h-4 stroke-[1.75]" />
                </button>
              )}
            </div>
          </div>

          {/* Scenario comparative table */}
          <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-900/5 mt-2">
            <table className="w-full text-left text-base border-collapse">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/70">
                  <th className="py-3 px-5 text-base font-light text-zinc-500">Optimization variant</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">Gzip bundle</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">Gzip delta</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">First render</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">Render speedup</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">Reactive update</th>
                  <th className="py-3 px-5 text-base font-light text-zinc-500 text-right">Update speedup</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {/* Baseline */}
                {baselineRun && (
                  <tr className="bg-zinc-50/30">
                    <td className="py-3.5 px-5">
                      <span className="text-base font-medium text-zinc-900">Baseline (Standard Vite)</span>
                    </td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{(baselineRun.gzipBytes / 1024).toFixed(1)} KB</td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-400">baseline</td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{baselineRun.firstRenderMs > 0 ? `${baselineRun.firstRenderMs.toFixed(1)} ms` : '—'}</td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-400">—</td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{baselineRun.updateMs ? `${baselineRun.updateMs.toFixed(1)} ms` : '—'}</td>
                    <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-400">—</td>
                  </tr>
                )}

                {/* Scenario features */}
                {activeScenario.relevantFeatures.map((featId) => {
                  const run = scenarioRuns.find((r) => r.featureId === featId);
                  const featMeta = features.find((f) => f.id === featId);
                  const isCurrent = featId === selectedFeatureId;

                  return (
                    <tr key={featId} className={`hover:bg-zinc-50/80 transition-colors cursor-pointer ${isCurrent ? 'bg-emerald-50/60 font-medium' : ''}`} onClick={() => onSelectFeature(featId)}>
                      <td className="py-3.5 px-5">
                        <div className="flex flex-col">
                          <span className="text-base font-normal text-zinc-900">{featMeta?.name || featId}</span>
                          <span className="text-base font-light text-zinc-500">{featMeta?.description || ''}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{run ? `${(run.gzipBytes / 1024).toFixed(1)} KB` : 'n/a'}</td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-light">
                        {run?.gzipPercent !== undefined && run.gzipPercent !== 0 ? (
                          <span className={run.gzipPercent < 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            {run.gzipPercent > 0 ? `+${run.gzipPercent.toFixed(1)}%` : `${run.gzipPercent.toFixed(1)}%`}
                          </span>
                        ) : (
                          <span className="text-zinc-400">0.0%</span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{run?.firstRenderMs ? `${run.firstRenderMs.toFixed(1)} ms` : '—'}</td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-medium">
                        {run?.speedupPercent && run.speedupPercent > 0 ? (
                          <span className="text-emerald-700">+{run.speedupPercent.toFixed(1)}%</span>
                        ) : (
                          <span className="text-zinc-400 font-light">0.0%</span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-light text-zinc-700">{run?.updateMs ? `${run.updateMs.toFixed(1)} ms` : '—'}</td>
                      <td className="py-3.5 px-5 text-right tabular-nums text-base font-medium">
                        {run?.updateSpeedupPercent && run.updateSpeedupPercent > 0 ? (
                          <span className="text-emerald-700">+{run.updateSpeedupPercent.toFixed(1)}%</span>
                        ) : (
                          <span className="text-zinc-400 font-light">0.0%</span>
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

      {/* Feature breakdown table with heading outside the box */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Full feature comparison</h2>
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
                {allRun &&
                  (() => {
                    const allGzipDelta =
                      baselineRun?.gzipBytes && baselineRun.gzipBytes > 0 && allRun.gzipBytes ? ((allRun.gzipBytes - baselineRun.gzipBytes) / baselineRun.gzipBytes) * 100 : (allRun.gzipPercent ?? 0);
                    const allRawDelta =
                      baselineRun?.rawBytes && baselineRun.rawBytes > 0 && allRun.rawBytes ? ((allRun.rawBytes - baselineRun.rawBytes) / baselineRun.rawBytes) * 100 : (allRun.rawPercent ?? 0);
                    const allSpeedup =
                      baselineRun?.firstRenderMs && allRun.firstRenderMs && baselineRun.firstRenderMs > 0
                        ? ((baselineRun.firstRenderMs - allRun.firstRenderMs) / baselineRun.firstRenderMs) * 100
                        : allRun.speedupPercent;

                    return (
                      <tr
                        className={`transition-colors cursor-pointer ${selectedFeatureId === 'all' ? 'bg-emerald-100/80 font-medium' : 'bg-emerald-50/50 hover:bg-emerald-100/40'}`}
                        onClick={() => onSelectFeature('all')}
                      >
                        <td className="py-3.5 px-6 font-medium text-zinc-950">All optimizations combined</td>
                        <td className="py-3.5 px-6 text-right tabular-nums font-medium text-zinc-950">{(allRun.gzipBytes / 1024).toFixed(1)} KB</td>
                        <td
                          className={`py-3.5 px-6 text-right tabular-nums ${
                            allGzipDelta <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(allGzipDelta) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                          }`}
                        >
                          {allGzipDelta > 0 ? `+${allGzipDelta.toFixed(1)}%` : `${allGzipDelta.toFixed(1)}%`}
                        </td>
                        <td className="py-3.5 px-6 text-right tabular-nums font-medium text-zinc-950">{(allRun.rawBytes / 1024).toFixed(1)} KB</td>
                        <td
                          className={`py-3.5 px-6 text-right tabular-nums ${
                            allRawDelta <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(allRawDelta) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                          }`}
                        >
                          {allRawDelta > 0 ? `+${allRawDelta.toFixed(1)}%` : `${allRawDelta.toFixed(1)}%`}
                        </td>
                        <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-600">{allRun.buildTimeMs ? `${allRun.buildTimeMs.toFixed(0)} ms` : '—'}</td>
                        <td className="py-3.5 px-6 text-right tabular-nums">
                          <div className="flex flex-col items-end">
                            <span className="text-zinc-950 font-normal">{allRun.firstRenderMs ? `${allRun.firstRenderMs.toFixed(2)} ms` : '—'}</span>
                            {allSpeedup !== undefined && Math.abs(allSpeedup) > 0.5 ? (
                              <span className={`text-base font-light tabular-nums ${allSpeedup > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                {allSpeedup > 0 ? `+${allSpeedup.toFixed(1)}%` : `${allSpeedup.toFixed(1)}%`}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}

                {/* Section header for standalone passes */}
                <tr>
                  <td colSpan={7} className="py-2.5 px-6 bg-zinc-100/80 text-base font-medium text-zinc-700 tracking-tight">
                    Individual compiler passes ({individualRuns.length} standalone passes)
                  </td>
                </tr>

                {/* 3. Individual compiler passes */}
                {individualRuns.map((run, idx) => {
                  const isSelected = run.featureId === selectedFeatureId;
                  const gzipDelta =
                    baselineRun?.gzipBytes && baselineRun.gzipBytes > 0 && run.gzipBytes ? ((run.gzipBytes - baselineRun.gzipBytes) / baselineRun.gzipBytes) * 100 : (run.gzipPercent ?? 0);
                  const rawDelta = baselineRun?.rawBytes && baselineRun.rawBytes > 0 && run.rawBytes ? ((run.rawBytes - baselineRun.rawBytes) / baselineRun.rawBytes) * 100 : (run.rawPercent ?? 0);
                  const speedup =
                    baselineRun?.firstRenderMs && run.firstRenderMs && baselineRun.firstRenderMs > 0
                      ? ((baselineRun.firstRenderMs - run.firstRenderMs) / baselineRun.firstRenderMs) * 100
                      : run.speedupPercent;

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
                          gzipDelta <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(gzipDelta) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                        }`}
                      >
                        {gzipDelta > 0 ? `+${gzipDelta.toFixed(1)}%` : `${gzipDelta.toFixed(1)}%`}
                      </td>
                      <td className="py-3.5 px-6 text-right tabular-nums font-light text-zinc-700">{(run.rawBytes / 1024).toFixed(1)} KB</td>
                      <td
                        className={`py-3.5 px-6 text-right tabular-nums ${
                          rawDelta <= -0.1 ? 'text-emerald-700 font-normal' : Math.abs(rawDelta) <= 0.1 ? 'text-zinc-500 font-light' : 'text-rose-700 font-normal'
                        }`}
                      >
                        {rawDelta > 0 ? `+${rawDelta.toFixed(1)}%` : `${rawDelta.toFixed(1)}%`}
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
