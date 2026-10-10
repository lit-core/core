import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_COMPONENT_IDS } from '../suites/canonical-components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultResultsDir = path.resolve(__dirname, '../../results');

export const SCHEMA_VERSION = '2.0.0';

/**
 * Known metadata for all available benchmark optimization features.
 * @type {Record<string, { name: string, description: string, category: string, scenarioId?: string, scenarioName?: string }>}
 */
export const FEATURE_METADATA = {
  baseline: {
    name: 'Baseline (Standard Vite)',
    description: 'Standard Vite build without any lit-core optimization plugins',
    category: 'baseline',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
  'css-fuse': {
    name: 'CSS AST deduplication (css-fuse)',
    description: 'Cross-component CSS deduplication into shared constructable stylesheets',
    category: 'styles',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
  'css-minifier': {
    name: 'CSS template minification (css-minifier)',
    description: 'High-speed CSS template literal minifier powered by Lightning CSS',
    category: 'styles',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
  'html-fuse': {
    name: 'HTML fragment clustering (html-fuse)',
    description: 'Cross-component static HTML and SVG fragment clustering',
    category: 'templates',
    scenarioId: 'dynamic-feed',
    scenarioName: 'Dynamic feed',
  },
  'html-aot': {
    name: 'AOT template compilation (html-aot)',
    description: 'Ahead-of-time Lit template compilation eliminating runtime prepare phase',
    category: 'templates',
    scenarioId: 'ssr-dashboard',
    scenarioName: 'SSR dashboard',
  },
  'html-minifier': {
    name: 'HTML template minification (html-minifier)',
    description: 'High-speed HTML template literal minifier powered by OXC',
    category: 'templates',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
  'props-lower': {
    name: 'Lit decorator lowering (props-lower)',
    description: 'Ahead-of-time decorator lowering and prototype descriptor preset hoisting',
    category: 'reactivity',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
  'dirty-mask': {
    name: 'Dependency bitmasking (dirty-mask)',
    description: 'Ahead-of-time property-to-part dependency bitmasking',
    category: 'reactivity',
    scenarioId: 'data-grid',
    scenarioName: 'Data grid',
  },
  directives: {
    name: 'Lit directive lowering (directives)',
    description: 'Ahead-of-time Lit directive lowering compiler eliminating runtime wrapper allocations',
    category: 'templates',
    scenarioId: 'dynamic-feed',
    scenarioName: 'Dynamic feed',
  },
  memoize: {
    name: 'Expression memoization (memoize)',
    description: 'Ahead-of-time reactive expression auto-memoization',
    category: 'reactivity',
    scenarioId: 'dynamic-feed',
    scenarioName: 'Dynamic feed',
  },
  'dom-paths': {
    name: 'Structural DOM paths (dom-paths)',
    description: 'Structural DOM path compiler eliminating TreeWalker mounting traversal',
    category: 'dom',
    scenarioId: 'data-grid',
    scenarioName: 'Data grid',
  },
  'event-hoist': {
    name: 'ShadowRoot event delegation (event-hoist)',
    description: 'Ahead-of-time ShadowRoot event delegation',
    category: 'dom',
    scenarioId: 'interactive-form',
    scenarioName: 'Interactive form',
  },
  'elem-proxy': {
    name: 'Element proxy stubs (elem-proxy)',
    description: 'AOT Custom Element proxy stubs for deferred registration and lazy loading',
    category: 'registration',
    scenarioId: 'interactive-form',
    scenarioName: 'Interactive form',
  },
  native: {
    name: 'Vanilla Web Component compiler (native)',
    description: 'Ahead-of-time vanilla Web Component compilation with micro-runtime reconciler',
    category: 'runtime',
    scenarioId: 'data-grid',
    scenarioName: 'Data grid',
  },
  resumable: {
    name: 'Zero-JS resumption (resumable)',
    description: 'Zero-JavaScript SSR and interaction-driven runtime resumption',
    category: 'resumption',
    scenarioId: 'ssr-dashboard',
    scenarioName: 'SSR dashboard',
  },
  'tag-shake': {
    name: 'Tag shake dead code elimination (tag-shake)',
    description: 'Ahead-of-time Web Component dead code elimination and registration tag shaking',
    category: 'tree-shaking',
    scenarioId: 'selective-app',
    scenarioName: 'Selective application',
  },
  all: {
    name: 'All optimizations combined',
    description: 'Combined impact of all enabled optimization tools simultaneously',
    category: 'combined',
    scenarioId: 'bundle',
    scenarioName: 'Multi-component bundle',
  },
};

/**
 * Standard scenario metadata registry.
 * @type {Record<string, { id: string, name: string, description: string, relevantFeatures: string[], componentConcepts: string[] }>}
 */
export const SCENARIO_METADATA = {
  'data-grid': {
    id: 'data-grid',
    name: 'Data grid',
    description: 'High-density data grid rendering 100 rows with real component cells testing TreeWalker bypass, dependency bitmasking, and micro-runtime compilation',
    relevantFeatures: ['dom-paths', 'dirty-mask', 'native'],
    componentConcepts: ['checkbox', 'badge', 'button', 'icon-button'],
  },
  'interactive-form': {
    id: 'interactive-form',
    name: 'Interactive form',
    description: 'Dense multi-section interactive settings form with real controls testing event listener hoisting and deferred proxy registration',
    relevantFeatures: ['event-hoist', 'elem-proxy'],
    componentConcepts: ['text-input', 'checkbox', 'switch', 'radio', 'select', 'button'],
  },
  'ssr-dashboard': {
    id: 'ssr-dashboard',
    name: 'SSR dashboard',
    description: 'Server-rendered dashboard with Declarative Shadow DOM components testing zero-JS resumption and AOT template compilation',
    relevantFeatures: ['resumable', 'html-aot'],
    componentConcepts: ['card', 'badge', 'progress-bar', 'button', 'tabs'],
  },
  'dynamic-feed': {
    id: 'dynamic-feed',
    name: 'Dynamic feed',
    description: 'Dynamic reactive feed with repeated collection items testing directive lowering, expression memoization, and static HTML clustering',
    relevantFeatures: ['directives', 'memoize', 'html-fuse'],
    componentConcepts: ['card', 'badge', 'icon', 'button', 'chips', 'divider'],
  },
  'selective-app': {
    id: 'selective-app',
    name: 'Selective application',
    description: 'Enterprise application importing design system components with selective usage testing Custom Element tag shaking and dead code elimination',
    relevantFeatures: ['tag-shake'],
    componentConcepts: ['button', 'badge', 'card'],
  },
  bundle: {
    id: 'bundle',
    name: 'Multi-component bundle',
    description: 'Enterprise application importing 20 canonical components across routes testing cross-component CSS AST deduplication and decorator lowering',
    relevantFeatures: ['css-fuse', 'props-lower', 'css-minifier', 'html-minifier', 'all', 'baseline'],
    componentConcepts: [
      'button',
      'checkbox',
      'radio',
      'switch',
      'text-input',
      'select',
      'dialog',
      'badge',
      'tabs',
      'progress-bar',
      'spinner',
      'slider',
      'menu',
      'divider',
      'icon',
      'icon-button',
      'card',
      'elevation',
      'list',
      'chips',
    ],
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
      scenarioId: result.scenario?.id || FEATURE_METADATA[featureId]?.scenarioId || 'bundle',
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
 * @property {string} [scenarioId]
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

  entry.scenarioId = entry.scenarioId || FEATURE_METADATA[entry.featureId]?.scenarioId || 'bundle';

  /** @type {{ schemaVersion: string, generatedAt: string, canonicalComponentCount: number, canonicalComponents: string[], libraries: Array<{ id: string, name: string, packageName: string, componentCount: number }>, scenarios: Array<any>, features: Array<{ id: string, name: string, description: string, category: string, scenarioId?: string, scenarioName?: string }>, runs: ManifestRunEntry[] }} */
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
    scenarios: Object.values(SCENARIO_METADATA),
    features: Object.entries(FEATURE_METADATA).map(([id, meta]) => ({
      id,
      name: meta.name,
      description: meta.description,
      category: meta.category,
      scenarioId: meta.scenarioId || 'bundle',
      scenarioName: meta.scenarioName || 'Multi-component bundle',
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

  // Reconcile deltas against current baseline for each suite
  /** @type {Record<string, ManifestRunEntry>} */
  const baselinesBySuite = {};
  for (const r of manifest.runs) {
    if (r.featureId === 'baseline') {
      baselinesBySuite[r.suiteId] = r;
    }
  }

  for (const r of manifest.runs) {
    const base = baselinesBySuite[r.suiteId];
    if (r.featureId === 'baseline') {
      r.rawPercent = 0;
      r.gzipPercent = 0;
      r.brotliPercent = 0;
      r.speedupPercent = 0;
      r.updateSpeedupPercent = 0;
      r.evalSpeedupPercent = 0;
      r.registrationSpeedupPercent = 0;
      r.memorySavingsPercent = 0;
    } else if (base) {
      if (base.rawBytes > 0 && r.rawBytes > 0) {
        r.rawPercent = ((r.rawBytes - base.rawBytes) / base.rawBytes) * 100;
      }
      if (base.gzipBytes > 0 && r.gzipBytes > 0) {
        r.gzipPercent = ((r.gzipBytes - base.gzipBytes) / base.gzipBytes) * 100;
      }
      if (base.brotliBytes > 0 && r.brotliBytes > 0) {
        r.brotliPercent = ((r.brotliBytes - base.brotliBytes) / base.brotliBytes) * 100;
      }
      if (base.firstRenderMs > 0 && r.firstRenderMs > 0) {
        r.speedupPercent = ((base.firstRenderMs - r.firstRenderMs) / base.firstRenderMs) * 100;
      }
      if (base.updateMs !== undefined && r.updateMs !== undefined && base.updateMs > 0 && r.updateMs > 0) {
        r.updateSpeedupPercent = ((base.updateMs - r.updateMs) / base.updateMs) * 100;
      }
      if (base.scriptEvalMs !== undefined && r.scriptEvalMs !== undefined && base.scriptEvalMs > 0 && r.scriptEvalMs > 0) {
        r.evalSpeedupPercent = ((base.scriptEvalMs - r.scriptEvalMs) / base.scriptEvalMs) * 100;
      }
      if (base.registrationMs !== undefined && r.registrationMs !== undefined && base.registrationMs > 0 && r.registrationMs > 0) {
        r.registrationSpeedupPercent = ((base.registrationMs - r.registrationMs) / base.registrationMs) * 100;
      }
      if (base.heapUsedBytes !== undefined && r.heapUsedBytes !== undefined && base.heapUsedBytes > 0 && r.heapUsedBytes > 0) {
        r.memorySavingsPercent = ((base.heapUsedBytes - r.heapUsedBytes) / base.heapUsedBytes) * 100;
      }
    }
  }

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
