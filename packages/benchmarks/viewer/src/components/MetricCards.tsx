import type React from 'react';
import { Archive, ArrowDownRight, ArrowUpRight, Cpu, Database, FileCode, Layers, Package, RefreshCw, Timer, Zap } from 'lucide-react';
import type { RuntimeMetrics, SizeDeltas, SizeMetrics } from '../types.js';

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {/* Raw size */}
      <div className="bg-white rounded-2xl p-6 flex flex-col gap-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_36px_rgb(0,0,0,0.06)] ring-1 ring-zinc-900/5 hover:bg-zinc-50/50 transition-all">
        <div className="flex items-center justify-between">
          <span className="text-base font-light text-zinc-500">Raw bundle size</span>
          <FileCode className="w-5 h-5 text-zinc-400 stroke-[1.5]" />
        </div>
        <div className="text-2xl font-light tracking-tight text-zinc-950 tabular-nums">{formatBytes(metrics.rawBytes)}</div>
        {!isBaseline && deltas && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              (deltas.rawPercent ?? 0) <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(deltas.rawPercent ?? 0) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {(deltas.rawPercent ?? 0) <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : (deltas.rawPercent ?? 0) > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(deltas.rawPercent)}</span>
            <span>({formatBytes(deltas.rawBytes)})</span>
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
        {!isBaseline && deltas && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              (deltas.gzipPercent ?? 0) <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(deltas.gzipPercent ?? 0) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {(deltas.gzipPercent ?? 0) <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : (deltas.gzipPercent ?? 0) > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(deltas.gzipPercent)}</span>
            <span>({formatBytes(deltas.gzipBytes)})</span>
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
        {!isBaseline && deltas && (
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
              (deltas.brotliPercent ?? 0) <= -0.1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(deltas.brotliPercent ?? 0) <= 0.1 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {(deltas.brotliPercent ?? 0) <= -0.1 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : (deltas.brotliPercent ?? 0) > 0.1 ? <ArrowUpRight className="w-4 h-4 stroke-[1.75]" /> : null}
            <span>{formatPercent(deltas.brotliPercent)}</span>
            <span>({formatBytes(deltas.brotliBytes)})</span>
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
          {!isBaseline && runtime.speedupPercent !== undefined && runtime.speedupPercent !== 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                runtime.speedupPercent > 0.5 ? 'bg-emerald-50 text-emerald-700' : Math.abs(runtime.speedupPercent) <= 0.5 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {runtime.speedupPercent > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{runtime.speedupPercent > 0 ? `+${runtime.speedupPercent.toFixed(1)}% faster` : `${runtime.speedupPercent.toFixed(1)}%`}</span>
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
          {!isBaseline && runtime.updateSpeedupPercent !== undefined && runtime.updateSpeedupPercent !== 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                runtime.updateSpeedupPercent > 0.5 ? 'bg-emerald-50 text-emerald-700' : Math.abs(runtime.updateSpeedupPercent) <= 0.5 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {runtime.updateSpeedupPercent > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{runtime.updateSpeedupPercent > 0 ? `+${runtime.updateSpeedupPercent.toFixed(1)}% faster` : `${runtime.updateSpeedupPercent.toFixed(1)}%`}</span>
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
          {!isBaseline && runtime.evalSpeedupPercent !== undefined && runtime.evalSpeedupPercent !== 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                runtime.evalSpeedupPercent > 0.5 ? 'bg-emerald-50 text-emerald-700' : Math.abs(runtime.evalSpeedupPercent) <= 0.5 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {runtime.evalSpeedupPercent > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{runtime.evalSpeedupPercent > 0 ? `+${runtime.evalSpeedupPercent.toFixed(1)}% faster` : `${runtime.evalSpeedupPercent.toFixed(1)}%`}</span>
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
          {!isBaseline && runtime.registrationSpeedupPercent !== undefined && runtime.registrationSpeedupPercent !== 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                runtime.registrationSpeedupPercent > 0.5
                  ? 'bg-emerald-50 text-emerald-700'
                  : Math.abs(runtime.registrationSpeedupPercent) <= 0.5
                    ? 'bg-zinc-100 text-zinc-700'
                    : 'bg-rose-50 text-rose-700'
              }`}
            >
              {runtime.registrationSpeedupPercent > 0.5 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{runtime.registrationSpeedupPercent > 0 ? `+${runtime.registrationSpeedupPercent.toFixed(1)}% faster` : `${runtime.registrationSpeedupPercent.toFixed(1)}%`}</span>
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
          {!isBaseline && runtime.memorySavingsPercent !== undefined && runtime.memorySavingsPercent !== 0 && (
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-base font-normal tabular-nums w-fit ${
                runtime.memorySavingsPercent > 0.5 ? 'bg-emerald-50 text-emerald-700' : Math.abs(runtime.memorySavingsPercent) <= 0.5 ? 'bg-zinc-100 text-zinc-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {runtime.memorySavingsPercent > 0 ? <ArrowDownRight className="w-4 h-4 stroke-[1.75]" /> : null}
              <span>{runtime.memorySavingsPercent > 0 ? `+${runtime.memorySavingsPercent.toFixed(1)}% savings` : `${runtime.memorySavingsPercent.toFixed(1)}%`}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
