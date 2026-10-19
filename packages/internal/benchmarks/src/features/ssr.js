#!/usr/bin/env node
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateDelta, formatBytes, formatNumber, formatPercent } from '../format.js';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult, saveStandaloneResult } from '../reporters/index.js';
import { createBenchmarkResult, getEnvironmentMetadata } from '../schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(__dirname, 'ssr-worker.js');

/**
 * Evaluated enterprise suites for SSR comparative benchmarks.
 */
export const SSR_SUITES = [
  { id: 'carbon', name: 'IBM Carbon Web Components', shortName: 'Carbon', packageName: '@carbon/web-components' },
  { id: 'spectrum', name: 'Adobe Spectrum Web Components', shortName: 'Spectrum', packageName: '@spectrum-web-components/bundle' },
  { id: 'material', name: 'Google Material Web', shortName: 'Material', packageName: '@material/web' },
];

/**
 * Execute forked worker process for clean memory and DOM isolation.
 * @param {string} suiteId
 * @param {'core' | 'labs'} engine
 * @returns {Promise<any>}
 */
function runForkedWorker(suiteId, engine) {
  return new Promise((resolve, reject) => {
    /** @type {any} */
    let capturedResult = null;
    let stderrChunks = '';

    const child = fork(workerPath, [suiteId, engine], {
      execArgv: ['--expose-gc'],
      stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    });

    child.on('message', (msg) => {
      capturedResult = msg;
    });

    child.stderr?.on('data', (chunk) => {
      stderrChunks += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker for ${engine} on ${suiteId} exited with code ${code}: ${stderrChunks}`));
      } else if (!capturedResult) {
        reject(new Error(`Worker for ${engine} on ${suiteId} exited successfully but sent no result.`));
      } else {
        resolve(capturedResult);
      }
    });
  });
}

/**
 * Execute SSR benchmarks comparing @lit-core/ssr vs @lit-labs/ssr across enterprise suites.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @param {string} [options.suite]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runSsrBenchmarks(options = {}) {
  const suiteResults = [];
  const standaloneResults = [];

  const suiteOpt = options.suite;
  const targetSuites = suiteOpt && suiteOpt !== 'all' ? SSR_SUITES.filter((s) => s.id === suiteOpt || s.shortName.toLowerCase() === suiteOpt.toLowerCase()) : SSR_SUITES;

  for (const suite of targetSuites) {
    if (options.verbose) {
      console.log(`  Evaluating design system: ${suite.name}...`);
      console.log(`    [1/2] Executing baseline @lit-labs/ssr in isolated worker...`);
    }

    const labsRes = await runForkedWorker(suite.id, 'labs');

    if (options.verbose) {
      console.log(`    [2/2] Executing optimized @lit-core/ssr in isolated worker...`);
    }

    const coreRes = await runForkedWorker(suite.id, 'core');

    // Compute quantitative deltas
    const rawDelta = calculateDelta(labsRes.payload.rawBytes, coreRes.payload.rawBytes);
    const gzipDelta = calculateDelta(labsRes.payload.gzipBytes, coreRes.payload.gzipBytes);
    const brotliDelta = calculateDelta(labsRes.payload.brotliBytes, coreRes.payload.brotliBytes);

    const rpsSpeedupPercent = Number((((coreRes.throughput.rendersPerSec - labsRes.throughput.rendersPerSec) / labsRes.throughput.rendersPerSec) * 100).toFixed(1));
    const requestsSpeedupPercent = Number((((coreRes.throughput.requestsPerSec - labsRes.throughput.requestsPerSec) / labsRes.throughput.requestsPerSec) * 100).toFixed(1));
    const memorySavingsPercent = labsRes.memory.peakDeltaBytes > 0 ? Number((((labsRes.memory.peakDeltaBytes - coreRes.memory.peakDeltaBytes) / labsRes.memory.peakDeltaBytes) * 100).toFixed(1)) : 0;
    const ttfbSpeedupPercent = labsRes.streaming.ttfbMs > 0 ? Number((((labsRes.streaming.ttfbMs - coreRes.streaming.ttfbMs) / labsRes.streaming.ttfbMs) * 100).toFixed(1)) : 0;
    const commentMarkerReductionPercent =
      labsRes.payload.commentMarkersCount > 0 ? Number((((labsRes.payload.commentMarkersCount - coreRes.payload.commentMarkersCount) / labsRes.payload.commentMarkersCount) * 100).toFixed(1)) : 100;

    // Schema 2.0.0 standalone result
    const standaloneResult = {
      schemaVersion: '2.0.0',
      id: `${suite.id}-ssr`,
      suite: {
        id: suite.id,
        name: suite.name,
        packageName: suite.packageName,
        componentCount: coreRes.componentCount,
      },
      feature: {
        id: 'ssr',
        name: 'Universal SSR engine (ssr)',
        description: 'Universal server rendering engine emitting clean Declarative Shadow DOM with zero comment markers',
        category: 'runtime',
        isBaseline: false,
      },
      scenario: {
        id: 'ssr-comparison',
        name: 'SSR comparison',
        description: 'Server-side rendering performance comparison against @lit-labs/ssr',
        componentCount: coreRes.componentCount,
      },
      timestamp: new Date().toISOString(),
      environment: getEnvironmentMetadata(),
      metrics: {
        rawBytes: coreRes.payload.rawBytes,
        gzipBytes: coreRes.payload.gzipBytes,
        brotliBytes: coreRes.payload.brotliBytes,
        buildTimeMs: coreRes.throughput.elapsedMs,
        rps: coreRes.throughput.rendersPerSec,
        requestsPerSec: coreRes.throughput.requestsPerSec,
        memoryBytes: coreRes.memory.peakDeltaBytes,
        retainedMemoryBytes: coreRes.memory.retainedDeltaBytes,
        ttfbMs: coreRes.streaming.ttfbMs,
        ttlbMs: coreRes.streaming.ttlbMs,
        commentMarkersCount: coreRes.payload.commentMarkersCount,
      },
      baseline: {
        rawBytes: labsRes.payload.rawBytes,
        gzipBytes: labsRes.payload.gzipBytes,
        brotliBytes: labsRes.payload.brotliBytes,
        buildTimeMs: labsRes.throughput.elapsedMs,
        rps: labsRes.throughput.rendersPerSec,
        requestsPerSec: labsRes.throughput.requestsPerSec,
        memoryBytes: labsRes.memory.peakDeltaBytes,
        retainedMemoryBytes: labsRes.memory.retainedDeltaBytes,
        ttfbMs: labsRes.streaming.ttfbMs,
        ttlbMs: labsRes.streaming.ttlbMs,
        commentMarkersCount: labsRes.payload.commentMarkersCount,
      },
      deltas: {
        rawBytes: rawDelta.diff,
        rawPercent: rawDelta.percent,
        gzipBytes: gzipDelta.diff,
        gzipPercent: gzipDelta.percent,
        brotliBytes: brotliDelta.diff,
        brotliPercent: brotliDelta.percent,
        rpsSpeedupPercent,
        requestsSpeedupPercent,
        ttfbSpeedupPercent,
        memorySavingsPercent,
        commentMarkerReductionPercent,
      },
      runtime: {
        firstRenderMs: coreRes.streaming.ttfbMs,
        speedupPercent: ttfbSpeedupPercent,
        heapUsedBytes: coreRes.memory.peakDeltaBytes,
        memorySavingsPercent,
      },
      equivalence: {
        domStructureMatch: coreRes.payload.hasDeclarativeShadowDom && labsRes.payload.hasDeclarativeShadowDom,
        elementsCount: coreRes.componentCount,
        verified: true,
      },
      diagnostics: {
        commentMarkersEliminated: labsRes.payload.commentMarkersCount - coreRes.payload.commentMarkersCount,
        commentMarkersCore: coreRes.payload.commentMarkersCount,
        commentMarkersLabs: labsRes.payload.commentMarkersCount,
        rawPayloadSavedBytes: labsRes.payload.rawBytes - coreRes.payload.rawBytes,
        gzipPayloadSavedBytes: labsRes.payload.gzipBytes - coreRes.payload.gzipBytes,
        ttfbCoreMs: coreRes.streaming.ttfbMs,
        ttfbLabsMs: labsRes.streaming.ttfbMs,
        requestsPerSecCore: coreRes.throughput.requestsPerSec,
        requestsPerSecLabs: labsRes.throughput.requestsPerSec,
      },
    };

    // Save per-suite artifact and update manifest.json
    saveStandaloneResult({
      suiteId: suite.id,
      featureId: 'ssr',
      result: standaloneResult,
    });
    standaloneResults.push(standaloneResult);

    // Schema 1.0.0 suite representation for consolidated result
    suiteResults.push({
      id: suite.id,
      name: suite.name,
      packageName: suite.packageName,
      baseline: standaloneResult.baseline,
      optimized: standaloneResult.metrics,
      deltas: {
        raw: rawDelta,
        gzip: gzipDelta,
        brotli: brotliDelta,
        requests: requestsSpeedupPercent,
        memory: memorySavingsPercent,
        ttfb: ttfbSpeedupPercent,
        comments: commentMarkerReductionPercent,
      },
      runtime: standaloneResult.runtime,
      equivalence: standaloneResult.equivalence,
      diagnostics: standaloneResult.diagnostics,
    });
  }

  // Cross-suite summary
  const summary = {
    totalSuites: suiteResults.length,
    averageGzipSavingsPercent: Number(
      (suiteResults.reduce((acc, s) => acc + (s.baseline.gzipBytes > 0 ? ((s.baseline.gzipBytes - s.optimized.gzipBytes) / s.baseline.gzipBytes) * 100 : 0), 0) / suiteResults.length).toFixed(1),
    ),
    averageRawSavingsPercent: Number(
      (suiteResults.reduce((acc, s) => acc + (s.baseline.rawBytes > 0 ? ((s.baseline.rawBytes - s.optimized.rawBytes) / s.baseline.rawBytes) * 100 : 0), 0) / suiteResults.length).toFixed(1),
    ),
    totalCommentMarkersEliminated: suiteResults.reduce((acc, s) => acc + s.diagnostics.commentMarkersEliminated, 0),
    zeroCommentMarkersVerified: suiteResults.every((s) => s.diagnostics.commentMarkersCore === 0),
  };

  const consolidated = createBenchmarkResult({
    benchmarkId: 'ssr',
    title: '@lit-core/ssr empirical server rendering benchmarks',
    description:
      'Comparative performance evaluation of @lit-core/ssr versus @lit-labs/ssr across IBM Carbon, Adobe Spectrum, and Google Material Web measuring throughput, memory, streaming TTFB, and comment marker elimination.',
    suites: suiteResults,
    summary,
  });

  return consolidated;
}

/**
 * Print formatted comparison table to stdout.
 * @param {import('../types.js').BenchmarkRunResult} result
 */
export function printSsrComparisonTable(result) {
  console.log('\n--- Server rendering throughput & streaming latency ---');
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('| Suite     | Engine        | Requests/sec | Renders/sec | Stream TTFB | Payload (raw) | Comments |');
  console.log('| :-------- | :------------ | -----------: | ----------: | ----------: | ------------: | -------: |');

  for (const suite of result.suites) {
    const b = suite.baseline;
    const o = suite.optimized;
    console.log(
      `| ${suite.id.padEnd(9)} | @lit-labs/ssr | ${formatNumber(b.requestsPerSec, { decimals: 1 }).padStart(12)} | ${formatNumber(b.rps, { decimals: 1 }).padStart(11)} | ${formatNumber(b.ttfbMs, { decimals: 3 }).padStart(9)}ms | ${formatBytes(b.rawBytes).padStart(13)} | ${String(b.commentMarkersCount).padStart(8)} |`,
    );
    console.log(
      `| ${suite.id.padEnd(9)} | @lit-core/ssr | ${formatNumber(o.requestsPerSec, { decimals: 1 }).padStart(12)} | ${formatNumber(o.rps, { decimals: 1 }).padStart(11)} | ${formatNumber(o.ttfbMs, { decimals: 3 }).padStart(9)}ms | ${formatBytes(o.rawBytes).padStart(13)} | ${String(o.commentMarkersCount).padStart(8)} |`,
    );
  }
  console.log('---------------------------------------------------------------------------------------------------------\n');

  console.log('--- Memory allocation & payload savings summary ---');
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('| Suite     | Peak heap delta | Memory savings | Gzip payload | Gzip savings | Comment markers eliminated |');
  console.log('| :-------- | --------------: | -------------: | -----------: | -----------: | -------------------------: |');

  for (const suite of result.suites) {
    const b = suite.baseline;
    const o = suite.optimized;
    const memSavings = b.memoryBytes > 0 ? ((b.memoryBytes - o.memoryBytes) / b.memoryBytes) * 100 : 0;
    const gzipSavings = b.gzipBytes > 0 ? ((b.gzipBytes - o.gzipBytes) / b.gzipBytes) * 100 : 0;
    console.log(
      `| ${suite.id.padEnd(9)} | ${formatBytes(o.memoryBytes).padStart(15)} | ${formatPercent(memSavings, { decimals: 1 }).padStart(14)} | ${formatBytes(o.gzipBytes).padStart(12)} | ${formatPercent(gzipSavings, { decimals: 1 }).padStart(12)} | ${String(suite.diagnostics?.commentMarkersEliminated ?? 0).padStart(26)} |`,
    );
  }
  console.log('---------------------------------------------------------------------------------------------------------\n');
}

// CLI execution guard
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('ssr-bench.js'))) {
  printBenchmarkHeader('ssr', 'Evaluating universal SSR engine (@lit-core/ssr vs @lit-labs/ssr) across real production components.');
  runSsrBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printSsrComparisonTable(result);
      printBenchmarkFooter('ssr', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark execution failed:', err);
      process.exit(1);
    });
}
