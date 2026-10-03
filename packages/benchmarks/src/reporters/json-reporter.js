import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_COMPONENT_IDS } from '../suites/canonical-components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultResultsDir = path.resolve(__dirname, '../../results');

export const SCHEMA_VERSION = '2.0.0';

/**
 * Known metadata for all available benchmark optimization features.
 * @type {Record<string, { name: string, description: string, category: string }>}
 */
export const FEATURE_METADATA = {
  baseline: {
    name: 'Baseline (Standard Vite)',
    description: 'Standard Vite build without any lit-core optimization plugins',
    category: 'baseline',
  },
  'css-fuse': {
    name: 'CSS AST deduplication (css-fuse)',
    description: 'Cross-component CSS deduplication into shared constructable stylesheets',
    category: 'styles',
  },
  'css-minifier': {
    name: 'CSS template minification (css-minifier)',
    description: 'High-speed CSS template literal minifier powered by Lightning CSS',
    category: 'styles',
  },
  'html-fuse': {
    name: 'HTML fragment clustering (html-fuse)',
    description: 'Cross-component static HTML and SVG fragment clustering',
    category: 'templates',
  },
  'html-aot': {
    name: 'AOT template compilation (html-aot)',
    description: 'Ahead-of-time Lit template compilation eliminating runtime prepare phase',
    category: 'templates',
  },
  'html-minifier': {
    name: 'HTML template minification (html-minifier)',
    description: 'High-speed HTML template literal minifier powered by OXC',
    category: 'templates',
  },
  'props-lower': {
    name: 'Lit decorator lowering (props-lower)',
    description: 'Ahead-of-time decorator lowering and prototype descriptor preset hoisting',
    category: 'reactivity',
  },
  'dirty-mask': {
    name: 'Dependency bitmasking (dirty-mask)',
    description: 'Ahead-of-time property-to-part dependency bitmasking',
    category: 'reactivity',
  },
  directives: {
    name: 'Lit directive lowering (directives)',
    description: 'Ahead-of-time Lit directive lowering compiler eliminating runtime wrapper allocations',
    category: 'templates',
  },
  memoize: {
    name: 'Expression memoization (memoize)',
    description: 'Ahead-of-time reactive expression auto-memoization',
    category: 'reactivity',
  },
  'dom-paths': {
    name: 'Structural DOM paths (dom-paths)',
    description: 'Structural DOM path compiler eliminating TreeWalker mounting traversal',
    category: 'dom',
  },
  'event-hoist': {
    name: 'ShadowRoot event delegation (event-hoist)',
    description: 'Ahead-of-time ShadowRoot event delegation',
    category: 'dom',
  },
  'elem-proxy': {
    name: 'Element proxy stubs (elem-proxy)',
    description: 'AOT Custom Element proxy stubs for deferred registration and lazy loading',
    category: 'registration',
  },
  native: {
    name: 'Vanilla Web Component compiler (native)',
    description: 'Ahead-of-time vanilla Web Component compilation with micro-runtime reconciler',
    category: 'runtime',
  },
  resumable: {
    name: 'Zero-JS resumption (resumable)',
    description: 'Zero-JavaScript SSR and interaction-driven runtime resumption',
    category: 'resumption',
  },
  all: {
    name: 'All optimizations combined',
    description: 'Combined impact of all enabled optimization tools simultaneously',
    category: 'combined',
  },
};

/**
 * Standard known suite display names and package mapping.
 * @type {Record<string, { name: string, packageName: string }>}
 */
export const SUITE_METADATA = {
  carbon: { name: 'Carbon Web Components', packageName: '@carbon/web-components' },
  spectrum: { name: 'Spectrum Web Components', packageName: '@spectrum-web-components' },
  webawesome: { name: 'Web Awesome', packageName: '@awesome.me/webawesome' },
  material: { name: 'Material Web', packageName: '@material/web' },
  momentum: { name: 'Momentum Design', packageName: '@momentum-design/components' },
};

/**
 * Save a standalone benchmark result JSON file for a specific suite and feature.
 * Path format: packages/benchmarks/results/<suiteId>/<featureId>.json
 * @param {Object} params
 * @param {string} params.suiteId
 * @param {string} params.featureId
 * @param {any} params.result
 * @param {string} [params.outDir]
 * @returns {string} Written file path
 */
export function saveStandaloneResult({ suiteId, featureId, result, outDir = defaultResultsDir }) {
  const suiteDir = path.join(outDir, suiteId);
  fs.mkdirSync(suiteDir, { recursive: true });

  const filePath = path.join(suiteDir, `${featureId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');

  // Update manifest.json index
  updateManifest(
    {
      suiteId,
      featureId,
      path: `${suiteId}/${featureId}.json`,
      rawBytes: result.metrics?.rawBytes || 0,
      gzipBytes: result.metrics?.gzipBytes || 0,
      brotliBytes: result.metrics?.brotliBytes || 0,
      buildTimeMs: result.metrics?.buildTimeMs || 0,
      rawPercent: result.deltas?.rawPercent ?? 0,
      gzipPercent: result.deltas?.gzipPercent ?? 0,
      brotliPercent: result.deltas?.brotliPercent ?? 0,
      firstRenderMs: result.runtime?.firstRenderMs ?? 0,
      updateMs: result.runtime?.updateMs ?? 0,
      scriptEvalMs: result.runtime?.scriptEvalMs ?? 0,
      registrationMs: result.runtime?.registrationMs ?? 0,
      heapUsedBytes: result.runtime?.heapUsedBytes ?? 0,
      speedupPercent: result.runtime?.speedupPercent ?? 0,
      updateSpeedupPercent: result.runtime?.updateSpeedupPercent ?? 0,
      evalSpeedupPercent: result.runtime?.evalSpeedupPercent ?? 0,
      registrationSpeedupPercent: result.runtime?.registrationSpeedupPercent ?? 0,
      memorySavingsPercent: result.runtime?.memorySavingsPercent ?? 0,
      timestamp: result.timestamp,
    },
    outDir,
  );

  return filePath;
}

/**
 * Load a standalone benchmark result from results/<suiteId>/<featureId>.json.
 * @param {string} suiteId
 * @param {string} featureId
 * @param {string} [dir]
 * @returns {any | null}
 */
export function loadStandaloneResult(suiteId, featureId, dir = defaultResultsDir) {
  const targetPath = path.join(dir, suiteId, `${featureId}.json`);
  if (!fs.existsSync(targetPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  } catch (err) {
    console.error(`Failed to load benchmark result from ${targetPath}:`, err);
    return null;
  }
}

/**
 * @typedef {Object} ManifestRunEntry
 * @property {string} suiteId
 * @property {string} featureId
 * @property {string} path
 * @property {string} [htmlPath]
 * @property {number} rawBytes
 * @property {number} gzipBytes
 * @property {number} brotliBytes
 * @property {number} buildTimeMs
 * @property {number} rawPercent
 * @property {number} gzipPercent
 * @property {number} brotliPercent
 * @property {number} firstRenderMs
 * @property {number} [updateMs]
 * @property {number} [scriptEvalMs]
 * @property {number} [registrationMs]
 * @property {number} [heapUsedBytes]
 * @property {number} speedupPercent
 * @property {number} [updateSpeedupPercent]
 * @property {number} [evalSpeedupPercent]
 * @property {number} [registrationSpeedupPercent]
 * @property {number} [memorySavingsPercent]
 * @property {string} timestamp
 */

/**
 * Update manifest.json with a run entry.
 * @param {ManifestRunEntry} entry
 * @param {string} [outDir]
 * @returns {string} Manifest file path
 */
export function updateManifest(entry, outDir = defaultResultsDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'manifest.json');

  /** @type {{ schemaVersion: string, generatedAt: string, canonicalComponentCount: number, canonicalComponents: string[], libraries: Array<{ id: string, name: string, packageName: string, componentCount: number }>, features: Array<{ id: string, name: string, description: string, category: string }>, runs: ManifestRunEntry[] }} */
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    canonicalComponentCount: CANONICAL_COMPONENT_IDS.length,
    canonicalComponents: CANONICAL_COMPONENT_IDS,
    libraries: Object.entries(SUITE_METADATA).map(([id, meta]) => ({
      id,
      name: meta.name,
      packageName: meta.packageName,
      componentCount: CANONICAL_COMPONENT_IDS.length,
    })),
    features: Object.entries(FEATURE_METADATA).map(([id, meta]) => ({
      id,
      name: meta.name,
      description: meta.description,
      category: meta.category,
    })),
    runs: [],
  };

  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (existing && Array.isArray(existing.runs)) {
        manifest.runs = existing.runs;
      }
    } catch {}
  }

  // Remove existing run for this suite & feature
  manifest.runs = manifest.runs.filter((r) => !(r.suiteId === entry.suiteId && r.featureId === entry.featureId));
  manifest.runs.push(entry);

  // Sort runs consistently: by suiteId then by featureId
  manifest.runs.sort((a, b) => {
    if (a.suiteId !== b.suiteId) return a.suiteId.localeCompare(b.suiteId);
    return a.featureId.localeCompare(b.featureId);
  });

  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  return manifestPath;
}

/**
 * Backward compatibility: save benchmark result (also updates manifest).
 * @param {any} result
 * @param {any} [options]
 * @returns {string}
 */
export function saveBenchmarkResult(result, options = {}) {
  const outDir = options.outDir || defaultResultsDir;
  fs.mkdirSync(outDir, { recursive: true });

  const filename = options.filename || `${result.benchmarkId || 'results'}.json`;
  const filePath = path.join(outDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  return filePath;
}

/**
 * Backward compatibility: load benchmark result.
 * @param {string} filePathOrId
 * @param {string} [dir]
 * @returns {any | null}
 */
export function loadBenchmarkResult(filePathOrId, dir = defaultResultsDir) {
  const targetPath = filePathOrId.endsWith('.json') ? path.resolve(filePathOrId) : path.join(dir, `${filePathOrId}.json`);

  if (!fs.existsSync(targetPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  } catch {
    return null;
  }
}
