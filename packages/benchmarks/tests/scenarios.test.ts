import { describe, expect, it } from 'vitest';
import { calculateScenarioDeltas, resolveScenarioComponents } from '../src/scenarios/harness/scenario-base.js';
import { FEATURE_SCENARIO_MAP, getScenario, getScenarioForFeature, SCENARIO_MAP, SCENARIOS } from '../src/scenarios/index.js';
import { SCENARIO_SCHEMA_VERSION, validateScenarioResult } from '../src/schema.js';
import { registeredSuites } from '../src/suites/index.js';
import { renderAsciiScenarioTable } from '../src/table.js';
import type { SuiteContext } from '../src/types.js';

describe('benchmark scenarios registry and metadata', () => {
  it('registers all 6 authentic scenarios with unique IDs and metadata', () => {
    expect(SCENARIOS).toHaveLength(6);

    const ids = SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(['data-grid', 'interactive-form', 'ssr-dashboard', 'dynamic-feed', 'selective-app', 'bundle']);

    for (const scenario of SCENARIOS) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.name).toBeTruthy();
      expect(scenario.description).toBeTruthy();
      expect(Array.isArray(scenario.relevantFeatures)).toBe(true);
      expect(scenario.relevantFeatures.length).toBeGreaterThan(0);
      expect(Array.isArray(scenario.componentConcepts)).toBe(true);
      expect(scenario.componentConcepts.length).toBeGreaterThan(0);
      expect(typeof scenario.generateEntry).toBe('function');
    }
  });

  it('maps scenarios correctly in SCENARIO_MAP', () => {
    for (const scenario of SCENARIOS) {
      expect(SCENARIO_MAP[scenario.id]).toBe(scenario);
    }
  });

  it('maps each compiler feature to its designated authentic scenario in FEATURE_SCENARIO_MAP', () => {
    expect(FEATURE_SCENARIO_MAP['dom-paths']).toBe('data-grid');
    expect(FEATURE_SCENARIO_MAP['dirty-mask']).toBe('data-grid');
    expect(FEATURE_SCENARIO_MAP.native).toBe('data-grid');

    expect(FEATURE_SCENARIO_MAP['event-hoist']).toBe('interactive-form');
    expect(FEATURE_SCENARIO_MAP['elem-proxy']).toBe('interactive-form');

    expect(FEATURE_SCENARIO_MAP.resumable).toBe('ssr-dashboard');
    expect(FEATURE_SCENARIO_MAP['html-aot']).toBe('ssr-dashboard');

    expect(FEATURE_SCENARIO_MAP.directives).toBe('dynamic-feed');
    expect(FEATURE_SCENARIO_MAP.memoize).toBe('dynamic-feed');
    expect(FEATURE_SCENARIO_MAP['html-fuse']).toBe('dynamic-feed');

    expect(FEATURE_SCENARIO_MAP['tag-shake']).toBe('selective-app');

    expect(FEATURE_SCENARIO_MAP['css-fuse']).toBe('bundle');
    expect(FEATURE_SCENARIO_MAP['props-lower']).toBe('bundle');
    expect(FEATURE_SCENARIO_MAP['css-minifier']).toBe('bundle');
    expect(FEATURE_SCENARIO_MAP['html-minifier']).toBe('bundle');
    expect(FEATURE_SCENARIO_MAP.all).toBe('bundle');
    expect(FEATURE_SCENARIO_MAP.baseline).toBe('bundle');
  });

  it('retrieves scenarios via getScenario and getScenarioForFeature', () => {
    const grid = getScenario('data-grid');
    expect(grid.id).toBe('data-grid');
    expect(grid.name).toBe('Data grid');

    const form = getScenarioForFeature('event-hoist');
    expect(form.id).toBe('interactive-form');

    const ssr = getScenarioForFeature('resumable');
    expect(ssr.id).toBe('ssr-dashboard');

    const feed = getScenarioForFeature('directives');
    expect(feed.id).toBe('dynamic-feed');

    const selective = getScenarioForFeature('tag-shake');
    expect(selective.id).toBe('selective-app');

    const bundle = getScenarioForFeature('css-fuse');
    expect(bundle.id).toBe('bundle');

    // Falls back to bundle scenario on unknown name
    expect(getScenario('non-existent-scenario').id).toBe('bundle');
  });
});

describe('real component resolution across design systems', () => {
  it('resolves authentic components for all 5 design systems without fake stubs', () => {
    expect(registeredSuites.length).toBe(5);

    for (const suite of registeredSuites) {
      // Resolve components for data grid scenario
      const gridComponents = resolveScenarioComponents(suite.id, ['checkbox', 'badge', 'button']);
      expect(gridComponents.length).toBeGreaterThan(0);
      for (const comp of gridComponents) {
        expect(comp.concept).toBeTruthy();
        expect(comp.tag).toBeTruthy();
        expect(comp.path).toBeTruthy();
        expect(comp.importStatement).toBeTruthy();
        // Ensure real custom element tag name syntax
        expect(comp.tag).toContain('-');
        expect(comp.tag).not.toContain('<');
        expect(comp.tag).not.toContain('>');
      }

      // Resolve components for interactive form scenario
      const formComponents = resolveScenarioComponents(suite.id, ['text-input', 'checkbox', 'button']);
      expect(formComponents.length).toBeGreaterThan(0);
      for (const comp of formComponents) {
        expect(comp.tag).toContain('-');
      }

      // Resolve components for dynamic feed scenario
      const feedComponents = resolveScenarioComponents(suite.id, ['card', 'badge', 'button']);
      expect(feedComponents.length).toBeGreaterThan(0);
      for (const comp of feedComponents) {
        expect(comp.tag).toContain('-');
      }
    }
  });
});

describe('scenario entry generation with real components', () => {
  const createMockContext = (suiteId: string, suiteName: string): SuiteContext => ({
    id: suiteId,
    name: suiteName,
    entryPath: '/test/entry.js',
    componentCount: 20,
  });

  it('generates executable Lit entry source code for data grid scenario', () => {
    const gridScenario = getScenario('data-grid');
    for (const suite of registeredSuites) {
      const code = gridScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('import { html');
      expect(code).toContain('createInitialData');
      expect(code).toContain('gridData');
      // Ensure literal tag names are interpolated, not dynamic placeholders
      expect(code).not.toContain('<${');
      expect(code).not.toContain('undefined');
    }
  });

  it('generates executable Lit entry source code for interactive form scenario', () => {
    const formScenario = getScenario('interactive-form');
    for (const suite of registeredSuites) {
      const code = formScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('import { html');
      expect(code).toContain('interactive-form-root');
      expect(code).toContain('handleInput');
      expect(code).toContain('@click');
      expect(code).not.toContain('<${');
    }
  });

  it('generates executable Lit entry source code for SSR dashboard scenario', () => {
    const ssrScenario = getScenario('ssr-dashboard');
    for (const suite of registeredSuites) {
      const code = ssrScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('ssr-dashboard-root');
      expect(code).toContain('DASHBOARD_METRICS');
      expect(code).toContain('renderDashboard');
      expect(code).not.toContain('<${');
    }
  });

  it('generates executable Lit entry source code for dynamic feed scenario', () => {
    const feedScenario = getScenario('dynamic-feed');
    for (const suite of registeredSuites) {
      const code = feedScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('createFeedItems');
      expect(code).toContain('feed-card');
      expect(code).toContain('repeat(');
      expect(code).not.toContain('<${');
    }
  });

  it('generates executable Lit entry source code for selective application scenario', () => {
    const selectiveScenario = getScenario('selective-app');
    for (const suite of registeredSuites) {
      const code = selectiveScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('selective-app');
      expect(code).not.toContain('<${');
    }
  });

  it('generates executable Lit entry source code for multi-component bundle scenario', () => {
    const bundleScenario = getScenario('bundle');
    for (const suite of registeredSuites) {
      const code = bundleScenario.generateEntry(createMockContext(suite.id, suite.name));

      expect(typeof code).toBe('string');
      expect(code).toContain('bundle-app-root');
      expect(code).not.toContain('<${');
    }
  });
});

describe('scenario delta calculation and schema 3.0.0 validation', () => {
  it('accurately computes size and runtime speedup deltas', () => {
    const baseSize = {
      rawBytes: 100000,
      gzipBytes: 30000,
      brotliBytes: 25000,
      buildTimeMs: 500,
    };
    const optSize = {
      rawBytes: 70000,
      gzipBytes: 21000,
      brotliBytes: 17500,
      buildTimeMs: 450,
    };

    const baseRuntime = {
      firstRenderMs: 20.0,
      updateMs: 10.0,
      scriptEvalMs: 15.0,
      registrationMs: 5.0,
      heapUsedBytes: 2000000,
    };
    const optRuntime = {
      firstRenderMs: 15.0,
      updateMs: 5.0,
      scriptEvalMs: 10.0,
      registrationMs: 2.5,
      heapUsedBytes: 1500000,
    };

    const deltas = calculateScenarioDeltas(baseSize, optSize, baseRuntime, optRuntime);

    expect(deltas.rawBytes).toBe(-30000);
    expect(deltas.rawPercent).toBe(-30.0);
    expect(deltas.gzipBytes).toBe(-9000);
    expect(deltas.gzipPercent).toBe(-30.0);
    expect(deltas.brotliBytes).toBe(-7500);
    expect(deltas.brotliPercent).toBe(-30.0);

    // Speedup calculations: (base - opt) / base * 100
    expect(deltas.speedupPercent).toBe(25.0);
    expect(deltas.updateSpeedupPercent).toBe(50.0);
    expect(deltas.evalSpeedupPercent).toBe(33.33);
    expect(deltas.registrationSpeedupPercent).toBe(50.0);
    expect(deltas.memorySavingsPercent).toBe(25.0);
  });

  it('validates schema 3.0.0 scenario benchmark results', () => {
    const validResult = {
      schemaVersion: SCENARIO_SCHEMA_VERSION,
      id: 'data-grid-carbon-dom-paths',
      scenario: {
        id: 'data-grid',
        name: 'Data grid',
        description: 'High-density data grid rendering 100 rows with real component cells',
        relevantFeatures: ['dom-paths', 'dirty-mask', 'native'],
        componentConcepts: ['checkbox', 'badge', 'button'],
      },
      suite: {
        id: 'carbon',
        name: 'IBM Carbon Web Components',
        packageName: '@carbon/web-components',
        version: '2.37.0',
        componentCount: 20,
      },
      variant: {
        id: 'dom-paths',
        name: 'DOM path compiler (dom-paths)',
        isBaseline: false,
      },
      timestamp: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      metrics: {
        rawBytes: 85000,
        gzipBytes: 25000,
        brotliBytes: 21000,
        buildTimeMs: 420,
        firstRenderMs: 14.5,
        updateMs: 4.2,
      },
      baseline: {
        rawBytes: 95000,
        gzipBytes: 28000,
        brotliBytes: 23500,
        buildTimeMs: 400,
        firstRenderMs: 18.2,
        updateMs: 6.8,
      },
      deltas: {
        rawPercent: -10.5,
        gzipPercent: -10.7,
        speedupPercent: 20.3,
        updateSpeedupPercent: 38.2,
      },
      equivalence: {
        domStructureMatch: true,
        elementsCount: 400,
        verified: true,
      },
    };

    const validation = validateScenarioResult(validResult);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('detects missing or invalid fields in scenario benchmark results', () => {
    const invalidResult = {
      schemaVersion: '1.0.0', // Wrong schema version
      id: '',
      scenario: null,
      suite: null,
      variant: null,
      timestamp: 12345, // not a string
      metrics: 'invalid', // not an object
      environment: null,
    };

    const validation = validateScenarioResult(invalidResult);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});

describe('scenario table rendering', () => {
  it('renders clean ASCII table with strict sentence case', () => {
    const scenario = getScenario('data-grid');
    const mockResults = [
      {
        variant: { id: 'baseline', name: 'Baseline', isBaseline: true },
        metrics: { rawBytes: 100000, gzipBytes: 30000 },
        runtime: { firstRenderMs: 20.0, updateMs: 10.0 },
        deltas: {},
      },
      {
        variant: { id: 'dom-paths', name: 'DOM path compiler (dom-paths)', isBaseline: false },
        metrics: { rawBytes: 90000, gzipBytes: 27000 },
        runtime: { firstRenderMs: 16.0, updateMs: 6.5 },
        deltas: { speedupPercent: 20.0, updateSpeedupPercent: 35.0 },
      },
    ];

    const tableOutput = renderAsciiScenarioTable(scenario, mockResults);
    expect(tableOutput).toContain('Optimization variant');
    expect(tableOutput).toContain('Minified JS');
    expect(tableOutput).toContain('Gzip');
    expect(tableOutput).toContain('First render');
    expect(tableOutput).toContain('Render speedup');
    expect(tableOutput).toContain('Update latency');
    expect(tableOutput).toContain('Update speedup');
    expect(tableOutput).toContain('Baseline');
    expect(tableOutput).toContain('dom-paths');
    expect(tableOutput).toContain('+20.0%');
    expect(tableOutput).toContain('+35.0%');

    // Strictly ensure no Title Case header words
    expect(tableOutput).not.toContain('Optimization Variant');
    expect(tableOutput).not.toContain('First Render');
    expect(tableOutput).not.toContain('Render Speedup');
    expect(tableOutput).not.toContain('Update Latency');
    expect(tableOutput).not.toContain('Update Speedup');
  });
});
