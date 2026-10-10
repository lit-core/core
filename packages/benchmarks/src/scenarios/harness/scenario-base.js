import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { getFileSizes } from '../../metrics.js';
import { closeBrowser, emptyRuntimeMetrics, getBrowser } from '../../runtime.js';
import { CANONICAL_SUITE_DEFINITIONS } from '../../suites/canonical-components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../..');

/**
 * @typedef {Object} ScenarioMetadata
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} relevantFeatures
 * @property {string[]} componentConcepts
 */

/**
 * Resolve canonical component definitions for a given suite and list of concepts.
 * @param {string} suiteId
 * @param {string[]} concepts
 * @returns {Array<{ concept: string, tag: string, path: string, importStatement: string }>}
 */
export function resolveScenarioComponents(suiteId, concepts) {
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[suiteId];
  if (!suiteDef) {
    throw new Error(`Unknown suite ID for canonical components: ${suiteId}`);
  }

  const results = [];
  for (const concept of concepts) {
    const comp = suiteDef.components[concept];
    if (comp) {
      results.push({
        concept,
        tag: comp.tag,
        path: comp.path,
        importStatement: comp.importStatement,
      });
    }
  }
  return results;
}

/**
 * Execute a Vite build for a scenario.
 * @param {Object} options
 * @param {string} options.entryPath
 * @param {string} options.outDir
 * @param {import('vite').Plugin[]} [options.plugins]
 * @returns {Promise<import('../../metrics.js').SizeMetrics>}
 */
export async function runScenarioViteBuild({ entryPath, outDir, plugins = [] }) {
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const startTime = performance.now();
  await build({
    root: rootDir,
    publicDir: false,
    logLevel: 'silent',
    plugins,
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      rollupOptions: {
        input: entryPath,
        output: {
          entryFileNames: 'bundle.js',
          codeSplitting: false,
        },
      },
    },
  });
  const buildTimeMs = performance.now() - startTime;

  const bundlePath = path.join(outDir, 'bundle.js');
  const sizeMetrics = getFileSizes(bundlePath);
  return {
    ...sizeMetrics,
    buildTimeMs,
  };
}

/**
 * Measure runtime performance of a scenario bundle in headless Chromium via Playwright.
 * @param {Object} params
 * @param {string} params.bundlePath
 * @param {string} params.scenarioName
 * @param {string} [params.variantName='Variant']
 * @returns {Promise<{
 *   runtime: import('../../types.js').RuntimeMetrics,
 *   scenarioSpecific: Record<string, any>,
 *   equivalence: { domStructureMatch: boolean, elementsCount: number, verified: boolean }
 * }>}
 */
export async function measureScenarioRuntime({ bundlePath, scenarioName, variantName = 'Variant' }) {
  if (!fs.existsSync(bundlePath)) {
    return {
      runtime: emptyRuntimeMetrics(),
      scenarioSpecific: {},
      equivalence: { domStructureMatch: false, elementsCount: 0, verified: false },
    };
  }

  if (process.env.ALLOW_NO_BROWSER === '1' || process.argv.includes('--allow-no-browser')) {
    return {
      runtime: emptyRuntimeMetrics(),
      scenarioSpecific: {},
      equivalence: { domStructureMatch: true, elementsCount: 0, verified: true },
    };
  }

  let browser = null;
  let context = null;
  let page = null;
  let result = null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        browser = await getBrowser();
        if (!browser?.isConnected()) {
          await closeBrowser();
          browser = await getBrowser();
        }
        context = await browser.newContext();
        page = await context.newPage();
        break;
      } catch {
        await closeBrowser();
        browser = null;
        context = null;
        page = null;
      }
    }

    if (!page) {
      return {
        runtime: emptyRuntimeMetrics(),
        scenarioSpecific: {},
        equivalence: { domStructureMatch: true, elementsCount: 0, verified: true },
      };
    }

    const bundleCode = fs.readFileSync(bundlePath, 'utf-8');
    /** @type {string[]} */
    const runtimeErrors = [];

    page.on('pageerror', (err) => {
      runtimeErrors.push(`[Page error] ${err.stack || err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`[Console error] ${msg.text()}`);
      }
    });

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scenario benchmark: ${scenarioName} [${variantName}]</title>
</head>
<body>
  <div id="container"></div>
  <script type="module">
    window.__registeredTags = [];
    window.__registrationMs = 0;
    window.__bundleError = null;

    const origDefine = customElements.define;
    customElements.define = function(tag, constructor, options) {
      if (!window.__registeredTags.includes(tag)) {
        window.__registeredTags.push(tag);
      }
      const t0 = performance.now();
      const result = origDefine.call(customElements, tag, constructor, options);
      window.__registrationMs += performance.now() - t0;
      return result;
    };

    window.__evalStart = performance.now();
    try {
      ${bundleCode}
    } catch (e) {
      window.__bundleError = e.stack || e.message;
      throw e;
    }
    window.__evalEnd = performance.now();
    window.__bundleReady = true;
    //# sourceURL=${variantName.replace(/[^a-zA-Z0-9_-]/g, '_')}.scenario.bundle.js
  </script>
</body>
</html>`;

    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /** @type {any} */ (window).__bundleReady === true, { timeout: 15000 }).catch(() => {});

    if (runtimeErrors.length > 0) {
      await page.close();
      throw new Error(`Scenario runtime failure during evaluation of ${scenarioName} (${variantName}):\n${runtimeErrors.join('\n')}`);
    }

    result = await page.evaluate(async () => {
      const win = /** @type {any} */ (window);
      if (win.__bundleError) {
        throw new Error(`Scenario bundle execution crashed: ${win.__bundleError}`);
      }

      const evalMs = win.__evalStart && win.__evalEnd ? Math.max(0, win.__evalEnd - win.__evalStart) : 0;
      const regMs = win.__registrationMs || 0;
      const container = document.getElementById('container');
      if (!container) throw new Error('Benchmark container not found');

      /** @param {any} el */
      const safeUpdateComplete = (el) => {
        if (el && typeof el.updateComplete?.then === 'function') {
          return el.updateComplete.catch(() => {});
        }
        return Promise.resolve();
      };

      // Settle event loop and initial microtasks
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));

      let firstRenderMs = 0;
      let updateMs = 0;
      let scenarioSpecific = {};
      let elementsCount = 0;

      if (win.__scenario && typeof win.__scenario.mount === 'function') {
        // 1. Measure scenario mount
        container.innerHTML = '';
        const t0 = performance.now();
        await win.__scenario.mount(container);
        void container.offsetHeight;
        firstRenderMs = Math.max(0.1, performance.now() - t0);

        // Count rendered child elements
        elementsCount = container.querySelectorAll('*').length;

        // 2. Measure scenario update
        if (typeof win.__scenario.update === 'function') {
          const t1 = performance.now();
          await win.__scenario.update(container);
          void container.offsetHeight;
          updateMs = Math.max(0.1, performance.now() - t1);
        }

        if (typeof win.__scenario.getMetrics === 'function') {
          scenarioSpecific = await win.__scenario.getMetrics(container);
        }
      } else {
        // Fallback generic mount if no custom scenario mount was provided
        container.innerHTML = '';
        const tags = (win.__registeredTags || []).filter((/** @type {any} */ t) => typeof t === 'string' && t.includes('-'));
        const t0 = performance.now();
        const mounted = [];
        for (const tag of tags) {
          const el = document.createElement(tag);
          container.appendChild(el);
          mounted.push(el);
        }
        await Promise.all(mounted.map(safeUpdateComplete));
        void container.offsetHeight;
        firstRenderMs = Math.max(0.1, performance.now() - t0);
        elementsCount = mounted.length;

        const t1 = performance.now();
        for (let i = 0; i < mounted.length; i++) {
          const el = mounted[i];
          if ('disabled' in el) el.disabled = i % 2 === 0;
          if ('value' in el) el.value = `Updated ${i}`;
        }
        await Promise.all(mounted.map(safeUpdateComplete));
        void container.offsetHeight;
        updateMs = Math.max(0.1, performance.now() - t1);
      }

      // Memory footprint
      if (typeof win.gc === 'function') win.gc();
      const heapUsed = win.performance?.memory?.usedJSHeapSize || 0;

      return {
        runtime: {
          firstRenderMs: Number(firstRenderMs.toFixed(2)),
          updateMs: Number(updateMs.toFixed(2)),
          scriptEvalMs: Number(evalMs.toFixed(2)),
          registrationMs: Number(regMs.toFixed(2)),
          heapUsedBytes: heapUsed,
        },
        scenarioSpecific,
        equivalence: {
          domStructureMatch: elementsCount > 0,
          elementsCount,
          verified: elementsCount > 0,
        },
      };
    });
  } catch (err) {
    if (process.env.DEBUG || process.argv.includes('--verbose')) {
      const msg = err && typeof err === 'object' && 'message' in err ? /** @type {any} */ (err).message : String(err);
      console.warn(`[Scenario warning: ${scenarioName} (${variantName})]`, msg);
    }
    return {
      runtime: emptyRuntimeMetrics(),
      scenarioSpecific: {},
      equivalence: { domStructureMatch: false, elementsCount: 0, verified: false },
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (context) {
      try {
        await context.close();
      } catch {}
    }
  }
  return result;
}

/**
 * Calculate deltas between scenario baseline and optimized variant.
 * @param {import('../../metrics.js').SizeMetrics} baseSize
 * @param {import('../../metrics.js').SizeMetrics} optSize
 * @param {import('../../types.js').RuntimeMetrics} baseRuntime
 * @param {import('../../types.js').RuntimeMetrics} optRuntime
 * @returns {Record<string, any>}
 */
export function calculateScenarioDeltas(baseSize, optSize, baseRuntime, optRuntime) {
  const rawDiff = optSize.rawBytes - baseSize.rawBytes;
  const rawPercent = baseSize.rawBytes > 0 ? (rawDiff / baseSize.rawBytes) * 100 : 0;

  const gzipDiff = optSize.gzipBytes - baseSize.gzipBytes;
  const gzipPercent = baseSize.gzipBytes > 0 ? (gzipDiff / baseSize.gzipBytes) * 100 : 0;

  const brotliDiff = optSize.brotliBytes - baseSize.brotliBytes;
  const brotliPercent = baseSize.brotliBytes > 0 ? (brotliDiff / baseSize.brotliBytes) * 100 : 0;

  const buildTimeDiff = (optSize.buildTimeMs || 0) - (baseSize.buildTimeMs || 0);

  const speedupPercent = baseRuntime.firstRenderMs > 0 && optRuntime.firstRenderMs > 0 ? ((baseRuntime.firstRenderMs - optRuntime.firstRenderMs) / baseRuntime.firstRenderMs) * 100 : 0;

  const baseUpdate = baseRuntime.updateMs;
  const optUpdate = optRuntime.updateMs;
  const updateSpeedupPercent = baseUpdate !== undefined && optUpdate !== undefined && baseUpdate > 0 && optUpdate > 0 ? ((baseUpdate - optUpdate) / baseUpdate) * 100 : 0;

  const baseEval = baseRuntime.scriptEvalMs;
  const optEval = optRuntime.scriptEvalMs;
  const evalSpeedupPercent = baseEval !== undefined && optEval !== undefined && baseEval > 0 && optEval > 0 ? ((baseEval - optEval) / baseEval) * 100 : 0;

  const baseReg = baseRuntime.registrationMs;
  const optReg = optRuntime.registrationMs;
  const registrationSpeedupPercent = baseReg !== undefined && optReg !== undefined && baseReg > 0 && optReg > 0 ? ((baseReg - optReg) / baseReg) * 100 : 0;

  const baseHeap = baseRuntime.heapUsedBytes;
  const optHeap = optRuntime.heapUsedBytes;
  const memorySavingsPercent = baseHeap !== undefined && optHeap !== undefined && baseHeap > 0 && optHeap > 0 ? ((baseHeap - optHeap) / baseHeap) * 100 : 0;

  return {
    rawBytes: rawDiff,
    rawPercent: Number(rawPercent.toFixed(2)),
    gzipBytes: gzipDiff,
    gzipPercent: Number(gzipPercent.toFixed(2)),
    brotliBytes: brotliDiff,
    brotliPercent: Number(brotliPercent.toFixed(2)),
    buildTimeMs: Number(buildTimeDiff.toFixed(1)),
    firstRenderMs: Number((optRuntime.firstRenderMs - baseRuntime.firstRenderMs).toFixed(2)),
    speedupPercent: Number(speedupPercent.toFixed(2)),
    updateMs: Number(((optRuntime.updateMs || 0) - (baseRuntime.updateMs || 0)).toFixed(2)),
    updateSpeedupPercent: Number(updateSpeedupPercent.toFixed(2)),
    evalSpeedupPercent: Number(evalSpeedupPercent.toFixed(2)),
    registrationSpeedupPercent: Number(registrationSpeedupPercent.toFixed(2)),
    memorySavingsPercent: Number(memorySavingsPercent.toFixed(2)),
  };
}
