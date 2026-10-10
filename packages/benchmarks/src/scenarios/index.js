import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_METADATA, saveStandaloneResult } from '../reporters/json-reporter.js';
import { closeBrowser } from '../runtime.js';
import { getEnvironmentMetadata } from '../schema.js';
import { registeredTools } from '../tools/index.js';
import { bundleScenario } from './bundle/index.js';
import { dataGridScenario } from './data-grid/index.js';
import { dynamicFeedScenario } from './dynamic-feed/index.js';
import { calculateScenarioDeltas, measureScenarioRuntime, runScenarioViteBuild } from './harness/scenario-base.js';
import { interactiveFormScenario } from './interactive-form/index.js';
import { selectiveAppScenario } from './selective-app/index.js';
import { ssrDashboardScenario } from './ssr-dashboard/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultResultsDir = path.resolve(__dirname, '../../results');

/**
 * Array of all supported benchmark scenarios.
 */
export const SCENARIOS = [dataGridScenario, interactiveFormScenario, ssrDashboardScenario, dynamicFeedScenario, selectiveAppScenario, bundleScenario];

/**
 * Map of scenarios keyed by unique ID.
 * @type {Record<string, typeof SCENARIOS[number]>}
 */
export const SCENARIO_MAP = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

/**
 * Map designating the authentic scenario custom-built for each optimization feature.
 * @type {Record<string, string>}
 */
export const FEATURE_SCENARIO_MAP = {
  'dom-paths': 'data-grid',
  'dirty-mask': 'data-grid',
  native: 'data-grid',
  'event-hoist': 'interactive-form',
  'elem-proxy': 'interactive-form',
  resumable: 'ssr-dashboard',
  'html-aot': 'ssr-dashboard',
  directives: 'dynamic-feed',
  memoize: 'dynamic-feed',
  'html-fuse': 'dynamic-feed',
  'tag-shake': 'selective-app',
  'css-fuse': 'bundle',
  'props-lower': 'bundle',
  'css-minifier': 'bundle',
  'html-minifier': 'bundle',
  all: 'bundle',
  baseline: 'bundle',
};

/**
 * Look up a scenario by ID.
 * @param {string} id
 * @returns {typeof SCENARIOS[number]}
 */
export function getScenario(id) {
  return SCENARIO_MAP[id] || bundleScenario;
}

/**
 * Get the authentic scenario assigned to evaluate a specific feature.
 * @param {string} featureId
 * @returns {typeof SCENARIOS[number]}
 */
export function getScenarioForFeature(featureId) {
  const scenarioId = FEATURE_SCENARIO_MAP[featureId] || 'bundle';
  return getScenario(scenarioId);
}

/**
 * Save scenario benchmark artifact (schema 3.0.0).
 * Path: results/scenarios/<scenarioId>/<suiteId>/<variantId>.json
 * @param {Object} params
 * @param {string} params.scenarioId
 * @param {string} params.suiteId
 * @param {string} params.variantId
 * @param {any} params.result
 * @param {string} [params.outDir]
 * @returns {string} Written file path
 */
export function saveScenarioResult({ scenarioId, suiteId, variantId, result, outDir = defaultResultsDir }) {
  const targetDir = path.join(outDir, 'scenarios', scenarioId, suiteId);
  fs.mkdirSync(targetDir, { recursive: true });

  const filePath = path.join(targetDir, `${variantId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load scenario benchmark artifact if present.
 * @param {string} scenarioId
 * @param {string} suiteId
 * @param {string} variantId
 * @param {string} [outDir]
 * @returns {any | null}
 */
export function loadScenarioResult(scenarioId, suiteId, variantId, outDir = defaultResultsDir) {
  const filePath = path.join(outDir, 'scenarios', scenarioId, suiteId, `${variantId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Execute a scenario benchmark run for a suite and variant.
 * Measures both baseline and optimized variant under the scenario application workload.
 * Produces structured schema 3.0.0 artifacts and syncs standalone feature results.
 * @param {Object} params
 * @param {typeof SCENARIOS[number]} params.scenario
 * @param {import('../types.js').BenchmarkSuite} params.suite
 * @param {string} params.variantId - Tool ID (e.g. 'dom-paths', 'event-hoist') or 'baseline'
 * @param {Object} [params.options]
 * @param {boolean} [params.options.verbose]
 * @param {string} [params.options.outDir]
 * @returns {Promise<any>}
 */
export async function runScenarioBenchmark({ scenario, suite, variantId, options = {} }) {
  const isBaseline = variantId === 'baseline';
  const toolObj = registeredTools.find((t) => t.id === variantId);
  const toolName = isBaseline ? 'Baseline (Standard Vite)' : FEATURE_METADATA[variantId]?.name || toolObj?.name || variantId;

  const tempBaseDir = path.join(__dirname, `../../.temp-scenario-${scenario.id}-${suite.id}-${variantId}-${Date.now()}`);
  fs.mkdirSync(tempBaseDir, { recursive: true });

  const suiteContext = await suite.setup();

  try {
    if (options.verbose) {
      console.log(`\n[${suite.name}] 🎭 Running scenario '${scenario.name}' [${variantId}]...`);
    }

    // 1. Generate scenario entry file with real components
    const entryContent = scenario.generateEntry(suiteContext);
    const entryPath = path.join(tempBaseDir, 'scenario-entry.js');
    fs.writeFileSync(entryPath, entryContent, 'utf-8');

    // 2. Build or load Scenario Baseline
    const cachedBaseline = loadScenarioResult(scenario.id, suite.id, 'baseline', options.outDir);
    let baselineSize = cachedBaseline?.metrics;
    let baselineRuntime = cachedBaseline?.runtime;
    let baselineEquivalence = cachedBaseline?.equivalence;

    if (!baselineSize || !baselineRuntime) {
      if (options.verbose) {
        console.log(`  [${scenario.name}] 📦 Building scenario baseline...`);
      }
      const baselineOutDir = path.join(tempBaseDir, 'dist-baseline');
      baselineSize = await runScenarioViteBuild({
        entryPath,
        outDir: baselineOutDir,
        plugins: [],
      });

      const baselineBundle = path.join(baselineOutDir, 'bundle.js');
      const baselineEval = await measureScenarioRuntime({
        bundlePath: baselineBundle,
        scenarioName: scenario.name,
        variantName: 'Baseline',
      });
      baselineRuntime = baselineEval.runtime;
      baselineEquivalence = baselineEval.equivalence;

      const baselineResult = {
        schemaVersion: '3.0.0',
        id: `${scenario.id}-${suite.id}-baseline`,
        scenario: {
          id: scenario.id,
          name: scenario.name,
          description: scenario.description,
          relevantFeatures: scenario.relevantFeatures,
          componentConcepts: scenario.componentConcepts,
        },
        suite: {
          id: suite.id,
          name: suiteContext.name || suite.name,
          packageName: suiteContext.packageName || suite.packageName,
          version: suiteContext.version || 'unknown',
        },
        variant: {
          id: 'baseline',
          name: 'Baseline (Standard Vite)',
          isBaseline: true,
        },
        timestamp: new Date().toISOString(),
        environment: getEnvironmentMetadata(),
        metrics: {
          ...baselineSize,
          ...baselineRuntime,
          scenarioSpecific: baselineEval.scenarioSpecific,
        },
        runtime: baselineRuntime,
        equivalence: baselineEquivalence,
      };

      saveScenarioResult({
        scenarioId: scenario.id,
        suiteId: suite.id,
        variantId: 'baseline',
        result: baselineResult,
        outDir: options.outDir,
      });
    }

    if (isBaseline) {
      return {
        schemaVersion: '3.0.0',
        id: `${scenario.id}-${suite.id}-baseline`,
        scenario: {
          id: scenario.id,
          name: scenario.name,
          description: scenario.description,
          relevantFeatures: scenario.relevantFeatures,
          componentConcepts: scenario.componentConcepts,
        },
        suite: {
          id: suite.id,
          name: suiteContext.name || suite.name,
          packageName: suiteContext.packageName || suite.packageName,
          version: suiteContext.version || 'unknown',
        },
        variant: {
          id: 'baseline',
          name: 'Baseline (Standard Vite)',
          isBaseline: true,
        },
        timestamp: new Date().toISOString(),
        environment: getEnvironmentMetadata(),
        metrics: {
          ...baselineSize,
          ...baselineRuntime,
        },
        runtime: baselineRuntime,
        equivalence: baselineEquivalence,
      };
    }

    // 3. Build Scenario Variant with Optimization Plugins
    if (options.verbose) {
      console.log(`  [${scenario.name}] ⚡ Building optimized variant (${toolName})...`);
    }

    /** @type {import('vite').Plugin[]} */
    let plugins = [];
    if (variantId === 'all') {
      const { getCombinedPlugins } = await import('../tools/index.js');
      plugins = await getCombinedPlugins(registeredTools, suiteContext);
    } else if (toolObj && typeof toolObj.getPlugins === 'function') {
      plugins = await toolObj.getPlugins(suiteContext);
    }

    const variantOutDir = path.join(tempBaseDir, `dist-${variantId}`);
    const variantSize = await runScenarioViteBuild({
      entryPath,
      outDir: variantOutDir,
      plugins,
    });

    const variantBundle = path.join(variantOutDir, 'bundle.js');
    const variantEval = await measureScenarioRuntime({
      bundlePath: variantBundle,
      scenarioName: scenario.name,
      variantName: toolName,
    });

    const deltas = calculateScenarioDeltas(baselineSize, variantSize, baselineRuntime, variantEval.runtime);

    const scenarioResult = {
      schemaVersion: '3.0.0',
      id: `${scenario.id}-${suite.id}-${variantId}`,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        relevantFeatures: scenario.relevantFeatures,
        componentConcepts: scenario.componentConcepts,
      },
      suite: {
        id: suite.id,
        name: suiteContext.name || suite.name,
        packageName: suiteContext.packageName || suite.packageName,
        version: suiteContext.version || 'unknown',
      },
      variant: {
        id: variantId,
        name: toolName,
        isBaseline: false,
      },
      timestamp: new Date().toISOString(),
      environment: getEnvironmentMetadata(),
      metrics: {
        ...variantSize,
        ...variantEval.runtime,
        scenarioSpecific: variantEval.scenarioSpecific,
      },
      baseline: {
        ...baselineSize,
        ...baselineRuntime,
      },
      deltas,
      runtime: {
        ...variantEval.runtime,
        speedupPercent: deltas.speedupPercent,
        updateSpeedupPercent: deltas.updateSpeedupPercent,
        evalSpeedupPercent: deltas.evalSpeedupPercent,
        registrationSpeedupPercent: deltas.registrationSpeedupPercent,
        memorySavingsPercent: deltas.memorySavingsPercent,
      },
      equivalence: variantEval.equivalence,
    };

    // Save scenario schema 3.0.0 result
    saveScenarioResult({
      scenarioId: scenario.id,
      suiteId: suite.id,
      variantId,
      result: scenarioResult,
      outDir: options.outDir,
    });

    // Also sync standalone feature result (schema 2.0.0) with scenario metadata attached
    saveStandaloneResult({
      suiteId: suite.id,
      featureId: variantId,
      result: {
        schemaVersion: '2.0.0',
        id: `${suite.id}-${variantId}`,
        suite: {
          id: suite.id,
          name: suiteContext.name || suite.name,
          packageName: suiteContext.packageName || suite.packageName,
          version: suiteContext.version || 'unknown',
          componentCount: suiteContext.componentCount,
          components: suiteContext.metadata?.components || [],
        },
        feature: {
          id: variantId,
          name: toolName,
          description: FEATURE_METADATA[variantId]?.description || toolObj?.description || '',
          isBaseline: false,
        },
        scenario: {
          id: scenario.id,
          name: scenario.name,
          description: scenario.description,
        },
        timestamp: new Date().toISOString(),
        environment: getEnvironmentMetadata(),
        metrics: variantSize,
        baseline: baselineSize,
        deltas,
        runtime: scenarioResult.runtime,
      },
      outDir: options.outDir,
    });

    return scenarioResult;
  } finally {
    await closeBrowser();
    await suite.cleanup();
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  }
}
