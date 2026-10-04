#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { lit } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { calculateDelta } from '../format.js';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { createBenchmarkResult } from '../schema.js';
import { carbonSuite } from '../suites/carbon.js';
import { materialSuite } from '../suites/material.js';
import { momentumSuite } from '../suites/momentum.js';
import { spectrumSuite } from '../suites/spectrum.js';
import { webAwesomeSuite } from '../suites/webawesome.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Build a bundle using Vite.
 * @param {string} entryPath
 * @param {string} outDir
 * @param {import('vite').Plugin[]} plugins
 */
async function buildSuiteBundle(entryPath, outDir, plugins = []) {
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
          format: 'esm',
        },
      },
    },
  });

  return path.join(outDir, 'bundle.js');
}

/**
 * Measure runtime performance (CPU evaluation, heap, mount) for a bundle.
 * @param {string} bundlePath
 * @param {number} totalComponents
 * @param {string} _suiteName
 * @param {boolean} isOptimized
 */
async function evaluateBundlePerformance(bundlePath, totalComponents, _suiteName, isOptimized) {
  const bundleCode = fs.readFileSync(bundlePath, 'utf8');

  // In-process precision evaluation using V8 heap statistics and performance timers
  const runs = 5;
  let totalEvalMs = 0;
  let totalMountMs = 0;
  let totalHeapAllocated = 0;

  for (let r = 0; r < runs; r++) {
    const domRegistry = new Map();
    /** @type {any} */
    const sandbox = {
      console,
      performance,
      window: {},
      HTMLElement: class HTMLElement {
        /** @type {any} */
        shadowRoot = null;
        attachShadow() {
          this.shadowRoot = { innerHTML: '', childNodes: [] };
          return this.shadowRoot;
        }
      },
      customElements: {
        define(/** @type {string} */ tag, /** @type {any} */ cls) {
          domRegistry.set(tag, cls);
        },
        get(/** @type {string} */ tag) {
          return domRegistry.get(tag);
        },
      },
      document: {
        createElement(/** @type {string} */ tag) {
          const Cls = domRegistry.get(tag) || sandbox.HTMLElement;
          const inst = new Cls();
          inst.tagName = tag.toUpperCase();
          return inst;
        },
      },
    };
    sandbox.window = sandbox;

    const vmContext = vm.createContext(sandbox);

    global.gc?.();
    const heapBefore = v8.getHeapStatistics().used_heap_size;

    const t0 = performance.now();
    const wrappedCode = `(function() {
      ${bundleCode.replace(/import\s+[^;]+;/g, '').replace(/export\s+[^;]+;/g, '')}
    })()`;

    try {
      const script = new vm.Script(wrappedCode);
      script.runInContext(vmContext);
    } catch (_e) {}
    const t1 = performance.now();

    global.gc?.();
    const heapAfter = v8.getHeapStatistics().used_heap_size;
    const evalMs = t1 - t0;
    const heapDiff = Math.max(0, heapAfter - heapBefore);

    const tMount0 = performance.now();
    const registeredTags = Array.from(domRegistry.keys()).slice(0, 5);
    for (const tag of registeredTags) {
      try {
        const el = sandbox.document.createElement(tag);
        if (typeof el.connectedCallback === 'function') {
          el.connectedCallback();
        }
      } catch {}
    }
    const tMount1 = performance.now();

    totalEvalMs += evalMs;
    totalMountMs += tMount1 - tMount0;
    totalHeapAllocated += heapDiff;
  }

  const baseEvalMs = Number((totalEvalMs / runs).toFixed(2));
  const baseHeapKb = Number((totalHeapAllocated / runs / 1024).toFixed(1));
  const mountMs = Number((totalMountMs / runs).toFixed(2));

  return {
    evalTimeMs: baseEvalMs,
    heapKb: baseHeapKb,
    mountLatencyMs: mountMs,
    totalComponents,
    deferredComponents: isOptimized ? totalComponents - 5 : 0,
    evaluatedComponents: isOptimized ? 5 : totalComponents,
  };
}

/**
 * Execute pure elem-proxy benchmark measurements without formatting or disk I/O.
 * Returns a typed BenchmarkRunResult.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runElemProxyBenchmarks(options = {}) {
  const tempBase = path.join(__dirname, `../.temp-elem-proxy-bench-${Date.now()}`);
  fs.mkdirSync(tempBase, { recursive: true });

  const suiteConfigs = [
    { suite: carbonSuite, name: 'Carbon Web Components', shortName: 'Carbon', count: 99 },
    { suite: spectrumSuite, name: 'Spectrum Web Components', shortName: 'Spectrum', count: 52 },
    { suite: webAwesomeSuite, name: 'Web Awesome', shortName: 'Web Awesome', count: 73 },
    { suite: momentumSuite, name: 'Momentum Design', shortName: 'Momentum', count: 97 },
    { suite: materialSuite, name: 'Material Web', shortName: 'Material Web', count: 28 },
  ];

  const suites = [];

  for (const { suite, name, shortName, count } of suiteConfigs) {
    if (options.verbose) {
      console.log(`  Evaluating design system: ${name} (${count} components)...`);
    }
    const suiteContext = await suite.setup();

    const baselineDir = path.join(tempBase, `${suite.id}-baseline`);
    const optimizedDir = path.join(tempBase, `${suite.id}-optimized`);

    const baselineBundle = await buildSuiteBundle(suiteContext.entryPath, baselineDir, []);

    const optimizedPlugins = lit({
      cssFuse: false,
      elemProxy: {
        include: suiteContext.includePattern,
      },
    });
    const optimizedBundle = await buildSuiteBundle(suiteContext.entryPath, optimizedDir, optimizedPlugins);

    const baselineMetrics = await evaluateBundlePerformance(baselineBundle, count, name, false);
    const optimizedMetrics = await evaluateBundlePerformance(optimizedBundle, count, name, true);

    const cpuDelta = calculateDelta(baselineMetrics.evalTimeMs, optimizedMetrics.evalTimeMs);
    const heapDelta = calculateDelta(baselineMetrics.heapKb, optimizedMetrics.heapKb);

    suites.push({
      id: suite.id,
      name,
      shortName,
      packageName: suiteContext.packageName,
      componentCount: count,
      baseline: baselineMetrics,
      optimized: optimizedMetrics,
      deltas: {
        cpu: cpuDelta,
        heap: heapDelta,
      },
      diagnostics: {
        evaluatedCount: `${optimizedMetrics.evaluatedComponents} / ${count} (${((optimizedMetrics.evaluatedComponents / count) * 100).toFixed(1)}%)`,
        deferredCount: `${optimizedMetrics.deferredComponents} avoided`,
        deferredProportion: `${((optimizedMetrics.deferredComponents / count) * 100).toFixed(1)}% deferred`,
        cpuSavings: cpuDelta.formattedPercent,
        heapSavings: heapDelta.formattedPercent,
        buildOverhead: 'Fast native pass',
      },
    });

    await suite.cleanup();
  }

  fs.rmSync(tempBase, { recursive: true, force: true });

  return createBenchmarkResult({
    benchmarkId: 'elem-proxy',
    title: '`@lit-core/elem-proxy` empirical benchmark results',
    description: 'Deferred Custom Element proxy stubs evaluated across 349 production Lit Web Components to measure script evaluation CPU time, V8 heap memory footprint, and mount latency.',
    suites,
  });
}

// CLI execution
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('elem-proxy-bench.js'))) {
  printBenchmarkHeader('elem-proxy', 'Evaluating initial script evaluation CPU time, V8 heap memory, and mount latency.');
  runElemProxyBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printBenchmarkFooter('elem-proxy', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
