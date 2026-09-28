#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runSuiteBenchmark } from '../runner.js';
import { carbonSuite } from '../suites/carbon.js';
import { materialSuite } from '../suites/material.js';
import { momentumSuite } from '../suites/momentum.js';
import { spectrumSuite } from '../suites/spectrum.js';
import { webAwesomeSuite } from '../suites/webawesome.js';
import { syncAllBenchmarkDocs } from '../sync-docs.js';
import { renderCrossSuiteSummary } from '../table.js';
import { nativeTool } from '../tools/native.js';

export async function runNativeBenchmarkSuite(options = {}) {
  const suites = [carbonSuite, spectrumSuite, webAwesomeSuite, momentumSuite, materialSuite];

  console.log('⚡ Starting @lit-core/native multi-design-system benchmark suite across 349 components...\n');

  const allResults = [];
  const crossSuiteSummaries = [];

  for (const suite of suites) {
    console.log(`Running suite: ${suite.name} (${suite.id})...`);
    const rows = await runSuiteBenchmark(suite, [nativeTool], {
      verbose: options.verbose ?? false,
    });

    allResults.push({
      suiteId: suite.id,
      suiteName: suite.name,
      componentCount: rows.suiteContext.componentCount,
      rows,
      diagnostics: rows.diagnostics,
    });

    const baselineRow = rows.find((r) => r.isBaseline);
    const totalRow = rows.find((r) => r.isTotal);

    if (baselineRow && totalRow?.impact) {
      crossSuiteSummaries.push({
        suiteName: suite.name,
        packageName: rows.suiteContext.packageName || suite.packageName || suite.id,
        version: rows.suiteContext.version || 'unknown',
        componentCount: rows.suiteContext.componentCount,
        baselineRaw: baselineRow.metrics.rawBytes,
        baselineGzip: baselineRow.metrics.gzipBytes,
        totalRaw: totalRow.metrics.rawBytes,
        totalGzip: totalRow.metrics.gzipBytes,
        rawSaved: Math.abs(totalRow.impact.rawDiff),
        rawPct: Math.abs(totalRow.impact.rawPercent),
        gzipSaved: Math.abs(totalRow.impact.gzipDiff),
        gzipPct: Math.abs(totalRow.impact.gzipPercent),
        baselineBuildTimeMs: baselineRow.metrics.buildTimeMs,
        totalBuildTimeMs: totalRow.metrics.buildTimeMs,
      });
    }
  }

  console.log('\nBenchmark execution complete.');
  if (crossSuiteSummaries.length > 0) {
    console.log(renderCrossSuiteSummary(crossSuiteSummaries));
  }

  if (options.updateDocs !== false) {
    console.log('Synchronizing benchmark documentation...');
    syncAllBenchmarkDocs(allResults, { activeTools: [nativeTool] });
  }

  return allResults;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNativeBenchmarkSuite({ updateDocs: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
