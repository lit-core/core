import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { calculateImpact, getFileSizes } from './metrics.js';
import { closeBrowser, measureBundleRuntime } from './runtime.js';
import { getCombinedPlugins } from './tools/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Run a Vite build for benchmark purposes.
 * @param {Object} options
 * @param {string} options.entryPath
 * @param {string} options.outDir
 * @param {import('vite').Plugin[]} [options.plugins]
 * @returns {Promise<import('./metrics.js').SizeMetrics>}
 */
async function runViteBuild({ entryPath, outDir, plugins = [] }) {
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
 * Execute a benchmark run for a specific suite across all active tools.
 * @param {import('./types.js').BenchmarkSuite} suite
 * @param {import('./types.js').BenchmarkTool[]} tools
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
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
    const baselineRuntime = await measureBundleRuntime(baselineBundle, 'Baseline');
    runtimeRows.push({
      name: 'Baseline (Standard Vite)',
      firstRenderMs: baselineRuntime.firstRenderMs,
      updateMs: baselineRuntime.updateMs,
      isBaseline: true,
    });

    rows.push({
      name: 'Baseline (Standard Vite)',
      description: 'Standard Vite build without optimization plugins',
      metrics: baselineMetrics,
      isBaseline: true,
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
      const toolRuntime = await measureBundleRuntime(toolBundle, tool.name);
      const speedup = baselineRuntime.firstRenderMs > 0 && toolRuntime.firstRenderMs > 0 ? ((baselineRuntime.firstRenderMs - toolRuntime.firstRenderMs) / baselineRuntime.firstRenderMs) * 100 : 0;

      runtimeRows.push({
        name: tool.name,
        firstRenderMs: toolRuntime.firstRenderMs,
        updateMs: toolRuntime.updateMs,
        speedupPercent: speedup,
      });

      rows.push({
        name: tool.name,
        description: tool.description,
        metrics: toolMetrics,
        impact,
      });

      if (typeof tool.getDiagnostics === 'function') {
        const diag = await tool.getDiagnostics(suiteContext);
        if (diag) {
          diagnostics[tool.id] = diag;
        }
      }
    }

    // 3. RUN TOTAL / COMBINED (All Tools Enabled)
    if (options.verbose) {
      console.log(`[${suite.name}] ⚡ Building Combined Bundle (All Active Optimizations)...`);
    }

    let totalMetrics = null;
    let totalImpact = null;
    const totalOutDir = path.join(tempBaseDir, 'dist-total');

    if (tools.length === 1) {
      // Single tool: combined matches that tool's metrics
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
    const totalRuntime = tools.length === 1 && runtimeRows[1] ? runtimeRows[1] : fs.existsSync(totalBundle) ? await measureBundleRuntime(totalBundle, 'TOTAL') : baselineRuntime;
    const totalSpeedup = baselineRuntime.firstRenderMs > 0 && totalRuntime.firstRenderMs > 0 ? ((baselineRuntime.firstRenderMs - totalRuntime.firstRenderMs) / baselineRuntime.firstRenderMs) * 100 : 0;

    runtimeRows.push({
      name: 'TOTAL (All Optimizations Combined)',
      firstRenderMs: totalRuntime.firstRenderMs,
      updateMs: totalRuntime.updateMs,
      speedupPercent: totalSpeedup,
      isTotal: true,
    });

    rows.push({
      name: 'TOTAL (All Optimizations Combined)',
      description: 'Combined impact of all enabled optimization tools',
      metrics: totalMetrics,
      impact: totalImpact,
      isTotal: true,
    });

    // Attach metadata
    const result = Object.assign(rows, {
      diagnostics,
      suiteContext,
      runtimeRows,
    });

    return result;
  } finally {
    await closeBrowser();
    // Teardown suite resources and clean up temp build artifacts
    await suite.cleanup();
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  }
}

/**
 * Convenience runner for single-package benchmarks across frameworks.
 * @param {string} toolId
 * @param {Object} [options]
 * @param {string} [options.suite]
 * @param {boolean} [options.verbose]
 */
export async function runSingleToolBenchmark(toolId, options = {}) {
  const { getSuites } = await import('./suites/index.js');
  const { getActiveTools } = await import('./tools/index.js');
  const { renderAsciiTable, renderAsciiRuntimeTable, renderCrossSuiteSummary } = await import('./table.js');

  const suiteFilter = options.suite || 'all';
  const suites = getSuites(suiteFilter);
  const tools = getActiveTools([toolId]);

  if (suites.length === 0) {
    console.error(`❌ No benchmark suites matched '${suiteFilter}'. Available: webawesome, material, carbon, spectrum, momentum`);
    process.exit(1);
  }

  if (tools.length === 0) {
    console.error(`❌ Tool '${toolId}' is not recognized or not enabled.`);
    process.exit(1);
  }

  console.log(`\n========================================================================================`);
  console.log(`⚡ LIT-CORE BENCHMARK: ${tools[0].name.toUpperCase()}`);
  console.log(`========================================================================================`);
  console.log(`Suites: ${suites.map((s) => s.name).join(', ')}`);

  const crossSuiteSummaries = [];

  for (const suite of suites) {
    console.log(`\n⏳ Evaluating ${suite.name} with ${tools[0].name}...`);
    const rows = await runSuiteBenchmark(suite, tools, { verbose: options.verbose });

    console.log(renderAsciiTable(suite.name, rows));
    if (rows.runtimeRows) {
      console.log(renderAsciiRuntimeTable(suite.name, rows.runtimeRows));
    }

    const baseline = rows.find((r) => r.isBaseline);
    const optimized = rows.find((r) => !r.isBaseline);
    if (baseline && optimized && optimized.impact) {
      crossSuiteSummaries.push({
        suiteName: suite.name,
        componentCount: rows.suiteContext.componentCount,
        baselineRaw: baseline.metrics.rawBytes,
        baselineGzip: baseline.metrics.gzipBytes,
        totalRaw: optimized.metrics.rawBytes,
        totalGzip: optimized.metrics.gzipBytes,
        rawSaved: Math.abs(optimized.impact.rawDiff),
        rawPct: Math.abs(optimized.impact.rawPercent),
        gzipSaved: Math.abs(optimized.impact.gzipDiff),
        gzipPct: Math.abs(optimized.impact.gzipPercent),
      });
    }
  }

  if (crossSuiteSummaries.length > 1) {
    console.log(renderCrossSuiteSummary(crossSuiteSummaries));
  }

  console.log(`\n✓ ${tools[0].name} benchmark complete across ${suites.length} suites.\n`);
}
