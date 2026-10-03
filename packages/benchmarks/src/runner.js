import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { calculateImpact, getFileSizes } from './metrics.js';
import { FEATURE_METADATA, loadStandaloneResult, saveStandaloneResult } from './reporters/json-reporter.js';
import { closeBrowser, measureBundleRuntime } from './runtime.js';
import { getEnvironmentMetadata } from './schema.js';
import { getCombinedPlugins } from './tools/index.js';

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
    plugins,
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
  const isBaseline = tool === 'baseline';
  const isAll = tool === 'all';
  const toolId = isBaseline ? 'baseline' : isAll ? 'all' : tool.id;
  const toolName = isBaseline ? FEATURE_METADATA.baseline.name : isAll ? FEATURE_METADATA.all.name : FEATURE_METADATA[tool.id]?.name || tool.name;
  const toolDesc = isBaseline ? FEATURE_METADATA.baseline.description : isAll ? FEATURE_METADATA.all.description : FEATURE_METADATA[tool.id]?.description || tool.description;

  const tempBaseDir = path.join(__dirname, `../.temp-bench-${suite.id}-${toolId}-${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  const suiteContext = await suite.setup();

  try {
    if (options.verbose) {
      console.log(`\n[${suite.name}] 🏗️  Running standalone benchmark for: ${toolName}...`);
    }

    // 1. If running a non-baseline feature, check for cached baseline or build baseline first
    let baselineMetrics = null;
    let baselineRuntime = null;

    if (!isBaseline) {
      const cached = loadStandaloneResult(suite.id, 'baseline', options.outDir);
      if (cached?.metrics && cached?.runtime) {
        baselineMetrics = cached.metrics;
        baselineRuntime = cached.runtime;
        if (options.verbose) {
          console.log(`[${suite.name}] ℹ️  Using existing baseline (${baselineMetrics.rawBytes} bytes)`);
        }
      } else {
        if (options.verbose) {
          console.log(`[${suite.name}] ℹ️  No baseline found; building baseline first...`);
        }
        const baselineOutDir = path.join(tempBaseDir, 'dist-baseline');
        baselineMetrics = await runViteBuild({
          entryPath: suiteContext.entryPath,
          outDir: baselineOutDir,
          plugins: [],
        });
        const baselineBundle = path.join(baselineOutDir, 'bundle.js');
        const rt = await measureBundleRuntime(baselineBundle, 'Baseline');
        baselineRuntime = buildRuntimeRecord(rt);

        // Save baseline JSON for future reuse
        const baselineResult = {
          schemaVersion: '2.0.0',
          id: `${suite.id}-baseline`,
          suite: {
            id: suite.id,
            name: suiteContext.name || suite.name,
            packageName: suiteContext.packageName || suite.packageName,
            version: suiteContext.version || 'unknown',
            componentCount: suiteContext.componentCount,
            components: suiteContext.metadata?.components || [],
          },
          feature: {
            id: 'baseline',
            name: FEATURE_METADATA.baseline.name,
            description: FEATURE_METADATA.baseline.description,
            isBaseline: true,
          },
          timestamp: new Date().toISOString(),
          environment: getEnvironmentMetadata(),
          metrics: baselineMetrics,
          runtime: baselineRuntime,
        };
        saveStandaloneResult({
          suiteId: suite.id,
          featureId: 'baseline',
          result: baselineResult,
          outDir: options.outDir,
        });
      }
    }

    // 2. Build the target bundle
    const targetOutDir = path.join(tempBaseDir, `dist-${toolId}`);
    /** @type {import('vite').Plugin[]} */
    let plugins = [];
    if (!isBaseline) {
      if (isAll) {
        plugins = await getCombinedPlugins(allTools, suiteContext);
      } else {
        plugins = await tool.getPlugins(suiteContext);
      }
    }

    const metrics = await runViteBuild({
      entryPath: suiteContext.entryPath,
      outDir: targetOutDir,
      plugins,
    });

    const bundlePath = path.join(targetOutDir, 'bundle.js');
    const runtimeMeasure = await measureBundleRuntime(bundlePath, toolName);

    let deltas = null;
    let comparison = {};
    if (!isBaseline && baselineMetrics) {
      const impact = calculateImpact(baselineMetrics, metrics);
      deltas = {
        rawBytes: impact.rawDiff,
        rawPercent: impact.rawPercent,
        gzipBytes: impact.gzipDiff,
        gzipPercent: impact.gzipPercent,
        brotliBytes: impact.brotliDiff,
        brotliPercent: impact.brotliPercent,
        buildTimeMs: (metrics.buildTimeMs || 0) - (baselineMetrics.buildTimeMs || 0),
      };

      if (baselineRuntime) {
        comparison = compareRuntime(baselineRuntime, runtimeMeasure);
      }
    }

    const runtime = buildRuntimeRecord(runtimeMeasure, comparison);

    /** @type {Record<string, any>} */
    let diagnostics = {};
    if (!isBaseline && !isAll && typeof tool.getDiagnostics === 'function') {
      try {
        const diag = await tool.getDiagnostics(suiteContext);
        if (diag) diagnostics = diag;
      } catch {}
    }

    const standaloneResult = {
      schemaVersion: '2.0.0',
      id: `${suite.id}-${toolId}`,
      suite: {
        id: suite.id,
        name: suiteContext.name || suite.name,
        packageName: suiteContext.packageName || suite.packageName,
        version: suiteContext.version || 'unknown',
        componentCount: suiteContext.componentCount,
        components: suiteContext.metadata?.components || [],
      },
      feature: {
        id: toolId,
        name: toolName,
        description: toolDesc,
        isBaseline,
      },
      timestamp: new Date().toISOString(),
      environment: getEnvironmentMetadata(),
      metrics,
      ...(isBaseline ? {} : { baseline: baselineMetrics }),
      ...(deltas ? { deltas } : {}),
      runtime,
      ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
    };

    saveStandaloneResult({
      suiteId: suite.id,
      featureId: toolId,
      result: standaloneResult,
      outDir: options.outDir,
    });

    return standaloneResult;
  } finally {
    await closeBrowser();
    await suite.cleanup();
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  }
}

/**
 * Execute a benchmark run for a specific suite across all active tools.
 * Also persists standalone JSON results and HTML showcases for baseline, each tool, and combined bundle.
 * @param {import('./types.js').BenchmarkSuite} suite
 * @param {import('./types.js').BenchmarkTool[]} tools
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {string} [options.outDir]
 * @returns {Promise<import('./types.js').SuiteBenchmarkResult>}
 */
export async function runSuiteBenchmark(suite, tools, options = {}) {
  const tempBaseDir = path.join(__dirname, `../.temp-bench-${suite.id}-${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  const suiteContext = await suite.setup();
  const rows = [];
  /** @type {Record<string, any>} */
  const diagnostics = {};

  try {
    // 1. BASELINE BUILD (Standard Vite, 0 optimizations)
    if (options.verbose) {
      console.log(`\n[${suite.name}] 🏗️  Building Baseline Bundle (Standard Vite)...`);
    }
    const baselineOutDir = path.join(tempBaseDir, 'dist-baseline');
    const baselineMetrics = await runViteBuild({
      entryPath: suiteContext.entryPath,
      outDir: baselineOutDir,
      plugins: [],
    });

    const runtimeRows = [];
    const baselineBundle = path.join(baselineOutDir, 'bundle.js');
    const baselineRuntimeMeasure = await measureBundleRuntime(baselineBundle, 'Baseline');
    const baselineRuntime = buildRuntimeRecord(baselineRuntimeMeasure);

    runtimeRows.push({
      name: 'Baseline (Standard Vite)',
      firstRenderMs: baselineRuntime.firstRenderMs,
      updateMs: baselineRuntime.updateMs,
      scriptEvalMs: baselineRuntime.scriptEvalMs,
      registrationMs: baselineRuntime.registrationMs,
      heapUsedBytes: baselineRuntime.heapUsedBytes,
      speedupPercent: 0,
      updateSpeedupPercent: 0,
      evalSpeedupPercent: 0,
      memorySavingsPercent: 0,
      isBaseline: true,
    });

    rows.push({
      name: 'Baseline (Standard Vite)',
      description: 'Standard Vite build without optimization plugins',
      metrics: baselineMetrics,
      isBaseline: true,
    });

    // Save baseline standalone JSON
    saveStandaloneResult({
      suiteId: suite.id,
      featureId: 'baseline',
      result: {
        schemaVersion: '2.0.0',
        id: `${suite.id}-baseline`,
        suite: {
          id: suite.id,
          name: suiteContext.name || suite.name,
          packageName: suiteContext.packageName || suite.packageName,
          version: suiteContext.version || 'unknown',
          componentCount: suiteContext.componentCount,
          components: suiteContext.metadata?.components || [],
        },
        feature: {
          id: 'baseline',
          name: FEATURE_METADATA.baseline.name,
          description: FEATURE_METADATA.baseline.description,
          isBaseline: true,
        },
        timestamp: new Date().toISOString(),
        environment: getEnvironmentMetadata(),
        metrics: baselineMetrics,
        runtime: baselineRuntime,
      },
      outDir: options.outDir,
    });

    // 2. RUN EACH TOOL IN ISOLATION
    for (const tool of tools) {
      if (options.verbose) {
        console.log(`[${suite.name}] 🔧 Evaluating Tool: ${tool.name}...`);
      }

      const toolPlugins = await tool.getPlugins(suiteContext);
      const toolOutDir = path.join(tempBaseDir, `dist-${tool.id}`);
      const toolMetrics = await runViteBuild({
        entryPath: suiteContext.entryPath,
        outDir: toolOutDir,
        plugins: toolPlugins,
      });

      const impact = calculateImpact(baselineMetrics, toolMetrics);
      const toolBundle = path.join(toolOutDir, 'bundle.js');
      const toolRuntimeMeasure = await measureBundleRuntime(toolBundle, tool.name);
      const toolComparison = compareRuntime(baselineRuntime, toolRuntimeMeasure);
      const toolRuntime = buildRuntimeRecord(toolRuntimeMeasure, toolComparison);

      runtimeRows.push({
        name: tool.name,
        firstRenderMs: toolRuntime.firstRenderMs,
        updateMs: toolRuntime.updateMs,
        scriptEvalMs: toolRuntime.scriptEvalMs,
        registrationMs: toolRuntime.registrationMs,
        heapUsedBytes: toolRuntime.heapUsedBytes,
        speedupPercent: toolRuntime.speedupPercent,
        updateSpeedupPercent: toolRuntime.updateSpeedupPercent,
        evalSpeedupPercent: toolRuntime.evalSpeedupPercent,
        memorySavingsPercent: toolRuntime.memorySavingsPercent,
      });

      rows.push({
        name: tool.name,
        description: tool.description,
        metrics: toolMetrics,
        impact,
      });

      /** @type {Record<string, any>} */
      let toolDiag = {};
      if (typeof tool.getDiagnostics === 'function') {
        const diag = await tool.getDiagnostics(suiteContext);
        if (diag) {
          toolDiag = diag;
          diagnostics[tool.id] = diag;
        }
      }

      // Save standalone JSON for this tool
      saveStandaloneResult({
        suiteId: suite.id,
        featureId: tool.id,
        result: {
          schemaVersion: '2.0.0',
          id: `${suite.id}-${tool.id}`,
          suite: {
            id: suite.id,
            name: suiteContext.name || suite.name,
            packageName: suiteContext.packageName || suite.packageName,
            version: suiteContext.version || 'unknown',
            componentCount: suiteContext.componentCount,
            components: suiteContext.metadata?.components || [],
          },
          feature: {
            id: tool.id,
            name: FEATURE_METADATA[tool.id]?.name || tool.name,
            description: FEATURE_METADATA[tool.id]?.description || tool.description,
            isBaseline: false,
          },
          timestamp: new Date().toISOString(),
          environment: getEnvironmentMetadata(),
          metrics: toolMetrics,
          baseline: baselineMetrics,
          deltas: {
            rawBytes: impact.rawDiff,
            rawPercent: impact.rawPercent,
            gzipBytes: impact.gzipDiff,
            gzipPercent: impact.gzipPercent,
            brotliBytes: impact.brotliDiff,
            brotliPercent: impact.brotliPercent,
            buildTimeMs: (toolMetrics.buildTimeMs || 0) - (baselineMetrics.buildTimeMs || 0),
          },
          runtime: toolRuntime,
          ...(Object.keys(toolDiag).length > 0 ? { diagnostics: toolDiag } : {}),
        },
        outDir: options.outDir,
      });
    }

    // 3. RUN TOTAL / COMBINED (All Tools Enabled)
    if (options.verbose) {
      console.log(`[${suite.name}] ⚡ Building Combined Bundle (All Active Optimizations)...`);
    }

    let totalMetrics = null;
    let totalImpact = null;
    const totalOutDir = path.join(tempBaseDir, 'dist-total');

    if (tools.length === 1) {
      const singleToolRow = rows[1];
      totalMetrics = singleToolRow.metrics;
      totalImpact = singleToolRow.impact;
    } else if (tools.length > 1) {
      const combinedPlugins = await getCombinedPlugins(tools, suiteContext);
      totalMetrics = await runViteBuild({
        entryPath: suiteContext.entryPath,
        outDir: totalOutDir,
        plugins: combinedPlugins,
      });
      totalImpact = calculateImpact(baselineMetrics, totalMetrics);
    } else {
      totalMetrics = baselineMetrics;
      totalImpact = calculateImpact(baselineMetrics, baselineMetrics);
    }

    const totalBundle = path.join(totalOutDir, 'bundle.js');
    const totalRuntimeMeasure = tools.length === 1 && runtimeRows[1] ? runtimeRows[1] : fs.existsSync(totalBundle) ? await measureBundleRuntime(totalBundle, 'TOTAL') : baselineRuntime;
    const totalComparison = compareRuntime(baselineRuntime, totalRuntimeMeasure);
    const totalRuntime = buildRuntimeRecord(totalRuntimeMeasure, totalComparison);

    runtimeRows.push({
      name: 'TOTAL (All Optimizations Combined)',
      firstRenderMs: totalRuntime.firstRenderMs,
      updateMs: totalRuntime.updateMs,
      scriptEvalMs: totalRuntime.scriptEvalMs,
      registrationMs: totalRuntime.registrationMs,
      heapUsedBytes: totalRuntime.heapUsedBytes,
      speedupPercent: totalRuntime.speedupPercent,
      updateSpeedupPercent: totalRuntime.updateSpeedupPercent,
      evalSpeedupPercent: totalRuntime.evalSpeedupPercent,
      memorySavingsPercent: totalRuntime.memorySavingsPercent,
      isTotal: true,
    });

    rows.push({
      name: 'TOTAL (All Optimizations Combined)',
      description: 'Combined impact of all enabled optimization tools',
      metrics: totalMetrics,
      impact: totalImpact,
      isTotal: true,
    });

    // Save combined standalone JSON
    if (tools.length > 1) {
      saveStandaloneResult({
        suiteId: suite.id,
        featureId: 'all',
        result: {
          schemaVersion: '2.0.0',
          id: `${suite.id}-all`,
          suite: {
            id: suite.id,
            name: suiteContext.name || suite.name,
            packageName: suiteContext.packageName || suite.packageName,
            version: suiteContext.version || 'unknown',
            componentCount: suiteContext.componentCount,
            components: suiteContext.metadata?.components || [],
          },
          feature: {
            id: 'all',
            name: FEATURE_METADATA.all.name,
            description: FEATURE_METADATA.all.description,
            isBaseline: false,
          },
          timestamp: new Date().toISOString(),
          environment: getEnvironmentMetadata(),
          metrics: totalMetrics,
          baseline: baselineMetrics,
          deltas: totalImpact
            ? {
                rawBytes: totalImpact.rawDiff,
                rawPercent: totalImpact.rawPercent,
                gzipBytes: totalImpact.gzipDiff,
                gzipPercent: totalImpact.gzipPercent,
                brotliBytes: totalImpact.brotliDiff,
                brotliPercent: totalImpact.brotliPercent,
                buildTimeMs: (totalMetrics.buildTimeMs || 0) - (baselineMetrics.buildTimeMs || 0),
              }
            : {},
          runtime: totalRuntime,
        },
        outDir: options.outDir,
      });
    }

    return Object.assign(rows, {
      diagnostics,
      suiteContext,
      runtimeRows,
    });
  } finally {
    await closeBrowser();
    await suite.cleanup();
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  }
}
