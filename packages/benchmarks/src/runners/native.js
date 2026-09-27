#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
  const suites = [
    carbonSuite,
    spectrumSuite,
    webAwesomeSuite,
    momentumSuite,
    materialSuite,
  ];

  console.log('⚡ Starting @lit-core/native multi-design-system benchmark suite across 349 components...\n');

  const suiteResults = [];

  for (const suite of suites) {
    console.log(`Running suite: ${suite.name} (${suite.id})...`);
    const result = await runSuiteBenchmark(suite, [nativeTool], {
      verbose: options.verbose ?? false,
    });
    suiteResults.push(result);
  }

  console.log('\nBenchmark execution complete.');
  console.log(renderCrossSuiteSummary(suiteResults));

  if (options.updateDocs !== false) {
    console.log('Synchronizing benchmark documentation...');
    syncAllBenchmarkDocs(suiteResults);
  }

  return suiteResults;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runNativeBenchmarkSuite({ updateDocs: true }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
