import { runStandaloneBenchmark, runSuiteBenchmark } from './runner.js';
import { getScenario, runScenarioBenchmark, SCENARIOS } from './scenarios/index.js';
import { getSuites } from './suites/index.js';
import { renderAsciiRuntimeTable, renderAsciiScenarioTable, renderAsciiTable, renderCrossSuiteSummary } from './table.js';
import { getActiveTools, registeredTools } from './tools/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  suite: 'all',
  /** @type {string[] | undefined} */
  tools: undefined,
  /** @type {string | undefined} */
  scenario: undefined,
  scenarios: false,
  /** @type {string | undefined} */
  variant: undefined,
  format: 'ascii',
  verbose: false,
};

for (const arg of args) {
  if (arg.startsWith('--suite=')) {
    options.suite = arg.split('=')[1];
  } else if (arg.startsWith('--tools=') || arg.startsWith('--tool=')) {
    options.tools = arg.split('=')[1].split(',');
  } else if (arg.startsWith('--scenario=')) {
    options.scenario = arg.split('=')[1];
  } else if (arg === '--scenarios') {
    options.scenarios = true;
  } else if (arg.startsWith('--variant=')) {
    options.variant = arg.split('=')[1];
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
  --suite=<name>       Suite to run: 'carbon', 'spectrum', 'webawesome', 'material', 'momentum', or 'all' (default: all)
  --tool=<id>          Single tool to test under its authentic scenario: 'baseline', 'css-fuse', 'dom-paths', etc.
  --tools=<list>       Comma-separated tool ids to test
  --scenario=<name>    Scenario to run: 'data-grid', 'interactive-form', 'ssr-dashboard', 'dynamic-feed', 'selective-app', 'bundle'
  --scenarios          Execute all 6 authentic scenarios across suites
  --variant=<id>       Specific variant within scenario (default: baseline + all scenario features)
  --format=<type>      Output format: 'ascii' (default) or 'json'
  --verbose, -v        Show verbose build progress
  --help, -h           Display this help message
`);
    process.exit(0);
  }
}

async function main() {
  const suites = getSuites(options.suite);

  if (suites.length === 0) {
    console.error(`❌ No benchmark suites matched '${options.suite}'. Available: carbon, spectrum, webawesome, material, momentum`);
    process.exit(1);
  }

  // Handle scenario benchmark execution
  if (options.scenarios || options.scenario) {
    const targetScenarios = options.scenarios ? SCENARIOS : [getScenario(options.scenario || 'bundle')];

    if (options.format !== 'json') {
      console.log(`\n========================================================================================`);
      console.log(`⚡ LIT-CORE SCENARIO BENCHMARKS: ${options.scenarios ? 'ALL SCENARIOS' : targetScenarios[0].name.toUpperCase()}`);
      console.log(`========================================================================================`);
      console.log(`Suites:    ${suites.map((s) => s.name).join(', ')}`);
      console.log(`Scenarios: ${targetScenarios.map((s) => s.name).join(', ')}`);
    }

    const allScenarioResults = [];
    for (const scenario of targetScenarios) {
      for (const suite of suites) {
        const variants = options.variant ? [options.variant] : ['baseline', ...scenario.relevantFeatures];

        const scenarioResults = [];
        for (const variantId of variants) {
          if (options.format !== 'json' && options.verbose) {
            console.log(`\n⏳ Running scenario '${scenario.name}' [${variantId}] for: ${suite.name}...`);
          }
          const res = await runScenarioBenchmark({
            scenario,
            suite,
            variantId,
            options: { verbose: options.verbose },
          });
          scenarioResults.push(res);
          allScenarioResults.push(res);
        }

        if (options.format === 'ascii') {
          console.log(renderAsciiScenarioTable(scenario, scenarioResults));
        }
      }
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(allScenarioResults, null, 2));
    }
    return;
  }

  // Handle single tool standalone run if specified as 'baseline', 'all', or a single tool id
  if (options.tools && options.tools.length === 1) {
    const singleToolId = options.tools[0];
    const isSingleBaseline = singleToolId === 'baseline';
    const isSingleAll = singleToolId === 'all';
    /** @type {import('./types.js').BenchmarkTool | 'baseline' | 'all' | undefined} */
    const toolObj = isSingleBaseline ? 'baseline' : isSingleAll ? 'all' : registeredTools.find((t) => t.id === singleToolId);

    if (!toolObj) {
      console.error(`❌ Tool '${singleToolId}' is not recognized. Available tools: baseline, ${registeredTools.map((t) => t.id).join(', ')}, all`);
      process.exit(1);
    }

    if (options.format !== 'json') {
      console.log(`\n========================================================================================`);
      console.log(`⚡ LIT-CORE STANDALONE BENCHMARK: ${singleToolId.toUpperCase()}`);
      console.log(`========================================================================================`);
      console.log(`Suites: ${suites.map((s) => s.name).join(', ')}`);
    }

    const standaloneResults = [];
    for (const suite of suites) {
      if (options.format !== 'json') {
        console.log(`\n⏳ Running standalone benchmark for: ${suite.name} [${singleToolId}]...`);
      }
      const res = await runStandaloneBenchmark({
        suite,
        tool: toolObj,
        options: { verbose: options.verbose },
        allTools: registeredTools,
      });
      standaloneResults.push(res);

      if (options.format === 'ascii') {
        console.log(`✓ Result saved to results/${suite.id}/${singleToolId}.json`);
        console.log(`  Raw size:    ${(res.metrics.rawBytes / 1024).toFixed(2)} KB`);
        console.log(`  Gzip size:   ${(res.metrics.gzipBytes / 1024).toFixed(2)} KB`);
        console.log(`  Brotli size: ${(res.metrics.brotliBytes / 1024).toFixed(2)} KB`);
        console.log(`  Build time:  ${res.metrics.buildTimeMs.toFixed(1)} ms`);
        if (res.deltas) {
          console.log(`  Savings:     ${res.deltas.gzipPercent.toFixed(2)}% gzip (${(res.deltas.gzipBytes / 1024).toFixed(2)} KB)`);
        }
      }
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(standaloneResults, null, 2));
    }
    return;
  }

  const tools = getActiveTools(options.tools);
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

  const crossSuiteSummaries = [];

  for (const suite of suites) {
    if (options.format !== 'json') {
      console.log(`\n⏳ Running suite benchmark for: ${suite.name}...`);
    }

    const rows = await runSuiteBenchmark(suite, tools, {
      verbose: options.verbose,
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
    }
  }

  if (crossSuiteSummaries.length > 1 && options.format === 'ascii') {
    console.log(renderCrossSuiteSummary(crossSuiteSummaries));
  }

  console.log('\n✓ Benchmark run complete. Results saved in packages/benchmarks/results/.\n');
}

main().catch((err) => {
  console.error('\n❌ Benchmark error:', err);
  process.exit(1);
});
