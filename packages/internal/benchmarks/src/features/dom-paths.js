#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { getScenario, runScenarioBenchmark } from '../scenarios/index.js';
import { createBenchmarkResult } from '../schema.js';
import { carbonSuite, materialSuite, momentumSuite, spectrumSuite, webAwesomeSuite } from '../suites/index.js';

/**
 * Execute pure dom-paths benchmark measurements across production suites via authentic data-grid scenario.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runDomPathsBenchmarks(options = {}) {
  const suitesList = [carbonSuite, spectrumSuite, webAwesomeSuite, momentumSuite, materialSuite];
  const scenario = getScenario('data-grid');
  const suites = [];

  for (const suite of suitesList) {
    if (options.verbose) {
      console.log(`  Evaluating design system: ${suite.name}...`);
    }

    const result = await runScenarioBenchmark({
      scenario,
      suite,
      variantId: 'dom-paths',
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
    benchmarkId: 'dom-paths',
    title: '`@lit-core/dom-paths` empirical benchmark results',
    description: 'Ahead-of-time structural DOM child pointer path compilation evaluated across 255 production Web Components to eliminate runtime TreeWalker traversal during component mount.',
    suites,
  });
}

// CLI execution
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('dom-paths-bench.js'))) {
  printBenchmarkHeader('dom-paths', 'Evaluating runtime TreeWalker elimination vs direct child pointer indexing.');
  runDomPathsBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printBenchmarkFooter('dom-paths', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
