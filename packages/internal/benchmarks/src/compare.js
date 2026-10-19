#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { formatNumber, formatPercent } from './format.js';

/**
 * Parse CLI arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baseline: '',
    candidate: '',
    threshold: 5, // 5% regression threshold
  };

  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--baseline=')) {
      options.baseline = arg.split('=')[1];
    } else if (arg.startsWith('--candidate=')) {
      options.candidate = arg.split('=')[1];
    } else if (arg.startsWith('--threshold=')) {
      options.threshold = Number.parseFloat(arg.split('=')[1]) || 5;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (!options.baseline && positional[0]) {
    options.baseline = positional[0];
  }
  if (!options.candidate && positional[1]) {
    options.candidate = positional[1];
  }

  return options;
}

/**
 * Load and validate a JSON benchmark artifact.
 * @param {string} filePath
 * @returns {any}
 */
function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Benchmark result file not found: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Failed to parse JSON from ${filePath}:`, msg);
    process.exit(1);
  }
}

/**
 * Compare two benchmark result artifacts for regressions.
 * @param {any} baseline
 * @param {any} candidate
 * @param {number} thresholdPct
 * @returns {{ regressions: any[], passed: boolean, comparisonRows: any[] }}
 */
export function compareBenchmarkResults(baseline, candidate, thresholdPct = 5) {
  const regressions = [];
  const comparisonRows = [];

  const baselineSuites = new Map((baseline.suites || []).map((/** @type {any} */ s) => [s.id, s]));

  for (const candSuite of candidate.suites || []) {
    const baseSuite = baselineSuites.get(candSuite.id);
    if (!baseSuite) continue;

    // Compare optimized metrics
    const baseMetrics = baseSuite.optimized || {};
    const candMetrics = candSuite.optimized || {};

    for (const [metricKey, candVal] of Object.entries(candMetrics)) {
      if (typeof candVal !== 'number') continue;
      const baseVal = baseMetrics[metricKey];
      if (typeof baseVal !== 'number') continue;

      const diff = candVal - baseVal;
      const pct = baseVal !== 0 ? (diff / baseVal) * 100 : 0;

      // Higher is worse for latency, bytes, evaluations, diffs, memory
      const isRegression = pct > thresholdPct;
      if (isRegression) {
        regressions.push({
          suiteId: candSuite.id,
          suiteName: candSuite.name,
          metric: metricKey,
          baseline: baseVal,
          candidate: candVal,
          diff,
          percent: pct,
        });
      }

      comparisonRows.push({
        Suite: candSuite.name,
        Metric: metricKey,
        Baseline: formatNumber(baseVal, { decimals: 2 }),
        Candidate: formatNumber(candVal, { decimals: 2 }),
        Delta: formatPercent(pct, { decimals: 1, showSign: true }),
        Status: isRegression ? '❌ REGRESSION' : pct < -1 ? '✓ FASTER' : '✓ OK',
      });
    }
  }

  return {
    regressions,
    passed: regressions.length === 0,
    comparisonRows,
  };
}

async function main() {
  const options = parseArgs();

  if (!options.baseline || !options.candidate) {
    console.log(`
Lit Core Benchmark Regression Comparator

Usage:
  node packages/benchmarks/src/compare.js <baseline.json> <candidate.json> [options]
  node packages/benchmarks/src/compare.js --baseline=<path> --candidate=<path> [--threshold=<pct>]

Options:
  --baseline=<path>    Path to baseline results.json
  --candidate=<path>   Path to candidate/PR results.json
  --threshold=<pct>    Maximum allowed regression percentage before failing (default: 5%)
`);
    process.exit(1);
  }

  const baselineData = loadJson(path.resolve(options.baseline));
  const candidateData = loadJson(path.resolve(options.candidate));

  console.log('\n========================================================================================');
  console.log('🔍 BENCHMARK REGRESSION COMPARISON');
  console.log('========================================================================================');
  console.log(`Baseline:  ${options.baseline} (${baselineData.benchmarkId || 'unnamed'} @ ${baselineData.timestamp || 'unknown'})`);
  console.log(`Candidate: ${options.candidate} (${candidateData.benchmarkId || 'unnamed'} @ ${candidateData.timestamp || 'unknown'})`);
  console.log(`Threshold: ${options.threshold}% maximum allowable regression\n`);

  const { regressions, passed, comparisonRows } = compareBenchmarkResults(baselineData, candidateData, options.threshold);

  console.table(comparisonRows);

  if (!passed) {
    console.error(`\n❌ REGRESSION DETECTED: ${regressions.length} metric(s) exceeded the ${options.threshold}% threshold:\n`);
    for (const reg of regressions) {
      console.error(`  • [${reg.suiteName}] ${reg.metric}: ${reg.baseline} → ${reg.candidate} (${formatPercent(reg.percent, { showSign: true })})`);
    }
    console.error('\nFailing CI check due to benchmark regression.\n');
    process.exit(1);
  } else {
    console.log(`\n✓ All benchmark metrics within allowable threshold (${options.threshold}%). Zero regressions detected.\n`);
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith('compare.js')) {
  main();
}
