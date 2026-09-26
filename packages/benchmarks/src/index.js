#!/usr/bin/env node
import { getSuites } from './suites/index.js';
import { getActiveTools } from './tools/index.js';
import { runSuiteBenchmark } from './runner.js';
import { renderAsciiTable, renderMarkdownTable, renderCrossSuiteSummary } from './table.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  suite: 'all',
  tools: null,
  format: 'ascii',
  verbose: false,
};

for (const arg of args) {
  if (arg.startsWith('--suite=')) {
    options.suite = arg.split('=')[1];
  } else if (arg.startsWith('--tools=')) {
    options.tools = arg.split('=')[1].split(',');
  } else if (arg.startsWith('--format=')) {
    options.format = arg.split('=')[1];
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`
Lit Core Bundler Benchmark Runner

Usage:
  node src/index.js [options]

Options:
  --suite=<name>     Suite to run: 'webawesome', 'lit-ds', or 'all' (default: all)
  --tools=<list>     Comma-separated tool ids to test (default: all active tools)
  --format=<type>    Output format: 'ascii' (default), 'markdown', or 'json'
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
    console.error(`❌ No benchmark suites matched '${options.suite}'. Available suites: webawesome, lit-ds`);
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
    console.log(`Suites to run: ${suites.map((s) => s.name).join(', ')}`);
    console.log(`Tools tested:  ${tools.map((t) => t.name).join(', ')}`);
  }

  const allResults = [];
  const crossSuiteSummaries = [];

  for (const suite of suites) {
    if (options.format !== 'json') {
      console.log(`\n⏳ Running benchmark for: ${suite.name}...`);
    }

    const rows = await runSuiteBenchmark(suite, tools, { verbose: options.verbose });
    allResults.push({
      suiteId: suite.id,
      suiteName: suite.name,
      componentCount: rows.suiteContext.componentCount,
      rows,
      diagnostics: rows.diagnostics,
    });

    const baselineRow = rows.find((r) => r.isBaseline);
    const totalRow = rows.find((r) => r.isTotal);

    if (baselineRow && totalRow && totalRow.impact) {
      crossSuiteSummaries.push({
        suiteName: suite.name,
        componentCount: rows.suiteContext.componentCount,
        baselineRaw: baselineRow.metrics.rawBytes,
        baselineGzip: baselineRow.metrics.gzipBytes,
        totalRaw: totalRow.metrics.rawBytes,
        totalGzip: totalRow.metrics.gzipBytes,
        rawSaved: Math.abs(totalRow.impact.rawDiff),
        rawPct: Math.abs(totalRow.impact.rawPercent),
        gzipSaved: Math.abs(totalRow.impact.gzipDiff),
        gzipPct: Math.abs(totalRow.impact.gzipPercent),
      });
    }

    if (options.format === 'ascii') {
      console.log(renderAsciiTable(`${suite.name} Bundle Size Impact`, rows));

      // Print diagnostics if available
      if (rows.diagnostics && Object.keys(rows.diagnostics).length > 0) {
        console.log(`\nDiagnostics:`);
        for (const [toolId, diag] of Object.entries(rows.diagnostics)) {
          if (diag.rulesScanned !== undefined) {
            console.log(`  [${toolId}] CSS Rules Scanned: ${diag.rulesScanned} | Deduped: ${diag.rulesDeduped} | Fused Sheets: ${diag.fusedSheetsCreated} | Chunks Rewritten: ${diag.componentsRewritten}`);
          }
        }
      }
    } else if (options.format === 'markdown') {
      console.log(renderMarkdownTable(`${suite.name} Bundle Size Impact`, rows));
    }
  }

  if (options.format === 'json') {
    console.log(JSON.stringify(allResults, null, 2));
    return;
  }

  // If multiple suites ran, print cross-suite summary
  if (crossSuiteSummaries.length > 1 && options.format === 'ascii') {
    // Add cumulative row
    const totalBaselineRaw = crossSuiteSummaries.reduce((acc, s) => acc + s.baselineRaw, 0);
    const totalBaselineGzip = crossSuiteSummaries.reduce((acc, s) => acc + s.baselineGzip, 0);
    const totalOptimizedRaw = crossSuiteSummaries.reduce((acc, s) => acc + s.totalRaw, 0);
    const totalOptimizedGzip = crossSuiteSummaries.reduce((acc, s) => acc + s.totalGzip, 0);
    const totalRawSaved = totalBaselineRaw - totalOptimizedRaw;
    const totalRawPct = totalBaselineRaw > 0 ? (totalRawSaved / totalBaselineRaw) * 100 : 0;
    const totalGzipSaved = totalBaselineGzip - totalOptimizedGzip;
    const totalGzipPct = totalBaselineGzip > 0 ? (totalGzipSaved / totalBaselineGzip) * 100 : 0;
    const totalComponents = crossSuiteSummaries.reduce((acc, s) => acc + s.componentCount, 0);

    crossSuiteSummaries.push({
      suiteName: 'OVERALL TOTAL',
      componentCount: totalComponents,
      baselineRaw: totalBaselineRaw,
      baselineGzip: totalBaselineGzip,
      totalRaw: totalOptimizedRaw,
      totalGzip: totalOptimizedGzip,
      rawSaved: totalRawSaved,
      rawPct: totalRawPct,
      gzipSaved: totalGzipSaved,
      gzipPct: totalGzipPct,
    });

    console.log(renderCrossSuiteSummary(crossSuiteSummaries));
  }

  console.log('\n✓ Benchmark run complete.\n');
}

main().catch((err) => {
  console.error('\n❌ Benchmark error:', err);
  process.exit(1);
});
