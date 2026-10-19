import { Archive, ArrowDownRight, ArrowUpRight, Cpu, Database, FileCode, Layers, Package, RefreshCw, Timer, Zap } from 'lucide-react';
import type React from 'react';
import type { ManifestRunEntry, RuntimeMetrics, SizeDeltas, SizeMetrics } from '../types.js';

interface MetricCardsProps {
  metrics?: SizeMetrics;
  baseline?: SizeMetrics;
  deltas?: SizeDeltas;
  runtime?: RuntimeMetrics;
  isBaseline?: boolean;
  baselineRun?: ManifestRunEntry;
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

export const MetricCards: React.FC<MetricCardsProps> = ({ metrics, baseline, deltas, runtime, isBaseline, baselineRun }) => {
  if (!metrics) return null;

  const rawDeltaPct = baselineRun?.rawBytes && metrics?.rawBytes && baselineRun.rawBytes > 0 ? ((metrics.rawBytes - baselineRun.rawBytes) / baselineRun.rawBytes) * 100 : deltas?.rawPercent;
  const rawDeltaBytes = baselineRun?.rawBytes && metrics?.rawBytes ? metrics.rawBytes - baselineRun.rawBytes : deltas?.rawBytes;

  const gzipDeltaPct = baselineRun?.gzipBytes && metrics?.gzipBytes && baselineRun.gzipBytes > 0 ? ((metrics.gzipBytes - baselineRun.gzipBytes) / baselineRun.gzipBytes) * 100 : deltas?.gzipPercent;
  const gzipDeltaBytes = baselineRun?.gzipBytes && metrics?.gzipBytes ? metrics.gzipBytes - baselineRun.gzipBytes : deltas?.gzipBytes;

  const brotliDeltaPct =
    baselineRun?.brotliBytes && metrics?.brotliBytes && baselineRun.brotliBytes > 0 ? ((metrics.brotliBytes - baselineRun.brotliBytes) / baselineRun.brotliBytes) * 100 : deltas?.brotliPercent;
  const brotliDeltaBytes = baselineRun?.brotliBytes && metrics?.brotliBytes ? metrics.brotliBytes - baselineRun.brotliBytes : deltas?.brotliBytes;

  const firstRenderSpeedup =
    baselineRun?.firstRenderMs && runtime?.firstRenderMs && baselineRun.firstRenderMs > 0 && runtime.firstRenderMs > 0
      ? ((baselineRun.firstRenderMs - runtime.firstRenderMs) / baselineRun.firstRenderMs) * 100
      : runtime?.speedupPercent;

  const updateSpeedup =
    baselineRun?.updateMs && runtime?.updateMs && baselineRun.updateMs > 0 && runtime.updateMs > 0
      ? ((baselineRun.updateMs - runtime.updateMs) / baselineRun.updateMs) * 100
      : runtime?.updateSpeedupPercent;

  const evalSpeedup =
    baselineRun?.scriptEvalMs && runtime?.scriptEvalMs && baselineRun.scriptEvalMs > 0 && runtime.scriptEvalMs > 0
      ? ((baselineRun.scriptEvalMs - runtime.scriptEvalMs) / baselineRun.scriptEvalMs) * 100
      : runtime?.evalSpeedupPercent;

  const registrationSpeedup =
    baselineRun?.registrationMs && runtime?.registrationMs && baselineRun.registrationMs > 0 && runtime.registrationMs > 0
      ? ((baselineRun.registrationMs - runtime.registrationMs) / baselineRun.registrationMs) * 100
      : runtime?.registrationSpeedupPercent;

  const memorySavings =
    baselineRun?.heapUsedBytes && runtime?.heapUsedBytes && baselineRun.heapUsedBytes > 0 && runtime.heapUsedBytes > 0
      ? ((baselineRun.heapUsedBytes - runtime.heapUsedBytes) / baselineRun.heapUsedBytes) * 100
      : runtime?.memorySavingsPercent;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {/* Raw size */}
      <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-base font-light text-zinc-500">Raw bundle size</span>
          <FileCode className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{formatBytes(metrics.rawBytes)}</div>
        {!isBaseline && rawDeltaPct !== undefined && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              rawDeltaPct <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(rawDeltaPct) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {rawDeltaPct <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : rawDeltaPct > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(rawDeltaPct)}</span>
            {rawDeltaBytes !== undefined && <span>({formatBytes(rawDeltaBytes)})</span>}
          </div>
        )}
        {baseline && <div className="text-base font-light text-zinc-400 tabular-nums">Baseline: {formatBytes(baseline.rawBytes)}</div>}
      </div>

      {/* Gzip size */}
      <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-base font-light text-zinc-500">Gzip bundle size</span>
          <Archive className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{formatBytes(metrics.gzipBytes)}</div>
        {!isBaseline && gzipDeltaPct !== undefined && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              gzipDeltaPct <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(gzipDeltaPct) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {gzipDeltaPct <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : gzipDeltaPct > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(gzipDeltaPct)}</span>
            {gzipDeltaBytes !== undefined && <span>({formatBytes(gzipDeltaBytes)})</span>}
          </div>
        )}
        {baseline && <div className="text-base font-light text-zinc-400 tabular-nums">Baseline: {formatBytes(baseline.gzipBytes)}</div>}
      </div>

      {/* Brotli size */}
      <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-base font-light text-zinc-500">Brotli bundle size</span>
          <Package className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{formatBytes(metrics.brotliBytes)}</div>
        {!isBaseline && brotliDeltaPct !== undefined && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              brotliDeltaPct <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(brotliDeltaPct) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {brotliDeltaPct <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : brotliDeltaPct > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(brotliDeltaPct)}</span>
            {brotliDeltaBytes !== undefined && <span>({formatBytes(brotliDeltaBytes)})</span>}
          </div>
        )}
        {baseline && <div className="text-base font-light text-zinc-400 tabular-nums">Baseline: {formatBytes(baseline.brotliBytes)}</div>}
      </div>

      {/* Build time */}
      <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-base font-light text-zinc-500">Build time</span>
          <Timer className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{metrics.buildTimeMs ? `${metrics.buildTimeMs.toFixed(1)} ms` : '-'}</div>
        {!isBaseline && deltas?.buildTimeMs !== undefined && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              deltas.buildTimeMs <= 0
                ? 'bg-emerald-50 text-emerald-700'
                : baseline?.buildTimeMs && deltas.buildTimeMs / baseline.buildTimeMs > 0.2
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-zinc-100 text-zinc-700'
            }`}
          >
            <span>{deltas.buildTimeMs > 0 ? `+${deltas.buildTimeMs.toFixed(1)} ms` : `${deltas.buildTimeMs.toFixed(1)} ms`}</span>
          </div>
        )}
      </div>

      {/* First render mount latency */}
      {runtime && runtime.firstRenderMs > 0 && (
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">First render</span>
            <Zap className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{runtime.firstRenderMs.toFixed(2)} ms</div>
          {!isBaseline && firstRenderSpeedup !== undefined && Math.abs(firstRenderSpeedup) > 0.5 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                firstRenderSpeedup > 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {firstRenderSpeedup > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{firstRenderSpeedup > 0 ? `+${firstRenderSpeedup.toFixed(1)}% faster` : `${firstRenderSpeedup.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}

      {/* Reactive update latency */}
      {runtime && runtime.updateMs !== undefined && runtime.updateMs > 0 && (
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Reactive update</span>
            <RefreshCw className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{runtime.updateMs.toFixed(2)} ms</div>
          {!isBaseline && updateSpeedup !== undefined && Math.abs(updateSpeedup) > 0.5 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                updateSpeedup > 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {updateSpeedup > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{updateSpeedup > 0 ? `+${updateSpeedup.toFixed(1)}% faster` : `${updateSpeedup.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}

      {/* Script evaluation */}
      {runtime && runtime.scriptEvalMs !== undefined && runtime.scriptEvalMs > 0 && (
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Script evaluation</span>
            <Cpu className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{runtime.scriptEvalMs.toFixed(2)} ms</div>
          {!isBaseline && evalSpeedup !== undefined && Math.abs(evalSpeedup) > 0.5 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                evalSpeedup > 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {evalSpeedup > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{evalSpeedup > 0 ? `+${evalSpeedup.toFixed(1)}% faster` : `${evalSpeedup.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}

      {/* Custom element registration */}
      {runtime && runtime.registrationMs !== undefined && runtime.registrationMs > 0 && (
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Element registration</span>
            <Layers className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{runtime.registrationMs.toFixed(2)} ms</div>
          {!isBaseline && registrationSpeedup !== undefined && Math.abs(registrationSpeedup) > 0.5 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                registrationSpeedup > 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {registrationSpeedup > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{registrationSpeedup > 0 ? `+${registrationSpeedup.toFixed(1)}% faster` : `${registrationSpeedup.toFixed(1)}%`}</span>
            </div>
          )}
          <div className="text-base font-light text-zinc-400 tabular-nums">customElements.define CPU cost</div>
        </div>
      )}

      {/* Retained heap memory footprint */}
      {runtime && runtime.heapUsedBytes !== undefined && runtime.heapUsedBytes > 0 && (
        <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-base font-light text-zinc-500">Retained heap memory</span>
            <Database className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
          </div>
          <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{formatBytes(runtime.heapUsedBytes)}</div>
          {!isBaseline && memorySavings !== undefined && Math.abs(memorySavings) > 0.5 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                memorySavings > 0.5 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {memorySavings > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{memorySavings > 0 ? `+${memorySavings.toFixed(1)}% savings` : `${memorySavings.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
