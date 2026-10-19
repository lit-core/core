import { execSync } from 'node:child_process';
import os from 'node:os';

export const SCHEMA_VERSION = '1.0.0';

/**
 * Known evaluated versions of core dependencies and design systems.
 */
export const DEPENDENCY_VERSIONS = {
  '@carbon/web-components': { role: 'IBM Carbon Design System', version: '2.64.0', elements: 99 },
  '@spectrum-web-components/bundle': { role: 'Adobe Spectrum Design System', version: '1.12.2', elements: 52 },
  '@awesome.me/webawesome': { role: 'Web Awesome component suite', version: '3.14.0', elements: 73 },
  '@momentum-design/components': { role: 'Cisco Momentum Design System', version: '0.139.9', elements: 97 },
  '@material/web': { role: 'Google Material Design 3', version: '2.5.0', elements: 28 },
  lit: { role: 'Core runtime', version: '3.3.3', elements: 'n/a' },
  vite: { role: 'Bundler', version: '8.3.1', elements: 'n/a' },
  playwright: { role: 'Runtime evaluation engine', version: '1.63.0', elements: 'n/a' },
  node: { role: 'Runtime environment', version: process.version, elements: 'n/a' },
};

/**
 * Get git metadata if available in repository.
 * @returns {{ commit: string, branch: string }}
 */
function getGitMetadata() {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

/**
 * Collect system and dependency environment metadata.
 * @returns {Record<string, any>}
 */
export function getEnvironmentMetadata() {
  const git = getGitMetadata();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus()?.length || 1,
    gitCommit: git.commit,
    gitBranch: git.branch,
    versions: {
      lit: DEPENDENCY_VERSIONS.lit.version,
      vite: DEPENDENCY_VERSIONS.vite.version,
      playwright: DEPENDENCY_VERSIONS.playwright.version,
      node: process.version,
      carbon: DEPENDENCY_VERSIONS['@carbon/web-components'].version,
      spectrum: DEPENDENCY_VERSIONS['@spectrum-web-components/bundle'].version,
      webawesome: DEPENDENCY_VERSIONS['@awesome.me/webawesome'].version,
      momentum: DEPENDENCY_VERSIONS['@momentum-design/components'].version,
      material: DEPENDENCY_VERSIONS['@material/web'].version,
    },
  };
}

/**
 * Create a structured, schema-compliant benchmark result model.
 * @template TMetrics, TDiagnostics
 * @param {Object} params
 * @param {string} params.benchmarkId
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {Array<any>} params.suites
 * @param {Record<string, any>} [params.summary]
 * @param {Record<string, any>} [params.environment]
 * @returns {import('./types.js').BenchmarkRunResult<TMetrics, TDiagnostics>}
 */
export function createBenchmarkResult(params) {
  const { benchmarkId, title, description = '', suites, summary, environment } = params;

  return {
    schemaVersion: SCHEMA_VERSION,
    benchmarkId,
    title,
    description,
    timestamp: new Date().toISOString(),
    environment: environment || getEnvironmentMetadata(),
    suites,
    ...(summary ? { summary } : {}),
  };
}

/**
 * Validate that a result object complies with BenchmarkRunResult schema.
 * @param {any} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateBenchmarkResult(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Result must be a non-null object'] };
  }

  if (data.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected '${SCHEMA_VERSION}', got '${data.schemaVersion}'`);
  }

  if (typeof data.benchmarkId !== 'string' || !data.benchmarkId) {
    errors.push('Missing or invalid benchmarkId');
  }

  if (typeof data.title !== 'string' || !data.title) {
    errors.push('Missing or invalid title');
  }

  if (typeof data.timestamp !== 'string') {
    errors.push('Missing or invalid timestamp');
  }

  if (!data.environment || typeof data.environment !== 'object') {
    errors.push('Missing or invalid environment metadata');
  }

  if (!Array.isArray(data.suites)) {
    errors.push('Missing or invalid suites array');
  } else {
    data.suites.forEach((/** @type {any} */ suite, /** @type {number} */ idx) => {
      if (!suite.id || !suite.name) {
        errors.push(`Suite at index ${idx} is missing id or name`);
      }
      if (!suite.baseline || !suite.optimized) {
        errors.push(`Suite '${suite.id || idx}' is missing baseline or optimized metrics`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const SCENARIO_SCHEMA_VERSION = '3.0.0';

/**
 * Validate that a scenario result object complies with ScenarioBenchmarkResult schema 3.0.0.
 * @param {any} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateScenarioResult(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Scenario result must be a non-null object'] };
  }

  if (data.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion: expected '${SCENARIO_SCHEMA_VERSION}', got '${data.schemaVersion}'`);
  }

  if (typeof data.id !== 'string' || !data.id) {
    errors.push('Missing or invalid id');
  }

  if (!data.scenario || typeof data.scenario !== 'object' || !data.scenario.id || !data.scenario.name) {
    errors.push('Missing or invalid scenario metadata');
  }

  if (!data.suite || typeof data.suite !== 'object' || !data.suite.id || !data.suite.name) {
    errors.push('Missing or invalid suite metadata');
  }

  if (!data.variant || typeof data.variant !== 'object' || !data.variant.id || !data.variant.name) {
    errors.push('Missing or invalid variant metadata');
  }

  if (typeof data.timestamp !== 'string') {
    errors.push('Missing or invalid timestamp');
  }

  if (!data.metrics || typeof data.metrics !== 'object') {
    errors.push('Missing or invalid metrics object');
  }

  if (!data.environment || typeof data.environment !== 'object') {
    errors.push('Missing or invalid environment metadata');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * @typedef {Object} RuntimeMetrics
 * @property {number} firstRenderMs
 * @property {number} [updateMs]
 * @property {number} [scriptEvalMs]
 * @property {number} [registrationMs]
 * @property {number} [heapUsedBytes]
 * @property {number} [speedupPercent]
 * @property {number} [updateSpeedupPercent]
 * @property {number} [evalSpeedupPercent]
 * @property {number} [registrationSpeedupPercent]
 * @property {number} [memorySavingsPercent]
 */

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
