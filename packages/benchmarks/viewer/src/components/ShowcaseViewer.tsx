import { Activity, ArrowDownRight, Boxes, Building2, Check, CheckCircle2, CircleDashed, ClipboardCheck, Clock, Cpu, Layers, LayoutGrid, Shield, ShieldAlert, ShieldCheck, Zap } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useState } from 'react';
import { ALL_CANONICAL_COMPONENTS, CONCEPTS, type ComponentItem, LIBRARIES } from '../canonical-registry.js';
import type { ManifestData } from '../types.js';
import { Dropdown } from './Dropdown.js';

export interface ShowcaseViewerProps {
  manifest?: ManifestData | null;
  selectedSuiteId?: string;
  selectedFeatureId?: string;
  onSelectSuite?: (suiteId: string) => void;
  onSelectFeature?: (featureId: string) => void;
}

type ViewMode = 'library' | 'matrix' | 'concept' | 'report';

interface ComponentAuditState {
  item: ComponentItem;
  instanceId: string;
  isDefined: boolean;
  isMounted: boolean;
  hasShadowRoot: boolean;
  isInteractive: boolean;
  error?: string;
}

export const ShowcaseViewer: React.FC<ShowcaseViewerProps> = ({ manifest, selectedSuiteId = 'carbon', selectedFeatureId = 'all', onSelectSuite, onSelectFeature }) => {
  const [currentSuite, setCurrentSuite] = useState<string>(selectedSuiteId);
  const [currentFeature, setCurrentFeature] = useState<string>(selectedFeatureId);
  const [viewMode, setViewMode] = useState<ViewMode>(selectedSuiteId === 'all' ? 'matrix' : 'library');
  const [selectedConcept, setSelectedConcept] = useState<string>('all');
  const uid = useId().replace(/:/g, '');

  const [auditStates, setAuditStates] = useState<Record<string, ComponentAuditState>>(() => {
    const initial: Record<string, ComponentAuditState> = {};
    for (const item of ALL_CANONICAL_COMPONENTS) {
      initial[item.tag] = {
        item,
        instanceId: `canvas-${item.library}-${item.concept}`,
        isDefined: false,
        isMounted: false,
        hasShadowRoot: false,
        isInteractive: false,
      };
    }
    return initial;
  });

  // Keep internal state in sync with props
  useEffect(() => {
    if (selectedSuiteId && selectedSuiteId !== currentSuite) {
      setCurrentSuite(selectedSuiteId);
      if (selectedSuiteId !== 'all') {
        setViewMode('library');
      }
    }
  }, [selectedSuiteId, currentSuite]);

  useEffect(() => {
    if (selectedFeatureId && selectedFeatureId !== currentFeature) {
      setCurrentFeature(selectedFeatureId);
    }
  }, [selectedFeatureId, currentFeature]);

  // Listen for audit reports dispatched by the isolated canvas iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'CANVAS_COMPONENT_AUDIT' && typeof event.data.tag === 'string') {
        const { tag, isDefined, isMounted, hasShadowRoot } = event.data;
        setAuditStates((prev) => {
          const existing = prev[tag];
          if (!existing) return prev;
          if (existing.isDefined === isDefined && existing.isMounted === isMounted && existing.hasShadowRoot === hasShadowRoot) {
            return prev;
          }
          return {
            ...prev,
            [tag]: {
              ...existing,
              isDefined: Boolean(isDefined),
              isMounted: Boolean(isMounted),
              hasShadowRoot: Boolean(hasShadowRoot),
            },
          };
        });
      }

      if (event.data.type === 'CANVAS_COMPONENT_INTERACTIVE' && typeof event.data.tag === 'string') {
        const { tag, isInteractive } = event.data;
        setAuditStates((prev) => {
          const existing = prev[tag];
          if (!existing) return prev;
          return {
            ...prev,
            [tag]: {
              ...existing,
              isInteractive: Boolean(isInteractive),
            },
          };
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSuiteChange = (suiteId: string) => {
    setCurrentSuite(suiteId);
    if (suiteId !== 'all') setViewMode('library');
    if (onSelectSuite) onSelectSuite(suiteId);
  };

  const handleFeatureChange = (featureId: string) => {
    setCurrentFeature(featureId);
    if (onSelectFeature) onSelectFeature(featureId);
  };

  const features = manifest?.features || [
    { id: 'baseline', name: 'Baseline', description: 'Unoptimized baseline build' },
    { id: 'css-fuse', name: 'CSS AST deduplication', description: 'Cross-component shared constructable sheets' },
    { id: 'props-lower', name: 'Lit decorator lowering', description: 'Compile-time property descriptor lowering' },
    { id: 'html-aot', name: 'AOT template compilation', description: 'Static compiled template descriptors' },
    { id: 'all', name: 'All optimizations combined', description: 'Unified multi-pass compiler pipeline' },
  ];

  const baselineFeat = features.find((f) => f.id === 'baseline');
  const allFeat = features.find((f) => f.id === 'all');
  const individualFeats = features.filter((f) => f.id !== 'baseline' && f.id !== 'all');

  const activeFeat = features.find((f) => f.id === currentFeature) || {
    id: currentFeature,
    name: currentFeature,
    description: 'Custom compiler optimization pass',
  };

  const benchmarkRun = manifest?.runs?.find((r: any) => r.suiteId === currentSuite && r.featureId === currentFeature);

  const allStateList = Object.values(auditStates);
  const activeComponents = ALL_CANONICAL_COMPONENTS.filter((c) => {
    if (currentSuite !== 'all' && c.library !== currentSuite) return false;
    if (selectedConcept !== 'all' && c.concept !== selectedConcept) return false;
    return true;
  });

  const definedCount = allStateList.filter((s) => s.isDefined).length;
  const mountedCount = allStateList.filter((s) => s.isMounted).length;
  const shadowCount = allStateList.filter((s) => s.hasShadowRoot).length;
  const interactiveCount = allStateList.filter((s) => s.isInteractive).length;

  return (
    <div className="flex flex-col gap-10">
      {/* Top control bar: view switcher, search, interactive tests directly on canvas */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 p-1.5 bg-zinc-100/80 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-5 py-2 text-base rounded-full transition-all cursor-pointer ${
              viewMode === 'library' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'
            }`}
            onClick={() => setViewMode('library')}
          >
            <Building2 className="w-4 h-4 stroke-[1.5]" />
            <span>By library</span>
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-5 py-2 text-base rounded-full transition-all cursor-pointer ${
              viewMode === 'matrix' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'
            }`}
            onClick={() => setViewMode('matrix')}
          >
            <LayoutGrid className="w-4 h-4 stroke-[1.5]" />
            <span>Matrix view</span>
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-5 py-2 text-base rounded-full transition-all cursor-pointer ${
              viewMode === 'concept' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'
            }`}
            onClick={() => setViewMode('concept')}
          >
            <Layers className="w-4 h-4 stroke-[1.5]" />
            <span>By concept</span>
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-5 py-2 text-base rounded-full transition-all cursor-pointer ${
              viewMode === 'report' ? 'bg-white text-zinc-950 font-medium shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'text-zinc-600 font-light hover:text-zinc-950'
            }`}
            onClick={() => setViewMode('report')}
          >
            <ClipboardCheck className="w-4 h-4 stroke-[1.5]" />
            <span>Audit report</span>
          </button>
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Dropdown
          label="Library"
          icon={Boxes}
          value={currentSuite}
          options={[
            ...LIBRARIES.map((lib) => ({
              value: lib.id,
              label: lib.name,
            })),
            { value: 'all', label: 'All libraries' },
          ]}
          onChange={handleSuiteChange}
        />

        <Dropdown
          label="Optimization"
          icon={Zap}
          value={currentFeature}
          options={[
            ...(allFeat ? [{ value: allFeat.id, label: 'All combined', group: 'Macro options' }] : []),
            ...(baselineFeat ? [{ value: baselineFeat.id, label: 'Baseline', group: 'Macro options' }] : []),
            ...individualFeats.map((feat) => ({
              value: feat.id,
              label: feat.id,
              group: 'Compiler passes',
            })),
          ]}
          onChange={handleFeatureChange}
        />

        {viewMode === 'concept' && (
          <Dropdown
            label="Concept"
            icon={Layers}
            value={selectedConcept}
            options={[
              { value: 'all', label: 'All concepts' },
              ...CONCEPTS.map((c) => ({
                value: c.id,
                label: c.label,
              })),
            ]}
            onChange={setSelectedConcept}
          />
        )}
      </div>

      {/* Overview metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Optimization</span>
            <Cpu className="w-4 h-4 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 truncate">{activeFeat.name}</div>
          <span className="text-base font-light text-zinc-400">{activeFeat.description}</span>
        </div>

        <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Custom elements</span>
            <Boxes className="w-4 h-4 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            {definedCount} / {ALL_CANONICAL_COMPONENTS.length}
          </div>
          <span className="text-base font-light text-zinc-400">Registered in iframe runtime</span>
        </div>

        <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Mounted instances</span>
            <CheckCircle2 className="w-4 h-4 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            {mountedCount} / {activeComponents.length}
          </div>
          <span className="text-base font-light text-zinc-400">Active component frames</span>
        </div>

        <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Encapsulated shadow roots</span>
            <Shield className="w-4 h-4 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
            {shadowCount} / {mountedCount || 1}
          </div>
          <span className="text-base font-light text-zinc-400">Isolated shadow trees</span>
        </div>

        {benchmarkRun && typeof benchmarkRun.gzipPercent === 'number' && benchmarkRun.gzipPercent !== 0 ? (
          <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Gzip savings</span>
              <ArrowDownRight className="w-4 h-4 text-emerald-600 stroke-[1.75]" />
            </div>
            <div
              className={`text-2xl font-light tracking-tight tabular-nums ${
                benchmarkRun.gzipPercent <= -0.1 ? 'text-emerald-700' : Math.abs(benchmarkRun.gzipPercent) <= 0.1 ? 'text-zinc-500' : 'text-rose-700'
              }`}
            >
              {benchmarkRun.gzipPercent > 0 ? `+${benchmarkRun.gzipPercent.toFixed(1)}%` : `${benchmarkRun.gzipPercent.toFixed(1)}%`}
            </div>
            <span className="text-base font-light text-zinc-400">{benchmarkRun.gzipBytes ? `${(benchmarkRun.gzipBytes / 1024).toFixed(1)} KB bundle` : 'Evaluated bundle'}</span>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 flex flex-col gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Interactions verified</span>
              <Activity className="w-4 h-4 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
              {interactiveCount} / {activeComponents.length}
            </div>
            <span className="text-base font-light text-zinc-400">Event dispatch & response</span>
          </div>
        )}
      </div>

      {/* View content */}
      {viewMode === 'report' ? (
        /* Audit report table with heading outside */
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Component audit status</h2>
            <span className="text-base font-light text-zinc-400">{interactiveCount} interactions passed</span>
          </div>

          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5 overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-base">
                <thead>
                  <tr className="bg-zinc-100/75">
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">#</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Concept</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Library</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Custom element tag</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Custom element registry</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Mounted</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Shadow root</th>
                    <th className="py-3.5 px-6 text-base font-normal text-zinc-500">Interactivity</th>
                  </tr>
                </thead>
                <tbody>
                  {allStateList.map((state, idx) => (
                    <tr key={state.item.tag} className={`transition-colors hover:bg-zinc-50/80 ${idx % 2 === 1 ? 'bg-zinc-50/30' : 'bg-white'}`}>
                      <td className="py-3.5 px-6 text-base font-light text-zinc-400">{idx + 1}</td>
                      <td className="py-3.5 px-6 text-base font-normal text-zinc-900">{state.item.conceptLabel}</td>
                      <td className="py-3.5 px-6 text-base font-light text-zinc-600">{state.item.libraryLabel}</td>
                      <td className="py-3.5 px-6">
                        <span className="text-base font-light text-zinc-600 bg-zinc-100/90 px-2.5 py-1 rounded-lg font-mono">{state.item.tag}</span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${state.isDefined ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                        >
                          {state.isDefined ? <Check className="w-4 h-4 stroke-[2]" /> : <Clock className="w-4 h-4 stroke-[1.75]" />}
                          <span>{state.isDefined ? 'defined' : 'pending'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${state.isMounted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                        >
                          {state.isMounted ? <Check className="w-4 h-4 stroke-[2]" /> : <CircleDashed className="w-4 h-4 stroke-[1.75]" />}
                          <span>{state.isMounted ? 'mounted' : 'unmounted'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${
                            state.hasShadowRoot ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
                          }`}
                        >
                          {state.hasShadowRoot ? <ShieldCheck className="w-4 h-4 stroke-[2]" /> : <ShieldAlert className="w-4 h-4 stroke-[1.75]" />}
                          <span>{state.hasShadowRoot ? 'open shadow' : 'light dom'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${
                            state.isInteractive ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
                          }`}
                        >
                          {state.isInteractive ? <Check className="w-4 h-4 stroke-[2]" /> : <Clock className="w-4 h-4 stroke-[1.75]" />}
                          <span>{state.isInteractive ? 'verified' : 'ready'}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : viewMode === 'matrix' ? (
        /* Matrix view: grouped by 20 canonical concepts */
        <div className="flex flex-col gap-10">
          {CONCEPTS.filter((c) => activeComponents.some((comp) => comp.concept === c.id)).map((concept) => {
            const group = activeComponents.filter((comp) => comp.concept === concept.id);
            return (
              <div key={concept.id} className="flex flex-col gap-3">
                <div className="flex justify-between items-baseline px-1">
                  <h2 className="text-lg font-medium text-zinc-950 tracking-tight">{concept.label}</h2>
                  <span className="text-base font-light text-zinc-500">{group.length} design systems evaluated</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {group.map((comp) => {
                    const audit = auditStates[comp.tag];
                    const instanceId = `canvas-${uid}-${comp.library}-${comp.concept}`;
                    const canvasUrl = `./showcase/${currentFeature}/index.html?canvas=true&tag=${comp.tag}&id=${instanceId}`;
                    return (
                      <div
                        key={comp.tag}
                        className="bg-white rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/40 transition-all"
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-base font-medium text-zinc-950">{comp.libraryLabel}</span>
                          <span className="text-base font-light text-zinc-600 bg-zinc-100/90 px-2.5 py-1 rounded-lg font-mono">{comp.tag}</span>
                        </div>

                        {/* Individual component canvas as an isolated iframe */}
                        <div className="h-[150px] flex items-center justify-center bg-zinc-50/80 rounded-xl overflow-hidden">
                          <iframe src={canvasUrl} className="w-full h-full border-none bg-transparent" title={`${comp.libraryLabel} ${comp.conceptLabel}`} loading="lazy" />
                        </div>

                        <div className="flex justify-between items-center text-base font-light text-zinc-500 pt-1">
                          <span className={`inline-flex items-center gap-1.5 ${audit?.isDefined ? 'text-emerald-700 font-normal' : 'text-zinc-500'}`}>
                            {audit?.isDefined ? <Check className="w-4 h-4 stroke-[2]" /> : null}
                            <span>{audit?.isDefined ? 'defined' : 'ready'}</span>
                          </span>
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${
                              audit?.hasShadowRoot ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {audit?.hasShadowRoot ? <ShieldCheck className="w-4 h-4 stroke-[2]" /> : <Shield className="w-4 h-4 stroke-[1.5]" />}
                            <span>{audit?.hasShadowRoot ? 'Shadow DOM' : 'Isolated'}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* By library or filtered view: full grid of cards */
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Canonical components</h2>
            <span className="text-base font-light text-zinc-500">{activeComponents.length} components</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 w-full">
            {activeComponents.map((comp) => {
              const audit = auditStates[comp.tag];
              const instanceId = `canvas-${uid}-${comp.library}-${comp.concept}`;
              const canvasUrl = `./showcase/${currentFeature}/index.html?canvas=true&tag=${comp.tag}&id=${instanceId}`;
              return (
                <div
                  key={comp.tag}
                  className="bg-white rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/40 transition-all"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-base font-medium text-zinc-950 block">{comp.conceptLabel}</span>
                      <span className="text-base font-light text-zinc-500">{comp.libraryLabel}</span>
                    </div>
                    <span className="text-base font-light text-zinc-600 bg-zinc-100/90 px-2.5 py-1 rounded-lg font-mono">{comp.tag}</span>
                  </div>

                  {/* Individual component canvas as an isolated iframe */}
                  <div className="h-[150px] flex items-center justify-center bg-zinc-50/80 rounded-xl overflow-hidden">
                    <iframe src={canvasUrl} className="w-full h-full border-none bg-transparent" title={`${comp.libraryLabel} ${comp.conceptLabel}`} loading="lazy" />
                  </div>

                  <div className="flex justify-between items-center text-base font-light text-zinc-500 pt-1">
                    <span className={`inline-flex items-center gap-1.5 ${audit?.isDefined ? 'text-emerald-700 font-normal' : 'text-zinc-500'}`}>
                      {audit?.isDefined ? <Check className="w-4 h-4 stroke-[2]" /> : null}
                      <span>{audit?.isDefined ? 'defined' : 'ready'}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-light ${audit?.hasShadowRoot ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-600'}`}
                    >
                      {audit?.hasShadowRoot ? <ShieldCheck className="w-4 h-4 stroke-[2]" /> : <Shield className="w-4 h-4 stroke-[1.5]" />}
                      <span>{audit?.hasShadowRoot ? 'Shadow DOM' : 'Isolated'}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
