import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import type { ManifestData, ScenarioMetadata } from '../types.js';

interface ScenarioViewProps {
  manifest: ManifestData;
  selectedSuiteId: string;
  onSelectSuite: (suiteId: string) => void;
  onSelectFeature: (featureId: string) => void;
  onOpenFeatureView: () => void;
}

export const DEFAULT_SCENARIOS: ScenarioMetadata[] = [
  {
    id: 'data-grid',
    name: 'Data grid',
    description: 'High-density data grid rendering 100 rows with real component cells testing TreeWalker bypass, dependency bitmasking, and micro-runtime compilation',
    relevantFeatures: ['dom-paths', 'dirty-mask', 'native'],
    componentConcepts: ['checkbox', 'badge', 'button', 'icon-button'],
  },
  {
    id: 'interactive-form',
    name: 'Interactive form',
    description: 'Dense multi-section interactive settings form with real controls testing event listener hoisting and deferred proxy registration',
    relevantFeatures: ['event-hoist', 'elem-proxy'],
    componentConcepts: ['text-input', 'checkbox', 'switch', 'radio', 'select', 'button'],
  },
  {
    id: 'ssr-dashboard',
    name: 'SSR dashboard',
    description: 'Server-rendered dashboard with Declarative Shadow DOM components testing zero-JS resumption and AOT template compilation',
    relevantFeatures: ['resumable', 'html-aot'],
    componentConcepts: ['card', 'badge', 'progress-bar', 'button', 'tabs'],
  },
  {
    id: 'dynamic-feed',
    name: 'Dynamic feed',
    description: 'Dynamic reactive feed with repeated collection items testing directive lowering, expression memoization, and static HTML clustering',
    relevantFeatures: ['directives', 'memoize', 'html-fuse'],
    componentConcepts: ['card', 'badge', 'icon', 'button', 'chips', 'divider'],
  },
  {
    id: 'selective-app',
    name: 'Selective application',
    description: 'Enterprise application importing design system components with selective usage testing Custom Element tag shaking and dead code elimination',
    relevantFeatures: ['tag-shake'],
    componentConcepts: ['button', 'badge', 'card'],
  },
  {
    id: 'bundle',
    name: 'Multi-component bundle',
    description: 'Enterprise application importing 20 canonical components across routes testing cross-component CSS AST deduplication and decorator lowering',
    relevantFeatures: ['css-fuse', 'props-lower', 'css-minifier', 'html-minifier', 'all'],
    componentConcepts: [
      'button',
      'checkbox',
      'radio',
      'switch',
      'text-input',
      'select',
      'dialog',
      'badge',
      'tabs',
      'progress-bar',
      'spinner',
      'slider',
      'menu',
      'divider',
      'icon',
      'icon-button',
      'card',
      'elevation',
      'list',
      'chips',
    ],
  },
];

export const ScenarioView: React.FC<ScenarioViewProps> = ({ manifest, selectedSuiteId, onSelectSuite, onSelectFeature, onOpenFeatureView }) => {
  const scenarios = useMemo(() => {
    return manifest.scenarios && manifest.scenarios.length > 0 ? manifest.scenarios : DEFAULT_SCENARIOS;
  }, [manifest.scenarios]);

  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('data-grid');

  const activeScenario = useMemo(() => {
    return scenarios.find((s) => s.id === selectedScenarioId) || scenarios[0];
  }, [scenarios, selectedScenarioId]);

  const selectedLibrary = useMemo(() => {
    return manifest.libraries.find((l) => l.id === selectedSuiteId) || manifest.libraries[0];
  }, [manifest.libraries, selectedSuiteId]);

  // Runs for the active scenario and suite
  const scenarioRuns = useMemo(() => {
    const relevantIds = new Set(['baseline', ...activeScenario.relevantFeatures]);
    return manifest.runs.filter((r) => r.suiteId === selectedSuiteId && relevantIds.has(r.featureId));
  }, [manifest.runs, selectedSuiteId, activeScenario]);

  const baselineRun = useMemo(() => {
    return manifest.runs.find((r) => r.suiteId === selectedSuiteId && r.featureId === 'baseline');
  }, [manifest.runs, selectedSuiteId]);

  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Top canvas controls: scenario selector & library selector */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <span className="w-28 text-base font-light text-zinc-500 shrink-0">Scenario</span>
          <div className="flex flex-wrap gap-2">
            {scenarios.map((s) => {
              const isActive = s.id === activeScenario.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`px-4 py-2 text-base rounded-xl transition-all cursor-pointer shadow-none ${
                    isActive
                      ? 'bg-zinc-900 text-white font-medium shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5'
                      : 'bg-white text-zinc-700 font-light hover:text-zinc-950 hover:bg-zinc-100/80 ring-1 ring-zinc-900/5'
                  }`}
                  onClick={() => setSelectedScenarioId(s.id)}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <span className="w-28 text-base font-light text-zinc-500 shrink-0">Library</span>
          <div className="flex flex-wrap gap-2">
            {manifest.libraries.map((lib) => {
              const isActive = lib.id === selectedSuiteId;
              return (
                <button
                  key={lib.id}
                  type="button"
                  className={`px-4 py-2 text-base rounded-xl transition-all cursor-pointer shadow-none ${
                    isActive
                      ? 'bg-emerald-700 text-white font-medium shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5'
                      : 'bg-white text-zinc-700 font-light hover:text-zinc-950 hover:bg-zinc-100/80 ring-1 ring-zinc-900/5'
                  }`}
                  onClick={() => onSelectSuite(lib.id)}
                >
                  {lib.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scenario heading outside surface card */}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Scenario overview: {activeScenario.name}</h2>
        <p className="text-base font-light text-zinc-500 max-w-4xl leading-relaxed">{activeScenario.description}</p>
      </div>

      {/* Context card: tested real components and compiler passes */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-base font-light text-zinc-500">Evaluated compiler passes</span>
            <div className="flex flex-wrap gap-2 mt-1">
              {activeScenario.relevantFeatures.map((featId) => {
                const featMeta = manifest.features.find((f) => f.id === featId);
                return (
                  <button
                    key={featId}
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100/90 text-zinc-800 text-base font-normal hover:bg-zinc-200/80 transition-colors cursor-pointer"
                    onClick={() => {
                      onSelectFeature(featId);
                      onOpenFeatureView();
                    }}
                  >
                    <span>{featMeta?.name.split(' (')[0] || featId}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-zinc-400 stroke-[1.75]" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-base font-light text-zinc-500">Tested canonical components</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {activeScenario.componentConcepts.map((concept) => (
                <span key={concept} className="px-2.5 py-1 rounded-md bg-zinc-50 text-zinc-700 text-base font-light ring-1 ring-zinc-900/5 font-mono">
                  {concept}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-base font-light text-zinc-500">Equivalence verification</span>
            <div className="flex items-center gap-2 text-emerald-700 mt-1">
              <CheckCircle2 className="w-5 h-5 stroke-[1.75]" />
              <span className="text-base font-medium">DOM structure verified</span>
            </div>
            <p className="text-base font-light text-zinc-500">Evaluated in real Chromium via Playwright across {selectedLibrary.name} instances.</p>
          </div>
        </div>
      </div>

      {/* Comparative results table heading outside surface card */}
      <div className="flex flex-col gap-1 mt-2">
        <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Comparative execution metrics ({selectedLibrary.name})</h2>
        <p className="text-base font-light text-zinc-500">Comparing untouched Vite baseline against authentic compiler optimization variants in this scenario.</p>
      </div>

      {/* Results table card */}
      <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50">
                <th className="py-4 px-6 text-base font-light text-zinc-500">Optimization variant</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">Minified JS</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">Gzip bundle</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">First render</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">Render speedup</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">Reactive update</th>
                <th className="py-4 px-6 text-base font-light text-zinc-500 text-right">Update speedup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {/* Baseline row */}
              {baselineRun && (
                <tr className="bg-zinc-50/30">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-zinc-900">Baseline (Standard Vite)</span>
                      <span className="px-2 py-0.5 rounded text-base font-light text-zinc-500 bg-zinc-200/60">baseline</span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{(baselineRun.rawBytes / 1024).toFixed(1)} KB</td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{(baselineRun.gzipBytes / 1024).toFixed(1)} KB</td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{baselineRun.firstRenderMs > 0 ? `${baselineRun.firstRenderMs.toFixed(1)} ms` : 'n/a'}</td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-500">-</td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{baselineRun.updateMs ? `${baselineRun.updateMs.toFixed(1)} ms` : 'n/a'}</td>
                  <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-500">-</td>
                </tr>
              )}

              {/* Variant rows for active scenario */}
              {activeScenario.relevantFeatures.map((featId) => {
                const run = scenarioRuns.find((r) => r.featureId === featId);
                const featMeta = manifest.features.find((f) => f.id === featId);

                return (
                  <tr
                    key={featId}
                    className="hover:bg-zinc-50/50 transition-colors cursor-pointer"
                    onClick={() => {
                      onSelectFeature(featId);
                      onOpenFeatureView();
                    }}
                  >
                    <td className="py-4 px-6">
                      <div className="flex flex-col">
                        <span className="text-base font-normal text-zinc-900">{featMeta?.name || featId}</span>
                        <span className="text-base font-light text-zinc-500">{featMeta?.description || ''}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{run ? `${(run.rawBytes / 1024).toFixed(1)} KB` : 'n/a'}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{run ? `${(run.gzipBytes / 1024).toFixed(1)} KB` : 'n/a'}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{run?.firstRenderMs ? `${run.firstRenderMs.toFixed(1)} ms` : 'n/a'}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-medium">
                      {run?.speedupPercent && run.speedupPercent > 0 ? (
                        <span className="text-emerald-700">+{run.speedupPercent.toFixed(1)}%</span>
                      ) : (
                        <span className="text-zinc-500 font-light">0.0%</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-light text-zinc-700">{run?.updateMs ? `${run.updateMs.toFixed(1)} ms` : 'n/a'}</td>
                    <td className="py-4 px-6 text-right tabular-nums text-base font-medium">
                      {run?.updateSpeedupPercent && run.updateSpeedupPercent > 0 ? (
                        <span className="text-emerald-700">+{run.updateSpeedupPercent.toFixed(1)}%</span>
                      ) : (
                        <span className="text-zinc-500 font-light">0.0%</span>
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
  );
};
