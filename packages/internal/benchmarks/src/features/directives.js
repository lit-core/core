#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { getScenario, runScenarioBenchmark } from '../scenarios/index.js';
import { createBenchmarkResult } from '../schema.js';
import { carbonSuite, materialSuite, momentumSuite, spectrumSuite, webAwesomeSuite } from '../suites/index.js';

/**
 * Execute pure directives benchmark measurements across production suites via authentic dynamic-feed scenario.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runDirectivesBenchmarks(options = {}) {
  const suitesList = [carbonSuite, spectrumSuite, webAwesomeSuite, momentumSuite, materialSuite];
  const scenario = getScenario('dynamic-feed');
  const suites = [];

  for (const suite of suitesList) {
    if (options.verbose) {
      console.log(`  Evaluating design system: ${suite.name}...`);
    }

    const result = await runScenarioBenchmark({
      scenario,
      suite,
      variantId: 'directives',
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
    benchmarkId: 'directives',
    title: '`@lit-core/directives` empirical benchmark results',
    description: 'Ahead-of-time Lit built-in directive compiler evaluated across 255 production Web Components to eliminate runtime directive object allocations and prune dead imports.',
    suites,
  });
}

// CLI execution
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('directives-bench.js'))) {
  printBenchmarkHeader('directives', 'Evaluating ahead-of-time Lit directive lowering across real production components.');
  runDirectivesBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printBenchmarkFooter('directives', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
