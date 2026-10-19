#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { transformTagShake } from '@lit-core/tag-shake';
import { ENTERPRISE_COMPONENTS, readComponentFullSource, readComponentSource } from '../fixtures.js';
import { calculateDelta } from '../format.js';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { createBenchmarkResult } from '../schema.js';
import { CANONICAL_SUITE_DEFINITIONS } from '../suites/canonical-components.js';

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

  // Derive used tags from the canonical definitions for this design system
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[suiteId];
  const usedTags = suiteDef ? [suiteDef.components.button?.tag, suiteDef.components.dialog?.tag, suiteDef.components.card?.tag].filter(Boolean) : ['cds-button', 'cds-modal'];

  const beforeBuffers = [];
  const afterBuffers = [];

  for (const comp of components) {
    let source = '';
    try {
      source = readComponentSource(comp.pkg, comp.source);
    } catch {
      try {
        source = readComponentFullSource(comp.pkg, comp.source);
      } catch (err) {
        console.warn(`[tag-shake warning] Failed to read ${comp.name}:`, err);
      }
    }

    if (source) {
      beforeBuffers.push(Buffer.from(source, 'utf-8'));
      try {
        const res = transformTagShake(source, {
          usedTags,
          filename: comp.source,
        });

        if (res.shakenRegistrationsCount > 0) {
          shakenRegistrations += res.shakenRegistrationsCount;
          prunedImports += res.prunedImportsCount;
          afterBuffers.push(Buffer.from(res.code, 'utf-8'));
        } else {
          afterBuffers.push(Buffer.from(source, 'utf-8'));
        }
      } catch (err) {
        console.warn(`[tag-shake warning] Transform failed for ${comp.name}:`, err);
        afterBuffers.push(Buffer.from(source, 'utf-8'));
      }
    }
  }

  const combinedBefore = Buffer.concat(beforeBuffers);
  const combinedAfter = Buffer.concat(afterBuffers);
  const totalRawBytesBefore = combinedBefore.length;
  const totalRawBytesAfter = combinedAfter.length;
  const gzipBytesBefore = zlib.gzipSync(combinedBefore).length;
  const gzipBytesAfter = zlib.gzipSync(combinedAfter).length;
  const transformTimeMs = Number((performance.now() - t0).toFixed(2));

  return {
    suiteId,
    totalComponents,
    shakenRegistrations,
    prunedImports,
    transformTimeMs,
    baseline: {
      rawBytes: totalRawBytesBefore,
      gzipBytes: gzipBytesBefore,
      activeRegistrations: totalComponents,
    },
    optimized: {
      rawBytes: totalRawBytesAfter,
      gzipBytes: gzipBytesAfter,
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
