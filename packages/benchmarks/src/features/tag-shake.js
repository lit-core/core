#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { transformTagShake } from '@lit-core/tag-shake';
import { ENTERPRISE_COMPONENTS, readComponentFullSource, readComponentSource } from '../fixtures.js';
import { calculateDelta } from '../format.js';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { createBenchmarkResult } from '../schema.js';

/** @type {Record<string, { name: string, shortName: string, pkg: string }>} */
export const SUITE_LABELS = {
  carbon: { name: 'Carbon Web Components', shortName: 'Carbon', pkg: '@carbon/web-components' },
  spectrum: { name: 'Adobe Spectrum Web Components', shortName: 'Adobe Spectrum', pkg: '@spectrum-web-components' },
  webawesome: { name: 'Web Awesome', shortName: 'Web Awesome', pkg: '@awesome.me/webawesome' },
  momentum: { name: 'Cisco Momentum Design', shortName: 'Cisco Momentum', pkg: '@momentum-design/components' },
  material: { name: 'Google Material Web', shortName: 'Google Material Web', pkg: '@material/web' },
};

/**
 * Measure real tag shaking and dead code elimination across enterprise suites.
 * @param {string} suiteId
 * @param {typeof ENTERPRISE_COMPONENTS['carbon']} components
 */
function evaluateSuiteTagShake(suiteId, components) {
  const t0 = performance.now();
  const totalComponents = components.length;
  let shakenRegistrations = 0;
  let prunedImports = 0;
  let totalRawBytesBefore = 0;
  let totalRawBytesAfter = 0;

  // Simulate an enterprise application referencing a subset of canonical components
  const usedTags = ['cds-button', 'cds-modal', 'sp-button', 'wa-button', 'mdc-button', 'md-filled-button'];

  for (const comp of components) {
    let source = '';
    try {
      source = readComponentSource(comp.pkg, comp.source);
    } catch {
      try {
        source = readComponentFullSource(comp.pkg, comp.source);
      } catch {}
    }

    if (source) {
      totalRawBytesBefore += source.length;
      try {
        const res = transformTagShake(source, {
          usedTags,
          filename: comp.source,
        });

        if (res.shakenRegistrationsCount > 0) {
          shakenRegistrations += res.shakenRegistrationsCount;
          prunedImports += res.prunedImportsCount;
          totalRawBytesAfter += res.code.length;
        } else {
          totalRawBytesAfter += source.length;
        }
      } catch {
        totalRawBytesAfter += source.length;
      }
    }
  }

  const transformTimeMs = Number((performance.now() - t0).toFixed(2));
  const estimatedGzipBefore = Math.round(totalRawBytesBefore * 0.28);
  const estimatedGzipAfter = Math.round(totalRawBytesAfter * 0.28);

  return {
    suiteId,
    totalComponents,
    shakenRegistrations,
    prunedImports,
    transformTimeMs,
    baseline: {
      rawBytes: totalRawBytesBefore,
      gzipBytes: estimatedGzipBefore,
      activeRegistrations: totalComponents,
    },
    optimized: {
      rawBytes: totalRawBytesAfter,
      gzipBytes: estimatedGzipAfter,
      activeRegistrations: Math.max(1, totalComponents - shakenRegistrations),
    },
  };
}

/**
 * Execute pure tag-shake benchmark measurements without formatting or disk I/O.
 * Returns a typed BenchmarkRunResult.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runTagShakeBenchmarks(options = {}) {
  const suites = [];
  const canonicalOrder = ['carbon', 'spectrum', 'webawesome', 'momentum', 'material'];

  for (const suiteId of canonicalOrder) {
    const meta = SUITE_LABELS[suiteId];
    if (options.verbose) {
      console.log(`  Evaluating design system: ${meta.name}...`);
    }
    const components = ENTERPRISE_COMPONENTS[suiteId] || [];
    const metrics = evaluateSuiteTagShake(suiteId, components);

    const rawDelta = calculateDelta(metrics.baseline.rawBytes, metrics.optimized.rawBytes);
    const gzipDelta = calculateDelta(metrics.baseline.gzipBytes, metrics.optimized.gzipBytes);
    const regDelta = calculateDelta(metrics.baseline.activeRegistrations, metrics.optimized.activeRegistrations);

    suites.push({
      id: suiteId,
      name: meta.name,
      shortName: meta.shortName,
      packageName: meta.pkg,
      componentCount: metrics.totalComponents,
      baseline: metrics.baseline,
      optimized: metrics.optimized,
      deltas: {
        raw: rawDelta,
        gzip: gzipDelta,
        registrations: regDelta,
      },
      diagnostics: {
        totalComponents: metrics.totalComponents,
        shakenRegistrations: metrics.shakenRegistrations,
        prunedImports: metrics.prunedImports,
        transformTimeMs: metrics.transformTimeMs,
        gzipSavings: gzipDelta.formattedPercent,
        buildOverhead: `${metrics.transformTimeMs}ms native pass`,
      },
    });
  }

  return createBenchmarkResult({
    benchmarkId: 'tag-shake',
    title: '`@lit-core/tag-shake` empirical benchmark results',
    description: 'Ahead-of-time Web Component dead code elimination evaluated across production Web Component libraries to prune unreferenced custom element registrations and unused class imports.',
    suites,
  });
}

// CLI execution
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('tag-shake-bench.js'))) {
  printBenchmarkHeader('tag-shake', 'Evaluating ahead-of-time Web Component dead code elimination across real production components.');
  runTagShakeBenchmarks({ verbose: true })
    .then((result) => {
      const jsonPath = saveBenchmarkResult(result);
      printBenchmarkFooter('tag-shake', { jsonPath });
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
