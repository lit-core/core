#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { getScenario, runScenarioBenchmark } from '../scenarios/index.js';
import { createBenchmarkResult } from '../schema.js';
import { carbonSuite, materialSuite, momentumSuite, spectrumSuite, webAwesomeSuite } from '../suites/index.js';

/**
 * Execute pure elem-proxy benchmark measurements across production suites via authentic interactive-form scenario.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runElemProxyBenchmarks(options = {}) {
  const suitesList = [carbonSuite, spectrumSuite, webAwesomeSuite, momentumSuite, materialSuite];
  const scenario = getScenario('interactive-form');
  const suites = [];

  for (const suite of suitesList) {
    if (options.verbose) {
      console.log(`  Evaluating design system: ${suite.name}...`);
    }

    const result = await runScenarioBenchmark({
      scenario,
      suite,
      variantId: 'elem-proxy',
      options,
    });

    suites.push({
      id: suite.id,
      name: suite.name,
      packageName: suite.packageName,
      baseline: result.baseline,
      optimized: result.metrics,
      deltas: result.deltas,
      runtime: result.runtime,
      equivalence: result.equivalence,
      diagnostics: {
        scenario: scenario.name,
        speedupPercent: result.deltas.speedupPercent,
        updateSpeedupPercent: result.deltas.updateSpeedupPercent,
        buildOverhead: 'Fast native pass',
      },
    });
  }

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
