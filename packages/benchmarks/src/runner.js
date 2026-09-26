import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { getFileSizes, calculateImpact } from './metrics.js';
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
        },
      },
    },
  });

  const bundlePath = path.join(outDir, 'bundle.js');
  return getFileSizes(bundlePath);
}

/**
 * Execute a benchmark run for a specific suite across all active tools.
 * @param {import('./types.js').BenchmarkSuite} suite
 * @param {import('./types.js').BenchmarkTool[]} tools
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @returns {Promise<import('./table.js').TableRow[] & { diagnostics?: Record<string, any>, suiteContext: import('./types.js').SuiteContext }>}
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

    if (tools.length === 1) {
      // Single tool: combined matches that tool's metrics
      const singleToolRow = rows[1];
      totalMetrics = singleToolRow.metrics;
      totalImpact = singleToolRow.impact;
    } else if (tools.length > 1) {
      const combinedPlugins = await getCombinedPlugins(tools, suiteContext);
      const totalOutDir = path.join(tempBaseDir, 'dist-total');
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
    });

    return result;
  } finally {
    // Teardown suite resources and clean up temp build artifacts
    await suite.cleanup();
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  }
}
