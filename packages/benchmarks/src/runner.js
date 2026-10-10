import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { getFileSizes } from './metrics.js';
import { closeBrowser } from './runtime.js';
import { getScenario, getScenarioForFeature, runScenarioBenchmark } from './scenarios/index.js';
import { createBenchmarkVendorResolverPlugin } from './vendor-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const _defaultResultsDir = path.resolve(__dirname, '../results');

/**
 * Run a Vite build for benchmark purposes.
 * @param {Object} options
 * @param {string} options.entryPath
 * @param {string} options.outDir
 * @param {import('vite').Plugin[]} [options.plugins]
 * @returns {Promise<import('./metrics.js').SizeMetrics>}
 */
export async function runViteBuild({ entryPath, outDir, plugins = [] }) {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const startTime = performance.now();
  await build({
    root: rootDir,
    publicDir: false,
    logLevel: 'silent',
    plugins: [createBenchmarkVendorResolverPlugin(), ...plugins],
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: entryPath,
        output: {
          entryFileNames: 'bundle.js',
          codeSplitting: false,
        },
      },
    },
  });
  const buildTimeMs = performance.now() - startTime;

  const bundlePath = path.join(outDir, 'bundle.js');
  const sizeMetrics = getFileSizes(bundlePath);
  return {
    ...sizeMetrics,
    buildTimeMs,
  };
}

/**
 * Compute comparison percentages between baseline and target runtime measurements.
 * Returns 0 for any metric where either the baseline or target was unmeasured (<= 0).
 * @param {any} baseline
 * @param {any} target
 * @returns {{ speedupPercent: number, updateSpeedupPercent: number, evalSpeedupPercent: number, registrationSpeedupPercent: number, memorySavingsPercent: number }}
 */
export function compareRuntime(baseline, target) {
  const speedupPercent = baseline?.firstRenderMs > 0 && target?.firstRenderMs > 0 ? ((baseline.firstRenderMs - target.firstRenderMs) / baseline.firstRenderMs) * 100 : 0;

  const updateSpeedupPercent = baseline?.updateMs > 0 && target?.updateMs > 0 ? ((baseline.updateMs - target.updateMs) / baseline.updateMs) * 100 : 0;

  const evalSpeedupPercent = baseline?.scriptEvalMs > 0 && target?.scriptEvalMs > 0 ? ((baseline.scriptEvalMs - target.scriptEvalMs) / baseline.scriptEvalMs) * 100 : 0;

  const registrationSpeedupPercent = baseline?.registrationMs > 0 && target?.registrationMs > 0 ? ((baseline.registrationMs - target.registrationMs) / baseline.registrationMs) * 100 : 0;

  const memorySavingsPercent = baseline?.heapUsedBytes > 0 && target?.heapUsedBytes > 0 ? ((baseline.heapUsedBytes - target.heapUsedBytes) / baseline.heapUsedBytes) * 100 : 0;

  return {
    speedupPercent,
    updateSpeedupPercent,
    evalSpeedupPercent,
    registrationSpeedupPercent,
    memorySavingsPercent,
  };
}

/**
 * Build a structured runtime record combining raw measurements and comparison deltas.
 * @param {any} measure
 * @param {any} [comparison]
 * @returns {{ firstRenderMs: number, updateMs: number, scriptEvalMs: number, registrationMs: number, heapUsedBytes: number, speedupPercent: number, updateSpeedupPercent: number, evalSpeedupPercent: number, registrationSpeedupPercent: number, memorySavingsPercent: number }}
 */
export function buildRuntimeRecord(measure, comparison = {}) {
  return {
    firstRenderMs: measure?.firstRenderMs ?? 0,
    updateMs: measure?.updateMs ?? 0,
    scriptEvalMs: measure?.scriptEvalMs ?? 0,
    registrationMs: measure?.registrationMs ?? 0,
    heapUsedBytes: measure?.heapUsedBytes ?? 0,
    speedupPercent: comparison?.speedupPercent ?? 0,
    updateSpeedupPercent: comparison?.updateSpeedupPercent ?? 0,
    evalSpeedupPercent: comparison?.evalSpeedupPercent ?? 0,
    registrationSpeedupPercent: comparison?.registrationSpeedupPercent ?? 0,
    memorySavingsPercent: comparison?.memorySavingsPercent ?? 0,
  };
}

/**
 * Execute a standalone benchmark for a specific suite and a single tool (or baseline / all).
 * Persists the result directly to packages/benchmarks/results/<suiteId>/<featureId>.json
 * and the HTML showcase to packages/benchmarks/results/<suiteId>/<featureId>.html.
 * @param {Object} params
 * @param {import('./types.js').BenchmarkSuite} params.suite
 * @param {import('./types.js').BenchmarkTool | 'baseline' | 'all'} params.tool
 * @param {Object} [params.options]
 * @param {boolean} [params.options.verbose]
 * @param {string} [params.options.outDir]
 * @param {import('./types.js').BenchmarkTool[]} [params.allTools]
 * @returns {Promise<any>}
 */
export async function runStandaloneBenchmark({ suite, tool, options = {}, allTools = [] }) {
  void allTools;
  const isBaseline = tool === 'baseline';
  const isAll = tool === 'all';
  const toolId = isBaseline ? 'baseline' : isAll ? 'all' : tool.id;
  const scenario = getScenarioForFeature(toolId);

  return runScenarioBenchmark({
    scenario,
    suite,
    variantId: toolId,
    options,
  });
}

/**
 * Execute a benchmark run for a specific suite across all active tools.
 * Runs each optimization tool under its authentic designated scenario.
 * @param {import('./types.js').BenchmarkSuite} suite
 * @param {import('./types.js').BenchmarkTool[]} tools
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {string} [options.outDir]
 * @returns {Promise<import('./types.js').SuiteBenchmarkResult>}
 */
export async function runSuiteBenchmark(suite, tools, options = {}) {
  const rows = [];
  const runtimeRows = [];
  const diagnostics = {};

  try {
    // 1. Run baseline for the primary bundle scenario
    const bundleScenario = getScenario('bundle');
    const baselineResult = await runScenarioBenchmark({
      scenario: bundleScenario,
      suite,
      variantId: 'baseline',
      options,
    });

    rows.push({
      name: 'Baseline (Standard Vite)',
      description: 'Standard Vite build without optimization plugins',
      metrics: baselineResult.metrics,
      isBaseline: true,
    });

    runtimeRows.push({
      name: 'Baseline (Standard Vite)',
      firstRenderMs: baselineResult.runtime.firstRenderMs,
      updateMs: baselineResult.runtime.updateMs,
      scriptEvalMs: baselineResult.runtime.scriptEvalMs,
      registrationMs: baselineResult.runtime.registrationMs,
      heapUsedBytes: baselineResult.runtime.heapUsedBytes,
      speedupPercent: 0,
      updateSpeedupPercent: 0,
      evalSpeedupPercent: 0,
      memorySavingsPercent: 0,
      isBaseline: true,
    });

    // 2. Run each tool under its authentic designated scenario
    for (const tool of tools) {
      const scenario = getScenarioForFeature(tool.id);
      const scenarioResult = await runScenarioBenchmark({
        scenario,
        suite,
        variantId: tool.id,
        options,
      });

      const impact = {
        rawDiff: scenarioResult.deltas?.rawBytes || 0,
        rawPercent: scenarioResult.deltas?.rawPercent || 0,
        gzipDiff: scenarioResult.deltas?.gzipBytes || 0,
        gzipPercent: scenarioResult.deltas?.gzipPercent || 0,
        brotliDiff: scenarioResult.deltas?.brotliBytes || 0,
        brotliPercent: scenarioResult.deltas?.brotliPercent || 0,
      };

      rows.push({
        name: tool.name,
        description: `[Scenario: ${scenario.name}] ${tool.description}`,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        metrics: scenarioResult.metrics,
        impact,
      });

      runtimeRows.push({
        name: `${tool.name} [${scenario.name}]`,
        firstRenderMs: scenarioResult.runtime.firstRenderMs,
        updateMs: scenarioResult.runtime.updateMs,
        scriptEvalMs: scenarioResult.runtime.scriptEvalMs,
        registrationMs: scenarioResult.runtime.registrationMs,
        heapUsedBytes: scenarioResult.runtime.heapUsedBytes,
        speedupPercent: scenarioResult.deltas?.speedupPercent || 0,
        updateSpeedupPercent: scenarioResult.deltas?.updateSpeedupPercent || 0,
        evalSpeedupPercent: scenarioResult.deltas?.evalSpeedupPercent || 0,
        registrationSpeedupPercent: scenarioResult.deltas?.registrationSpeedupPercent || 0,
        memorySavingsPercent: scenarioResult.deltas?.memorySavingsPercent || 0,
      });
    }

    // 3. Run total / combined under bundle scenario
    if (tools.length > 1) {
      const totalResult = await runScenarioBenchmark({
        scenario: bundleScenario,
        suite,
        variantId: 'all',
        options,
      });

      const totalImpact = {
        rawDiff: totalResult.deltas?.rawBytes || 0,
        rawPercent: totalResult.deltas?.rawPercent || 0,
        gzipDiff: totalResult.deltas?.gzipBytes || 0,
        gzipPercent: totalResult.deltas?.gzipPercent || 0,
        brotliDiff: totalResult.deltas?.brotliBytes || 0,
        brotliPercent: totalResult.deltas?.brotliPercent || 0,
      };

      rows.push({
        name: 'TOTAL (All Optimizations Combined)',
        description: 'All compiler passes active simultaneously',
        metrics: totalResult.metrics,
        impact: totalImpact,
        isTotal: true,
      });

      runtimeRows.push({
        name: 'TOTAL (All Optimizations Combined)',
        firstRenderMs: totalResult.runtime.firstRenderMs,
        updateMs: totalResult.runtime.updateMs,
        scriptEvalMs: totalResult.runtime.scriptEvalMs,
        registrationMs: totalResult.runtime.registrationMs,
        heapUsedBytes: totalResult.runtime.heapUsedBytes,
        speedupPercent: totalResult.deltas?.speedupPercent || 0,
        updateSpeedupPercent: totalResult.deltas?.updateSpeedupPercent || 0,
        evalSpeedupPercent: totalResult.deltas?.evalSpeedupPercent || 0,
        registrationSpeedupPercent: totalResult.deltas?.registrationSpeedupPercent || 0,
        memorySavingsPercent: totalResult.deltas?.memorySavingsPercent || 0,
        isTotal: true,
      });
    }

    const suiteContext = await suite.setup();
    await suite.cleanup();

    return Object.assign(rows, {
      diagnostics,
      suiteContext,
      runtimeRows,
    });
  } finally {
    await closeBrowser();
    await suite.cleanup();
  }
}
