import { Activity, Archive, Cpu, Database, Layers, RefreshCw, Scale, SlidersHorizontal, Zap } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import type { ManifestData, ManifestRunEntry } from '../types.js';
import { Dropdown } from './Dropdown.js';

interface MatrixOverviewProps {
  manifest: ManifestData;
  onSelectRun: (suiteId: string, featureId: string) => void;
}

type Category = 'payload' | 'performance';
type PayloadFormat = 'gzip' | 'brotli' | 'raw';
type PayloadUnit = 'percent' | 'kb';
type PerfMetric = 'firstRender' | 'update' | 'scriptEval' | 'registration' | 'heap' | 'buildTime';
type PerfUnit = 'ms' | 'percent';

export const MatrixOverview: React.FC<MatrixOverviewProps> = ({ manifest, onSelectRun }) => {
  const [category, setCategory] = useState<Category>('payload');
  const [payloadFormat, setPayloadFormat] = useState<PayloadFormat>('gzip');
  const [payloadUnit, setPayloadUnit] = useState<PayloadUnit>('percent');
  const [perfMetric, setPerfMetric] = useState<PerfMetric>('firstRender');
  const [perfUnit, setPerfUnit] = useState<PerfUnit>('ms');

  const { libraries, features, runs } = manifest;

  // Build lookup map: suiteId -> featureId -> ManifestRunEntry
  const runMap: Record<string, Record<string, ManifestRunEntry>> = {};
  for (const run of runs) {
    if (!runMap[run.suiteId]) runMap[run.suiteId] = {};
    runMap[run.suiteId][run.featureId] = run;
  }

  // Filter runs for the full recommended suite ("all") to compute cross-library summary KPIs
  const allRuns = runs.filter((r) => r.featureId === 'all');

  const calcAverage = (values: Array<number | undefined>): number | undefined => {
    const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
    if (valid.length === 0) return undefined;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
  };

  const avgGzipPercent = (() => {
    const valid = allRuns.map((r) => r.gzipPercent).filter((v): v is number => typeof v === 'number' && v !== 0);
    if (valid.length === 0) return undefined;
    return valid.reduce((sum, v) => sum + v, 0) / valid.length;
  })();

  const avgRenderSpeedup = calcAverage(allRuns.map((r) => r.speedupPercent));
  const avgUpdateSpeedup = calcAverage(allRuns.map((r) => r.updateSpeedupPercent));
  const avgEvalSpeedup = calcAverage(allRuns.map((r) => r.evalSpeedupPercent));
  const avgRegSpeedup = calcAverage(allRuns.map((r) => r.registrationSpeedupPercent));
  const avgRegMs = calcAverage(allRuns.map((r) => r.registrationMs));
  const avgHeapSavings = calcAverage(allRuns.map((r) => r.memorySavingsPercent));

  function renderCellValue(run?: ManifestRunEntry, isBaseline?: boolean, libId?: string) {
    if (!run) {
      return <span className="text-base font-light text-zinc-400">—</span>;
    }

    if (category === 'payload') {
      if (payloadUnit === 'percent') {
        if (isBaseline) {
          return <span className="text-base font-light text-zinc-500">baseline</span>;
        }
        const val = payloadFormat === 'gzip' ? run.gzipPercent : payloadFormat === 'brotli' ? run.brotliPercent : run.rawPercent;

        const numVal = val ?? 0;
        const isGood = numVal < -0.1;
        const isNeutral = Math.abs(numVal) <= 0.1;

        return (
          <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
            {numVal > 0 ? `+${numVal.toFixed(1)}%` : `${numVal.toFixed(1)}%`}
          </span>
        );
      }

      // payloadUnit === 'kb'
      const bytes = payloadFormat === 'gzip' ? run.gzipBytes : payloadFormat === 'brotli' ? run.brotliBytes : run.rawBytes;
      const kbFormatted = `${(bytes / 1024).toFixed(1)} KB`;

      if (isBaseline) {
        return <span className="tabular-nums text-base font-light text-zinc-600">{kbFormatted}</span>;
      }

      return <span className="tabular-nums text-base font-light text-zinc-700">{kbFormatted}</span>;
    }

    // category === 'performance'
    if (perfMetric === 'firstRender') {
      if (perfUnit === 'ms') {
        if (!run.firstRenderMs || run.firstRenderMs === 0) {
          return <span className="text-base font-light text-zinc-400">—</span>;
        }
        const msFormatted = `${run.firstRenderMs.toFixed(1)} ms`;
        if (isBaseline) {
          return <span className="tabular-nums text-base font-light text-zinc-600">{msFormatted}</span>;
        }
        return <span className="tabular-nums text-base font-light text-zinc-700">{msFormatted}</span>;
      }

      // perfUnit === 'percent'
      if (isBaseline) {
        return <span className="text-base font-light text-zinc-500">baseline</span>;
      }

      const val = run.speedupPercent ?? 0;
      if (val === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      const isGood = val > 0.5;
      const isNeutral = Math.abs(val) <= 0.5;
      return (
        <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
        </span>
      );
    }

    if (perfMetric === 'update') {
      if (perfUnit === 'ms') {
        if (!run.updateMs || run.updateMs === 0) {
          return <span className="text-base font-light text-zinc-400">—</span>;
        }
        const msFormatted = `${run.updateMs.toFixed(2)} ms`;
        if (isBaseline) {
          return <span className="tabular-nums text-base font-light text-zinc-600">{msFormatted}</span>;
        }
        return <span className="tabular-nums text-base font-light text-zinc-700">{msFormatted}</span>;
      }

      // perfUnit === 'percent'
      if (isBaseline) {
        return <span className="text-base font-light text-zinc-500">baseline</span>;
      }

      const val = run.updateSpeedupPercent ?? 0;
      if (val === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      const isGood = val > 0.5;
      const isNeutral = Math.abs(val) <= 0.5;
      return (
        <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
        </span>
      );
    }

    if (perfMetric === 'scriptEval') {
      if (perfUnit === 'ms') {
        if (!run.scriptEvalMs || run.scriptEvalMs === 0) {
          return <span className="text-base font-light text-zinc-400">—</span>;
        }
        const msFormatted = `${run.scriptEvalMs.toFixed(2)} ms`;
        if (isBaseline) {
          return <span className="tabular-nums text-base font-light text-zinc-600">{msFormatted}</span>;
        }
        return <span className="tabular-nums text-base font-light text-zinc-700">{msFormatted}</span>;
      }

      // perfUnit === 'percent'
      if (isBaseline) {
        return <span className="text-base font-light text-zinc-500">baseline</span>;
      }

      const val = run.evalSpeedupPercent ?? 0;
      if (val === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      const isGood = val > 0.5;
      const isNeutral = Math.abs(val) <= 0.5;
      return (
        <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
        </span>
      );
    }

    if (perfMetric === 'registration') {
      if (perfUnit === 'ms') {
        if (!run.registrationMs || run.registrationMs === 0) {
          return <span className="text-base font-light text-zinc-400">—</span>;
        }
        const msFormatted = `${run.registrationMs.toFixed(2)} ms`;
        if (isBaseline) {
          return <span className="tabular-nums text-base font-light text-zinc-600">{msFormatted}</span>;
        }
        return <span className="tabular-nums text-base font-light text-zinc-700">{msFormatted}</span>;
      }

      // perfUnit === 'percent'
      if (isBaseline) {
        return <span className="text-base font-light text-zinc-500">baseline</span>;
      }

      const val = run.registrationSpeedupPercent ?? 0;
      if (val === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      const isGood = val > 0.5;
      const isNeutral = Math.abs(val) <= 0.5;
      return (
        <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
        </span>
      );
    }

    if (perfMetric === 'heap') {
      if (perfUnit === 'ms') {
        if (!run.heapUsedBytes || run.heapUsedBytes === 0) {
          return <span className="text-base font-light text-zinc-400">—</span>;
        }
        const kbFormatted = `${(run.heapUsedBytes / 1024).toFixed(1)} KB`;
        if (isBaseline) {
          return <span className="tabular-nums text-base font-light text-zinc-600">{kbFormatted}</span>;
        }
        return <span className="tabular-nums text-base font-light text-zinc-700">{kbFormatted}</span>;
      }

      // perfUnit === 'percent'
      if (isBaseline) {
        return <span className="text-base font-light text-zinc-500">baseline</span>;
      }

      const val = run.memorySavingsPercent ?? 0;
      if (val === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      const isGood = val > 0.5;
      const isNeutral = Math.abs(val) <= 0.5;
      return (
        <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
          {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
        </span>
      );
    }

    // perfMetric === 'buildTime'
    if (perfUnit === 'ms') {
      if (!run.buildTimeMs || run.buildTimeMs === 0) {
        return <span className="text-base font-light text-zinc-400">—</span>;
      }
      if (isBaseline) {
        return <span className="tabular-nums text-base font-light text-zinc-600">{run.buildTimeMs.toFixed(0)} ms</span>;
      }
      return <span className="tabular-nums text-base font-light text-zinc-700">{run.buildTimeMs.toFixed(0)} ms</span>;
    }

    // perfUnit === 'percent'
    if (isBaseline) {
      return <span className="text-base font-light text-zinc-500">baseline</span>;
    }

    const baselineRun = libId ? runMap[libId]?.baseline : undefined;
    if (!baselineRun?.buildTimeMs || baselineRun.buildTimeMs === 0 || !run.buildTimeMs) {
      return <span className="text-base font-light text-zinc-400">—</span>;
    }

    const val = ((run.buildTimeMs - baselineRun.buildTimeMs) / baselineRun.buildTimeMs) * 100;
    const isGood = val < -0.5;
    const isNeutral = Math.abs(val) <= 0.5;

    return (
      <span className={`tabular-nums text-base ${isNeutral ? 'text-zinc-500 font-light' : isGood ? 'text-emerald-700 font-normal' : 'text-rose-700 font-normal'}`}>
        {val > 0 ? `+${val.toFixed(1)}%` : `${val.toFixed(1)}%`}
      </span>
    );
  }

  // Split features into Macro comparison (Baseline and All combined) and Micro individual passes
  const baselineFeat = features.find((f) => f.id === 'baseline');
  const allFeat = features.find((f) => f.id === 'all');
  const individualFeats = features.filter((f) => f.id !== 'baseline' && f.id !== 'all');

  const perfLabels: Record<PerfMetric, string> = {
    firstRender: 'First render',
    update: 'Reactive update',
    scriptEval: 'Script eval',
    registration: 'Registration',
    heap: 'Heap memory',
    buildTime: 'Build time',
  };

  const activeDescription =
    category === 'payload'
      ? `${payloadFormat === 'gzip' ? 'Gzip' : payloadFormat === 'brotli' ? 'Brotli' : 'Raw'} ${payloadUnit === 'percent' ? 'savings (%)' : 'size (KB)'}`
      : `${perfLabels[perfMetric]} (${perfMetric === 'heap' && perfUnit === 'ms' ? 'KB' : perfUnit})`;

  return (
    <div className="flex flex-col gap-10">
      {/* Performance overview cards */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-950 tracking-tight px-1">Performance overview</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* 1. Bundle size reduction */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'payload' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('payload');
              setPayloadFormat('gzip');
              setPayloadUnit('percent');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Bundle size</span>
              <Archive className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
              {avgGzipPercent !== undefined ? `${avgGzipPercent > 0 ? `+${avgGzipPercent.toFixed(1)}%` : `${avgGzipPercent.toFixed(1)}%`}` : '-'}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Gzip savings</span>
              {avgGzipPercent !== undefined && avgGzipPercent < -0.1 ? <span className="text-base font-normal text-emerald-700">Reduced</span> : null}
            </div>
          </button>

          {/* 2. First render mount latency */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'performance' && perfMetric === 'firstRender' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('performance');
              setPerfMetric('firstRender');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">First render</span>
              <Zap className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{avgRenderSpeedup !== undefined ? `+${avgRenderSpeedup.toFixed(1)}%` : '-'}</div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Mount speedup</span>
              {avgRenderSpeedup !== undefined && avgRenderSpeedup > 0.5 ? (
                <span className="text-base font-normal text-emerald-700">Faster</span>
              ) : (
                <span className="text-base font-light text-zinc-400">Unmeasured</span>
              )}
            </div>
          </button>

          {/* 3. Reactive update latency */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'performance' && perfMetric === 'update' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('performance');
              setPerfMetric('update');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Reactive update</span>
              <RefreshCw className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{avgUpdateSpeedup !== undefined ? `+${avgUpdateSpeedup.toFixed(1)}%` : '-'}</div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Update speedup</span>
              {avgUpdateSpeedup !== undefined && avgUpdateSpeedup > 0.5 ? (
                <span className="text-base font-normal text-emerald-700">Faster</span>
              ) : (
                <span className="text-base font-light text-zinc-400">Unmeasured</span>
              )}
            </div>
          </button>

          {/* 4. Script evaluation time */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'performance' && perfMetric === 'scriptEval' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('performance');
              setPerfMetric('scriptEval');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Script eval</span>
              <Cpu className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{avgEvalSpeedup !== undefined ? `+${avgEvalSpeedup.toFixed(1)}%` : '-'}</div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Eval speedup</span>
              {avgEvalSpeedup !== undefined && avgEvalSpeedup > 0.5 ? (
                <span className="text-base font-normal text-emerald-700">Faster</span>
              ) : (
                <span className="text-base font-light text-zinc-400">Unmeasured</span>
              )}
            </div>
          </button>

          {/* 5. Element registration cost */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'performance' && perfMetric === 'registration' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('performance');
              setPerfMetric('registration');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Registration</span>
              <Layers className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">
              {avgRegSpeedup !== undefined ? `+${avgRegSpeedup.toFixed(1)}%` : avgRegMs !== undefined ? `${avgRegMs.toFixed(1)} ms` : '-'}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Registration cost</span>
              {avgRegSpeedup !== undefined && avgRegSpeedup > 0.5 ? (
                <span className="text-base font-normal text-emerald-700">Faster</span>
              ) : avgRegMs !== undefined ? (
                <span className="text-base font-normal text-zinc-700">Measured</span>
              ) : (
                <span className="text-base font-light text-zinc-400">Unmeasured</span>
              )}
            </div>
          </button>

          {/* 6. Retained heap memory footprint */}
          <button
            type="button"
            className={`text-left rounded-2xl p-5 flex flex-col justify-between gap-3 transition-all cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] bg-white hover:bg-zinc-50/60 ${
              category === 'performance' && perfMetric === 'heap' ? 'ring-[3px] ring-emerald-600' : 'ring-1 ring-zinc-900/5'
            }`}
            onClick={() => {
              setCategory('performance');
              setPerfMetric('heap');
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Heap memory</span>
              <Database className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
            </div>
            <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{avgHeapSavings !== undefined ? `+${avgHeapSavings.toFixed(1)}%` : '-'}</div>
            <div className="flex items-center justify-between">
              <span className="text-base font-light text-zinc-500">Memory savings</span>
              {avgHeapSavings !== undefined && avgHeapSavings > 0.5 ? (
                <span className="text-base font-normal text-emerald-700">Savings</span>
              ) : (
                <span className="text-base font-light text-zinc-400">Unmeasured</span>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* Metric filter controls without enclosing box */}
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Dropdown
          label="Category"
          icon={SlidersHorizontal}
          value={category}
          options={[
            { value: 'payload', label: 'Payload' },
            { value: 'performance', label: 'Performance' },
          ]}
          onChange={(val) => setCategory(val as Category)}
        />

        {category === 'payload' ? (
          <Dropdown
            label="Format"
            icon={Archive}
            value={payloadFormat}
            options={[
              { value: 'gzip', label: 'Gzip' },
              { value: 'brotli', label: 'Brotli' },
              { value: 'raw', label: 'Raw' },
            ]}
            onChange={(val) => setPayloadFormat(val as PayloadFormat)}
          />
        ) : (
          <Dropdown
            label="Metric"
            icon={Activity}
            value={perfMetric}
            options={[
              { value: 'firstRender', label: 'First render' },
              { value: 'update', label: 'Update' },
              { value: 'scriptEval', label: 'Script eval' },
              { value: 'registration', label: 'Registration' },
              { value: 'heap', label: 'Heap memory' },
              { value: 'buildTime', label: 'Build time' },
            ]}
            onChange={(val) => setPerfMetric(val as PerfMetric)}
          />
        )}

        <Dropdown
          label="Unit"
          icon={Scale}
          value={category === 'payload' ? payloadUnit : perfUnit}
          options={
            category === 'payload'
              ? [
                  { value: 'percent', label: 'Percent (%)' },
                  { value: 'kb', label: 'Kilobytes (KB)' },
                ]
              : [
                  { value: 'ms', label: perfMetric === 'heap' ? 'Kilobytes (KB)' : 'Milliseconds (ms)' },
                  { value: 'percent', label: 'Percent (%)' },
                ]
          }
          onChange={(val) => {
            if (category === 'payload') {
              setPayloadUnit(val as PayloadUnit);
            } else {
              setPerfUnit(val as PerfUnit);
            }
          }}
        />
      </div>

      {/* Cross-library table with heading outside the box */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between px-1">
          <h2 className="text-lg font-medium text-zinc-950 tracking-tight">Cross-library optimization matrix</h2>
          <span className="text-base font-light text-zinc-500">{activeDescription}</span>
        </div>

        <div className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-zinc-900/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-base">
              <thead className="bg-white border-b-2 border-zinc-900/10">
                <tr>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight min-w-[280px]">Optimization feature</th>
                  <th className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight w-36">Category</th>
                  {libraries.map((lib) => (
                    <th key={lib.id} className="py-4 px-6 text-base font-medium text-zinc-950 tracking-tight text-right whitespace-nowrap min-w-[140px]">
                      {lib.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 1. Baseline reference row */}
                {baselineFeat && (
                  <tr key={baselineFeat.id} className="bg-zinc-50/90 hover:bg-zinc-100/80 transition-colors">
                    <td className="py-3.5 px-6 font-normal text-zinc-800">{baselineFeat.name}</td>
                    <td className="py-3.5 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-zinc-200/60 text-zinc-600">Baseline</span>
                    </td>
                    {libraries.map((lib) => {
                      const run = runMap[lib.id]?.[baselineFeat.id];
                      return (
                        <td
                          key={lib.id}
                          className="py-3.5 px-6 text-right tabular-nums cursor-pointer hover:bg-zinc-200/40 transition-colors"
                          onClick={() => onSelectRun(lib.id, baselineFeat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectRun(lib.id, baselineFeat.id);
                            }
                          }}
                          title={`Click to view ${lib.name} baseline`}
                        >
                          {renderCellValue(run, true, lib.id)}
                        </td>
                      );
                    })}
                  </tr>
                )}

                {/* 2. All optimizations combined row */}
                {allFeat && (
                  <tr key={allFeat.id} className="bg-emerald-50/50 hover:bg-emerald-100/40 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-zinc-950">{allFeat.name}</td>
                    <td className="py-3.5 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-medium bg-emerald-100/80 text-emerald-800">Combined</span>
                    </td>
                    {libraries.map((lib) => {
                      const run = runMap[lib.id]?.[allFeat.id];
                      return (
                        <td
                          key={lib.id}
                          className="py-3.5 px-6 text-right tabular-nums cursor-pointer hover:bg-emerald-200/40 transition-colors font-medium"
                          onClick={() => onSelectRun(lib.id, allFeat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectRun(lib.id, allFeat.id);
                            }
                          }}
                          title={`Click to view ${lib.name} - ${allFeat.name}`}
                        >
                          {renderCellValue(run, false, lib.id)}
                        </td>
                      );
                    })}
                  </tr>
                )}

                {/* Section header for standalone passes */}
                <tr>
                  <td colSpan={2 + libraries.length} className="py-2.5 px-6 bg-zinc-100/80 text-base font-medium text-zinc-700 tracking-tight">
                    Individual compiler passes ({individualFeats.length} standalone passes)
                  </td>
                </tr>

                {/* 3. Individual compiler passes */}
                {individualFeats.map((feat, idx) => (
                  <tr key={feat.id} className={`transition-colors hover:bg-zinc-100/60 ${idx % 2 === 1 ? 'bg-zinc-50/70' : 'bg-white'}`}>
                    <td className="py-3.5 px-6 font-normal text-zinc-900">{feat.name}</td>
                    <td className="py-3.5 px-6">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-base font-light bg-zinc-100 text-zinc-600">{feat.category}</span>
                    </td>
                    {libraries.map((lib) => {
                      const run = runMap[lib.id]?.[feat.id];
                      return (
                        <td
                          key={lib.id}
                          className="py-3.5 px-6 text-right tabular-nums cursor-pointer hover:bg-zinc-200/50 transition-colors"
                          onClick={() => onSelectRun(lib.id, feat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectRun(lib.id, feat.id);
                            }
                          }}
                          title={`Click to view ${lib.name} - ${feat.name}`}
                        >
                          {renderCellValue(run, false, lib.id)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
