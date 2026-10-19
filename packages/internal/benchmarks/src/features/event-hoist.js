#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { getScenario, runScenarioBenchmark } from '../scenarios/index.js';
import { createBenchmarkResult } from '../schema.js';
import { carbonSuite, materialSuite, momentumSuite, spectrumSuite, webAwesomeSuite } from '../suites/index.js';

/**
 * Execute pure event-hoist benchmark measurements across production suites via authentic interactive-form scenario.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runEventHoistBenchmarks(options = {}) {
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
      variantId: 'event-hoist',
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
    benchmarkId: 'event-hoist',
    title: '`@lit-core/event-hoist` empirical benchmark results',
    description: 'Ahead-of-time ShadowRoot event delegation evaluated across 255 production Web Components to eliminate per-element DOM event listener allocations.',
    suites,
  });
}

// CLI execution
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('event-hoist-bench.js'))) {
  printBenchmarkHeader('event-hoist', 'Evaluating native DOM event listener allocations across real production components.');
  runEventHoistBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printBenchmarkFooter('event-hoist', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
