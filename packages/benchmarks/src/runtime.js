import fs from 'node:fs';
import { chromium } from 'playwright';

/**
 * @typedef {Object} RuntimeMetric
 * @property {string} name
 * @property {number} firstRenderMs
 * @property {number} updateMs
 * @property {number} [speedupPercent]
 * @property {boolean} [isBaseline]
 * @property {boolean} [isTotal]
 */

/** @type {import('playwright').Browser | null} */
let browserInstance = null;

export async function getBrowser() {
  if (!browserInstance) {
    try {
      browserInstance = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (_err) {
      // Browser launch unavailable in restricted/sandboxed environment
      return null;
    }
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}

/**
 * Benchmark runtime performance of a built bundle using Playwright with real DOM instantiation.
 * @param {string} bundlePath - Absolute path to bundle.js
 * @param {string} [name='Bundle'] - Display name
 * @returns {Promise<{ firstRenderMs: number, updateMs: number }>}
 */
export async function measureBundleRuntime(bundlePath, name = 'Bundle') {
  if (!fs.existsSync(bundlePath)) {
    return { firstRenderMs: 0, updateMs: 0 };
  }

  const bundleCode = fs.readFileSync(bundlePath, 'utf-8');
  let browser = null;
  try {
    browser = await getBrowser();
  } catch {}

  if (!browser) {
    // If browser cannot launch in the current environment, report 0 (unmeasured)
    // rather than generating fabricated or synthetic speedup numbers.
    return { firstRenderMs: 0, updateMs: 0 };
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
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
    const origDefine = customElements.define;
    customElements.define = function(tag, constructor, options) {
      if (!window.__registeredTags.includes(tag)) {
        window.__registeredTags.push(tag);
      }
      return origDefine.call(customElements, tag, constructor, options);
    };
    try {
      ${bundleCode}
    } catch (e) {
      console.warn("Bundle execution warning:", e.message);
    }
    window.__bundleReady = true;
  </script>
</body>
</html>`;

    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__bundleReady === true, { timeout: 10000 }).catch(() => {});

    // Execute precision in-browser rendering measurement using actual defined elements
    const timing = await page.evaluate(async () => {
      const container = document.getElementById('container');
      if (!container) return { firstRenderMs: 0, updateMs: 0 };

      const tags = (window.__registeredTags || []).filter((t) => typeof t === 'string' && t.includes('-'));
      if (tags.length === 0) {
        return { firstRenderMs: 0, updateMs: 0 };
      }

      const iterations = 5;
      const mountSamples = [];
      const updateSamples = [];

      for (let run = 0; run < iterations; run++) {
        container.innerHTML = '';
        const mountedElements = [];

        // 1. Mount phase: instantiate real registered Custom Elements from the bundle
        const t0 = performance.now();
        const maxInstances = 50;
        for (let i = 0; i < maxInstances; i++) {
          const tag = tags[i % tags.length];
          try {
            const el = document.createElement(tag);
            el.setAttribute('data-bench-index', String(i));
            container.appendChild(el);
            mountedElements.push(el);
          } catch {}
        }

        // Wait for Lit element updateComplete lifecycle if available
        await Promise.all(
          mountedElements.map((el) => {
            if (el && typeof el.updateComplete?.then === 'function') {
              return el.updateComplete;
            }
            return Promise.resolve();
          }),
        );

        // Force layout calculation
        void container.offsetHeight;
        const t1 = performance.now();
        mountSamples.push(t1 - t0);

        // 2. Re-render / update phase
        const t2 = performance.now();
        for (let i = 0; i < mountedElements.length; i++) {
          const child = mountedElements[i];
          if (child) {
            child.setAttribute('data-active', i % 2 === 0 ? 'true' : 'false');
            if ('label' in child) {
              try {
                child.label = 'Updated ' + i;
              } catch {}
            }
            if ('value' in child) {
              try {
                child.value = 'Val ' + i;
              } catch {}
            }
          }
        }

        await Promise.all(
          mountedElements.map((el) => {
            if (el && typeof el.updateComplete?.then === 'function') {
              return el.updateComplete;
            }
            return Promise.resolve();
          }),
        );

        void container.offsetHeight;
        const t3 = performance.now();
        updateSamples.push(t3 - t2);
      }

      container.innerHTML = '';

      mountSamples.sort((a, b) => a - b);
      updateSamples.sort((a, b) => a - b);
      const medianMount = mountSamples[Math.floor(mountSamples.length / 2)] || 0;
      const medianUpdate = updateSamples[Math.floor(updateSamples.length / 2)] || 0;

      return {
        firstRenderMs: Number(medianMount.toFixed(2)),
        updateMs: Number(medianUpdate.toFixed(2)),
      };
    });

    return timing;
  } catch (err) {
    console.warn(`[Runtime Benchmark] Measurement error for ${name}:`, err.message);
    return { firstRenderMs: 0, updateMs: 0 };
  } finally {
    await page.close();
    await context.close();
  }
}
