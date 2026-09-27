#!/usr/bin/env node
import { runSuiteBenchmark } from './runner.js';
import { getSuites } from './suites/index.js';
import { syncAllBenchmarkDocs } from './sync-docs.js';
import {
  renderAsciiRuntimeTable,
  renderAsciiTable,
  renderCrossSuiteSummary,
  renderMarkdownDiagnosticsTable,
  renderMarkdownOverviewTable,
  renderMarkdownPerToolAccordion,
  renderMarkdownRuntimeTable,
  renderMarkdownTable,
  renderMarkdownVersionsTable,
} from './table.js';
import { getActiveTools } from './tools/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  suite: 'all',
  /** @type {string[] | undefined} */
  tools: undefined,
  format: 'ascii',
  verbose: false,
  update: true,
};

for (const arg of args) {
  if (arg.startsWith('--suite=')) {
    options.suite = arg.split('=')[1];
  } else if (arg.startsWith('--tools=') || arg.startsWith('--tool=')) {
    options.tools = arg.split('=')[1].split(',');
  } else if (arg.startsWith('--format=')) {
    options.format = arg.split('=')[1];
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--no-update') {
    options.update = false;
  } else if (arg === '--update' || arg === '--sync') {
    options.update = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Lit Core Bundler Benchmark Runner

Usage:
  node src/index.js [options]

Options:
  --suite=<name>     Suite to run: 'webawesome', 'material', 'carbon', 'spectrum', 'momentum', or 'all' (default: all)
  --tools=<list>     Comma-separated tool ids to test (default: all active tools)
  --format=<type>    Output format: 'ascii' (default), 'markdown', or 'json'
  --no-update        Skip automatic synchronization of markdown tables on disk
  --update, --sync   Force automatic synchronization of markdown tables on disk (enabled by default)
  --verbose, -v      Show verbose build progress
  --help, -h         Display this help message
`);
    process.exit(0);
  }
}

async function main() {
  const suites = getSuites(options.suite);
  const tools = getActiveTools(options.tools);

  if (suites.length === 0) {
    console.error(`❌ No benchmark suites matched '${options.suite}'. Available: webawesome, material, carbon, spectrum, momentum`);
    process.exit(1);
  }

  if (tools.length === 0) {
    console.error('❌ No benchmark tools are enabled.');
    process.exit(1);
  }

  if (options.format !== 'json') {
    console.log(`\n========================================================================================`);
    console.log(`⚡ LIT-CORE BUNDLE OPTIMIZATION BENCHMARK SUITE`);
    console.log(`========================================================================================`);
    console.log(`Libraries: ${suites.map((s) => s.name).join(', ')}`);
    console.log(`Configs:   ${tools.map((t) => t.name).join(', ')}`);
  }

  const allResults = [];
  const crossSuiteSummaries = [];

  for (const suite of suites) {
    if (options.format !== 'json') {
      console.log(`\n⏳ Running benchmark for: ${suite.name}...`);
    }

    const rows = await runSuiteBenchmark(suite, tools, {
      verbose: options.verbose,
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

    if (options.format === 'ascii') {
      console.log(renderAsciiTable(`${suite.name} static bundle size analysis`, rows));

      if (rows.runtimeRows && rows.runtimeRows.length > 0) {
        console.log(renderAsciiRuntimeTable(`${suite.name} runtime performance`, rows.runtimeRows));
      }

      if (options.verbose && rows.diagnostics && Object.keys(rows.diagnostics).length > 0) {
        console.log(`\nDiagnostics:`);
        for (const [toolId, diag] of Object.entries(rows.diagnostics)) {
          if (diag.rulesScanned !== undefined) {
            console.log(
              `  [${toolId}] CSS Rules Scanned: ${diag.rulesScanned} | Deduped: ${diag.rulesDeduped} | Fused Sheets: ${diag.fusedSheetsCreated} | Chunks Rewritten: ${diag.componentsRewritten}`,
            );
          }
          if (diag.fragmentsScanned !== undefined) {
            console.log(
              `  [${toolId}] Fragments Scanned: ${diag.fragmentsScanned} | Deduped: ${diag.fragmentsDeduped} | Shared Templates: ${diag.fusedTemplatesCreated} | Components Rewritten: ${diag.componentsRewritten}`,
            );
          }
        }
      }
    }
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  // Calculate cumulative summary row across all libraries
  if (crossSuiteSummaries.length > 0) {
    const totalBaselineRaw = crossSuiteSummaries.reduce((acc, s) => acc + s.baselineRaw, 0);
    const totalBaselineGzip = crossSuiteSummaries.reduce((acc, s) => acc + s.baselineGzip, 0);
    const totalOptimizedRaw = crossSuiteSummaries.reduce((acc, s) => acc + s.totalRaw, 0);
    const totalOptimizedGzip = crossSuiteSummaries.reduce((acc, s) => acc + s.totalGzip, 0);
    const totalRawSaved = totalBaselineRaw - totalOptimizedRaw;
    const totalRawPct = totalBaselineRaw > 0 ? (totalRawSaved / totalBaselineRaw) * 100 : 0;
    const totalGzipSaved = totalBaselineGzip - totalOptimizedGzip;
    const totalGzipPct = totalBaselineGzip > 0 ? (totalGzipSaved / totalBaselineGzip) * 100 : 0;
    const totalComponents = crossSuiteSummaries.reduce((acc, s) => acc + s.componentCount, 0);
    const totalBaselineBuildTime = crossSuiteSummaries.reduce((acc, s) => acc + (s.baselineBuildTimeMs || 0), 0);
    const totalOptimizedBuildTime = crossSuiteSummaries.reduce((acc, s) => acc + (s.totalBuildTimeMs || 0), 0);

    crossSuiteSummaries.push({
      suiteName: 'OVERALL TOTAL (All Libraries)',
      packageName: 'all',
      version: 'n/a',
      componentCount: totalComponents,
      baselineRaw: totalBaselineRaw,
      baselineGzip: totalBaselineGzip,
      totalRaw: totalOptimizedRaw,
      totalGzip: totalOptimizedGzip,
      rawSaved: totalRawSaved,
      rawPct: totalRawPct,
      gzipSaved: totalGzipSaved,
      gzipPct: totalGzipPct,
      baselineBuildTimeMs: totalBaselineBuildTime,
      totalBuildTimeMs: totalOptimizedBuildTime,
    });
  }

  if (options.format === 'markdown') {
    const coreVersions = {
      lit: '3.3.3',
      vite: '8.3.1',
      playwright: '1.63.0',
      node: process.version,
    };
    const suitesForVersionTable = crossSuiteSummaries.filter((s) => !s.suiteName.includes('OVERALL TOTAL'));
    if (suitesForVersionTable.length > 0) {
      console.log(`\n${renderMarkdownVersionsTable(suitesForVersionTable, coreVersions)}`);
    }

    if (crossSuiteSummaries.length > 1) {
      console.log(`\n${renderMarkdownOverviewTable(crossSuiteSummaries)}`);
      console.log(renderMarkdownPerToolAccordion(allResults));
    } else {
      const res = allResults[0];
      console.log(`\n${renderMarkdownTable(res.suiteName, res.rows)}`);
    }

    const diagTable = renderMarkdownDiagnosticsTable(allResults);
    if (diagTable) {
      console.log(diagTable);
    }

    // Additional table at bottom of benchmarks: runtime performance
    const lastResult = allResults[allResults.length - 1];
    if (lastResult?.rows?.runtimeRows && lastResult.rows.runtimeRows.length > 0) {
      console.log(renderMarkdownRuntimeTable(lastResult.rows.runtimeRows));
    }
  } else if (crossSuiteSummaries.length > 1 && options.format === 'ascii') {
    console.log(renderCrossSuiteSummary(crossSuiteSummaries));
  }

  if (options.update) {
    syncAllBenchmarkDocs(allResults, { verbose: options.verbose, activeTools: tools });
  }

  console.log('\n✓ Benchmark run complete.\n');
}

main().catch((err) => {
  console.error('\n❌ Benchmark error:', err);
  process.exit(1);
});
