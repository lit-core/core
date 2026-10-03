import fs from 'node:fs';
import { closeSharedBrowser, getSharedBrowser } from '@lit-core/test-kit';

/**
 * @typedef {Object} RuntimeMetric
 * @property {string} name
 * @property {number} firstRenderMs
 * @property {number} updateMs
 * @property {number} [scriptEvalMs]
 * @property {number} [registrationMs]
 * @property {number} [heapUsedBytes]
 * @property {number} [speedupPercent]
 * @property {number} [updateSpeedupPercent]
 * @property {number} [evalSpeedupPercent]
 * @property {number} [memorySavingsPercent]
 * @property {boolean} [isBaseline]
 * @property {boolean} [isTotal]
 */

/**
 * Return default zero-valued runtime metrics for fallback scenarios.
 * @returns {{ firstRenderMs: number, updateMs: number, scriptEvalMs: number, registrationMs: number, heapUsedBytes: number }}
 */
export function emptyRuntimeMetrics() {
  return {
    firstRenderMs: 0,
    updateMs: 0,
    scriptEvalMs: 0,
    registrationMs: 0,
    heapUsedBytes: 0,
  };
}

export async function getBrowser() {
  return getSharedBrowser();
}

export async function closeBrowser() {
  return closeSharedBrowser();
}

/**
 * Benchmark runtime performance of a built bundle using Playwright with real DOM instantiation.
 * @param {string} bundlePath - Absolute path to bundle.js
 * @param {string} [name='Bundle'] - Display name
 * @returns {Promise<{ firstRenderMs: number, updateMs: number, scriptEvalMs: number, registrationMs: number, heapUsedBytes: number }>}
 */
export async function measureBundleRuntime(bundlePath, name = 'Bundle') {
  if (!fs.existsSync(bundlePath)) {
    return emptyRuntimeMetrics();
  }

  const bundleCode = fs.readFileSync(bundlePath, 'utf-8');
  let browser = null;
  try {
    browser = await getBrowser();
  } catch (err) {
    if (process.env.ALLOW_NO_BROWSER === '1' || process.argv.includes('--allow-no-browser')) {
      return emptyRuntimeMetrics();
    }
    throw new Error(
      `Chromium browser could not be launched during benchmark run for "${name}". ` +
        `Pass --allow-no-browser if running in a browser-less environment.\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!browser) {
    if (process.env.ALLOW_NO_BROWSER === '1' || process.argv.includes('--allow-no-browser')) {
      return emptyRuntimeMetrics();
    }
    throw new Error(`Chromium browser unavailable for "${name}". Pass --allow-no-browser to bypass.`);
  }

  const runtimeErrors = [];

  try {
    const page = await browser.newPage();

    page.on('pageerror', (err) => {
      runtimeErrors.push(`[Page Error] ${err.stack || err.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`[Console Error] ${msg.text()}`);
      }
    });

    // Generate isolated HTML page that intercepts customElements.define, runs bundleCode,
    // and measures real custom element lifecycle and template renders.
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Benchmark: ${name}</title>
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
    //# sourceURL=${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.bundle.js
  </script>
</body>
</html>`;

    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /** @type {any} */ (window).__bundleReady === true, { timeout: 15000 }).catch(() => {});

    if (runtimeErrors.length > 0) {
      throw new Error(`Runtime failure during bundle evaluation in ${name}:\n${runtimeErrors.join('\n')}`);
    }

    // Execute precision in-browser rendering measurement using actual defined elements
    const timing = await page.evaluate(async () => {
      const win = /** @type {any} */ (window);
      if (win.__bundleError) {
        throw new Error(`Bundle execution crashed: ${win.__bundleError}`);
      }

      const evalMs = win.__evalStart && win.__evalEnd ? Math.max(0, win.__evalEnd - win.__evalStart) : 0;
      const regMs = win.__registrationMs || 0;

      const container = document.getElementById('container');
      if (!container) throw new Error('Benchmark container not found');

      const tags = (win.__registeredTags || []).filter((/** @type {any} */ t) => typeof t === 'string' && t.includes('-'));
      if (tags.length === 0) {
        throw new Error('No custom elements registered by bundle');
      }

      /** @param {any} el */
      const safeUpdateComplete = (el) => {
        if (el && typeof el.updateComplete?.then === 'function') {
          return el.updateComplete;
        }
        return Promise.resolve();
      };

      // 1. Cold First Render: Measure on fresh page BEFORE any prior template instantiation
      container.innerHTML = '';
      const coldElements = [];
      const coldStart = performance.now();
      for (const tag of tags) {
        const el = document.createElement(tag);
        container.appendChild(el);
        coldElements.push(el);
      }
      await Promise.all(coldElements.map(safeUpdateComplete));
      void container.offsetHeight;
      const coldFirstRenderMs = performance.now() - coldStart;

      // 2. Warm Mount & Update iterations (interleaved)
      const iterations = 5;
      const mountSamples = [];
      const updateSamples = [];

      for (let run = 0; run < iterations; run++) {
        container.innerHTML = '';
        const mountedElements = [];

        const t0 = performance.now();
        for (const tag of tags) {
          const el = document.createElement(tag);
          container.appendChild(el);
          mountedElements.push(el);
        }
        await Promise.all(mountedElements.map(safeUpdateComplete));
        void container.offsetHeight;
        const t1 = performance.now();
        mountSamples.push(t1 - t0);

        // Update phase: exercise properties and attributes
        const t2 = performance.now();
        for (let i = 0; i < mountedElements.length; i++) {
          const child = mountedElements[i];
          if (child) {
            child.setAttribute('data-active', i % 2 === 0 ? 'true' : 'false');
            if ('disabled' in child) child.disabled = i % 2 === 0;
            if ('label' in child) child.label = `Updated ${i}`;
            if ('value' in child) child.value = `Val ${i}`;
          }
        }
        await Promise.all(mountedElements.map(safeUpdateComplete));
        void container.offsetHeight;
        const t3 = performance.now();
        updateSamples.push(t3 - t2);
      }

      container.innerHTML = '';

      // 3. Memory footprint measurement
      if (typeof win.gc === 'function') win.gc();
      const heapBefore = win.performance?.memory?.usedJSHeapSize || 0;

      const memElements = [];
      for (const tag of tags) {
        const el = document.createElement(tag);
        container.appendChild(el);
        memElements.push(el);
      }
      await Promise.all(memElements.map(safeUpdateComplete));
      void container.offsetHeight;

      if (typeof win.gc === 'function') win.gc();
      const heapAfter = win.performance?.memory?.usedJSHeapSize || 0;
      const heapUsedBytes = Math.max(0, Math.round(heapAfter - heapBefore));

      container.innerHTML = '';
      if (typeof win.gc === 'function') win.gc();

      mountSamples.sort((a, b) => a - b);
      updateSamples.sort((a, b) => a - b);
      const medianWarmMount = mountSamples[Math.floor(mountSamples.length / 2)] || 0;
      const medianUpdate = updateSamples[Math.floor(updateSamples.length / 2)] || 0;

      return {
        firstRenderMs: Number(coldFirstRenderMs.toFixed(2)),
        warmMountMs: Number(medianWarmMount.toFixed(2)),
        updateMs: Number(medianUpdate.toFixed(2)),
        scriptEvalMs: Number(evalMs.toFixed(2)),
        registrationMs: Number(regMs.toFixed(2)),
        heapUsedBytes,
      };
    });

    if (runtimeErrors.length > 0) {
      throw new Error(`Runtime failure during element lifecycle in ${name}:\n${runtimeErrors.join('\n')}`);
    }

    return timing;
  } catch (err) {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[Runtime Benchmark Error] Fatal failure for ${name}:`, msg);
    throw new Error(`[Runtime Benchmark Error] Fatal failure for ${name}:\n${msg}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}
