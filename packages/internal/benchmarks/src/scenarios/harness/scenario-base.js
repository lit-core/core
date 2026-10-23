import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { getFileSizes } from '../../metrics.js';
import { closeBrowser, getBrowser } from '../../runtime.js';
import { CANONICAL_COMPONENT_IDS, CANONICAL_SUITE_DEFINITIONS } from '../../suites/canonical-components.js';
import { createBenchmarkVendorResolverPlugin } from '../../vendor-resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../../../../..');

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
 * Defaults to all 20 canonical components if concepts is not provided.
 * @param {string} suiteId
 * @param {string[]} [concepts]
 * @returns {Array<{ concept: string, tag: string, path: string, importStatement: string }>}
 */
export function resolveScenarioComponents(suiteId, concepts) {
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[suiteId];
  if (!suiteDef) {
    throw new Error(`Unknown suite ID for canonical components: ${suiteId}`);
  }

  const targetConcepts = concepts && concepts.length > 0 ? concepts : CANONICAL_COMPONENT_IDS;
  const results = [];
  for (const concept of targetConcepts) {
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
    plugins: [createBenchmarkVendorResolverPlugin(), ...plugins],
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
 * Recursively compare two serialized DOM node trees.
 * @param {any} base
 * @param {any} variant
 * @param {string} [path='root']
 * @returns {{ match: boolean, reason: string | null }}
 */
export function compareDomTrees(base, variant, path = 'root') {
  if (!base && !variant) return { match: true, reason: null };
  if (!base || !variant) {
    return {
      match: false,
      reason: `Node existence mismatch at ${path}: baseline is ${base ? 'present' : 'absent'}, variant is ${variant ? 'present' : 'absent'}`,
    };
  }
  if (base.type !== variant.type) {
    return {
      match: false,
      reason: `Node type mismatch at ${path}: baseline="${base.type}", variant="${variant.type}"`,
    };
  }
  if (base.type === 'text') {
    if (base.value !== variant.value) {
      return {
        match: false,
        reason: `Text content mismatch at ${path}: baseline="${base.value}", variant="${variant.value}"`,
      };
    }
    return { match: true, reason: null };
  }
  if (base.tag !== variant.tag) {
    return {
      match: false,
      reason: `Tag name mismatch at ${path}: baseline=<${base.tag}>, variant=<${variant.tag}>`,
    };
  }

  // Compare attributes
  const baseAttrs = base.attributes || {};
  const varAttrs = variant.attributes || {};
  const baseKeys = Object.keys(baseAttrs).sort();
  for (const key of baseKeys) {
    if (key === 'style') {
      const baseStyle = (baseAttrs[key] || '')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*;\s*/g, ';')
        .replace(/\s+/g, ' ')
        .trim();
      const varStyle = (varAttrs[key] || '')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*;\s*/g, ';')
        .replace(/\s+/g, ' ')
        .trim();
      if (baseStyle !== varStyle) {
        return {
          match: false,
          reason: `Style attribute mismatch at ${path} (<${base.tag}>): baseline="${baseStyle}", variant="${varStyle}"`,
        };
      }
      continue;
    }
    if (baseAttrs[key] !== varAttrs[key]) {
      return {
        match: false,
        reason: `Attribute "${key}" mismatch at ${path} (<${base.tag}>): baseline="${baseAttrs[key]}", variant="${varAttrs[key]}"`,
      };
    }
  }
  for (const key of Object.keys(varAttrs)) {
    if (!(key in baseAttrs)) {
      return {
        match: false,
        reason: `Unexpected attribute "${key}" in variant at ${path} (<${base.tag}>): value="${varAttrs[key]}"`,
      };
    }
  }

  // Compare shadow root
  if (Boolean(base.shadowRoot) !== Boolean(variant.shadowRoot)) {
    return {
      match: false,
      reason: `Shadow root presence mismatch at ${path} (<${base.tag}>): baseline has ${base.shadowRoot ? 'open shadow root' : 'none'}, variant has ${variant.shadowRoot ? 'open shadow root' : 'none'}`,
    };
  }
  if (base.shadowRoot && variant.shadowRoot) {
    const baseShadowChildren = base.shadowRoot.children || [];
    const varShadowChildren = variant.shadowRoot.children || [];
    if (baseShadowChildren.length !== varShadowChildren.length) {
      return {
        match: false,
        reason: `Shadow root child count mismatch at ${path} (<${base.tag}>): baseline has ${baseShadowChildren.length}, variant has ${varShadowChildren.length}`,
      };
    }
    for (let i = 0; i < baseShadowChildren.length; i++) {
      const res = compareDomTrees(baseShadowChildren[i], varShadowChildren[i], `${path} > shadowRoot > [${i}]`);
      if (!res.match) return res;
    }
  }

  // Compare light DOM children
  const baseChildren = base.children || [];
  const varChildren = variant.children || [];
  if (baseChildren.length !== varChildren.length) {
    return {
      match: false,
      reason: `Light DOM child count mismatch at ${path} (<${base.tag}>): baseline has ${baseChildren.length}, variant has ${varChildren.length}`,
    };
  }
  for (let i = 0; i < baseChildren.length; i++) {
    const res = compareDomTrees(baseChildren[i], varChildren[i], `${path} > [${i}]`);
    if (!res.match) return res;
  }

  return { match: true, reason: null };
}

/**
 * Compare two DOM snapshots (both mount and update phases).
 * @param {any} baselineSnapshot
 * @param {any} variantSnapshot
 * @returns {{
 *   domStructureMatch: boolean,
 *   elementsCount: number,
 *   verified: boolean,
 *   divergenceReason?: string | null,
 *   phasesMatched: { mount: boolean, update: boolean }
 * }}
 */
export function compareDomSnapshots(baselineSnapshot, variantSnapshot) {
  if (!baselineSnapshot || !variantSnapshot) {
    return {
      domStructureMatch: false,
      elementsCount: variantSnapshot?.elementsCount || 0,
      verified: false,
      divergenceReason: 'Missing baseline or variant DOM snapshot',
      phasesMatched: { mount: false, update: false },
    };
  }

  const mountComparison = compareDomTrees(baselineSnapshot.mount, variantSnapshot.mount, 'mount-root');
  const updateComparison = compareDomTrees(baselineSnapshot.update, variantSnapshot.update, 'update-root');
  const shadowCountMatch = (baselineSnapshot.shadowRootsCount ?? 0) === (variantSnapshot.shadowRootsCount ?? 0);
  const customElementCountMatch = (baselineSnapshot.customElementsCount ?? 0) === (variantSnapshot.customElementsCount ?? 0);
  const domStructureMatch = mountComparison.match && updateComparison.match && shadowCountMatch && customElementCountMatch;
  const elementsCount = variantSnapshot.elementsCount || 0;
  const verified = domStructureMatch && elementsCount > 0;

  let divergenceReason = null;
  if (!mountComparison.match) {
    divergenceReason = `Mount phase divergence: ${mountComparison.reason}`;
  } else if (!updateComparison.match) {
    divergenceReason = `Update phase divergence: ${updateComparison.reason}`;
  } else if (!shadowCountMatch) {
    divergenceReason = `ShadowRoot count mismatch: baseline=${baselineSnapshot.shadowRootsCount}, variant=${variantSnapshot.shadowRootsCount}`;
  } else if (!customElementCountMatch) {
    divergenceReason = `Custom element count mismatch: baseline=${baselineSnapshot.customElementsCount}, variant=${variantSnapshot.customElementsCount}`;
  }

  return {
    domStructureMatch,
    elementsCount,
    verified,
    ...(divergenceReason ? { divergenceReason } : {}),
    phasesMatched: {
      mount: mountComparison.match,
      update: updateComparison.match,
    },
  };
}

/**
 * Measure runtime performance of a scenario bundle in headless Chromium via Playwright.
 * @param {Object} params
 * @param {string} params.bundlePath
 * @param {string} params.scenarioName
 * @param {string} [params.variantName='Variant']
 * @param {any} [params.baselineSnapshot]
 * @returns {Promise<{
 *   runtime: import('../../types.js').RuntimeMetrics,
 *   scenarioSpecific: Record<string, any>,
 *   domSnapshot: any,
 *   equivalence: { domStructureMatch: boolean, elementsCount: number, verified: boolean, divergenceReason?: string | null, phasesMatched: { mount: boolean, update: boolean } }
 * }>}
 */
export async function measureScenarioRuntime({ bundlePath, scenarioName, variantName = 'Variant', baselineSnapshot = null }) {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`[Scenario benchmark error] Bundle file not found at "${bundlePath}" for ${scenarioName} (${variantName})`);
  }

  let context = null;
  let page = null;
  try {
    await closeBrowser();
    const browser = await getBrowser();
    if (!browser || (typeof browser.isConnected === 'function' && !browser.isConnected())) {
      throw new Error(`[Scenario benchmark error] Chromium browser is not available or disconnected for ${scenarioName} (${variantName})`);
    }

    context = await browser.newContext();
    page = await context.newPage();

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

    // Seed PRNG and crypto deterministically so component auto-IDs match between runs
    let __seed = 0x2f6e2b1;
    Math.random = function() {
      __seed = (__seed * 1664525 + 1013904223) >>> 0;
      return __seed / 0x100000000;
    };
    if (typeof crypto !== 'undefined') {
      let __uuidSeq = 0;
      try {
        crypto.randomUUID = function() {
          __uuidSeq++;
          const hex = __uuidSeq.toString(16).padStart(12, '0');
          return '00000000-0000-4000-8000-' + hex;
        };
      } catch {}
      try {
        crypto.getRandomValues = function(buf) {
          for (let i = 0; i < buf.length; i++) {
            __seed = (__seed * 1664525 + 1013904223) >>> 0;
            buf[i] = __seed & 0xff;
          }
          return buf;
        };
      } catch {}
    }

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

    if (typeof window.gc === 'function') window.gc();
    window.__heapBeforeEval = window.performance?.memory?.usedJSHeapSize || 0;
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
    await page.waitForFunction(() => /** @type {any} */ (window).__bundleReady === true, { timeout: 15000 });

    if (runtimeErrors.length > 0) {
      throw new Error(`Scenario runtime failure during evaluation of ${scenarioName} (${variantName}):\n${runtimeErrors.join('\n')}`);
    }

    const result = await page.evaluate(async () => {
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

      /**
       * Recursively serialize DOM tree and open shadow roots.
       * @param {Node | null} node
       * @param {number} depth
       * @param {number} maxDepth
       * @returns {any}
       */
      function serializeDomTree(node, depth = 0, maxDepth = 30) {
        if (depth > maxDepth || !node) return null;
        if (node.nodeType === 3 /* Node.TEXT_NODE */) {
          const text = (node.textContent || '').trim();
          return text ? { type: 'text', value: text } : null;
        }
        if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return null;

        const el = /** @type {Element} */ (node);
        const tag = el.tagName.toLowerCase();
        /** @type {Record<string, string>} */
        const attributes = {};
        const attrNames = Array.from(el.attributes || [])
          .map((a) => a.name)
          .filter((n) => !n.startsWith('__') && !n.startsWith('data-lh-') && !n.startsWith('data-lit-'))
          .sort();

        for (const name of attrNames) {
          const rawVal = el.getAttribute(name) || '';
          if (name === 'class') {
            attributes[name] = rawVal.trim().split(/\s+/).join(' ');
          } else if (tag === 'wa-tab-group' && name === 'active' && (rawVal === '' || rawVal === 'undefined' || rawVal === 'overview')) {
            attributes[name] = 'overview';
          } else if (name === 'id' || name === 'name' || name === 'for' || name.startsWith('aria-')) {
            attributes[name] = rawVal.replace(/\b(sp-help-text-|pass-through-help-text-|wa-tooltip-|wa-popover-|mdc-el-|cds-id-)[a-zA-Z0-9_-]+/g, '$1<id>');
          } else {
            attributes[name] = rawVal;
          }
        }

        const children = [];
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = serializeDomTree(el.childNodes[i], depth + 1, maxDepth);
          if (child) children.push(child);
        }

        /** @type {any} */
        const res = { type: 'element', tag, attributes, children };
        if (el.shadowRoot) {
          const shadowChildren = [];
          for (let i = 0; i < el.shadowRoot.childNodes.length; i++) {
            const child = serializeDomTree(el.shadowRoot.childNodes[i], depth + 1, maxDepth);
            if (child) shadowChildren.push(child);
          }
          res.shadowRoot = { mode: el.shadowRoot.mode, children: shadowChildren };
        }
        return res;
      }

      // Settle event loop and initial microtasks
      if (typeof win.gc === 'function') win.gc();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));
      if (typeof win.gc === 'function') win.gc();

      let firstRenderMs = 0;
      let updateMs = 0;
      let scenarioSpecific = {};
      let mountSnapshot = null;
      let updateSnapshot = null;
      let heapUsed = 0;

      if (win.__scenario && typeof win.__scenario.mount === 'function') {
        const t0 = performance.now();
        await win.__scenario.mount(container);
        void container.offsetHeight;
        firstRenderMs = Math.max(0.1, performance.now() - t0);
        mountSnapshot = serializeDomTree(container);

        if (typeof win.__scenario.update === 'function') {
          // Warmup update + capture post-update snapshot & metrics
          await win.__scenario.update(container);
          void container.offsetHeight;
          if (typeof win.__scenario.getMetrics === 'function') {
            scenarioSpecific = await win.__scenario.getMetrics(container);
          }
          updateSnapshot = serializeDomTree(container);

          // Sample reactive update latency across 5 warm batches of 10 updates
          // (eliminates Chromium performance.now() 0.1ms quantization noise)
          if (typeof win.gc === 'function') win.gc();
          const UPDATE_BATCH = 10;
          const updateSamples = [];
          for (let uIdx = 0; uIdx < 5; uIdx++) {
            const t1 = performance.now();
            for (let b = 0; b < UPDATE_BATCH; b++) {
              await win.__scenario.update(container);
            }
            void container.offsetHeight;
            updateSamples.push(Math.max(0.05, (performance.now() - t1) / UPDATE_BATCH));
          }
          updateSamples.sort((a, b) => a - b);
          updateMs = Number(updateSamples[1].toFixed(2));
        } else {
          if (typeof win.__scenario.getMetrics === 'function') {
            scenarioSpecific = await win.__scenario.getMetrics(container);
          }
          updateSnapshot = mountSnapshot;
        }

        let minHeapDelta = Infinity;
        for (let sampleIdx = 0; sampleIdx < 2; sampleIdx++) {
          delete (/** @type {any} */ (container)._$litPart$);
          container.innerHTML = '';
          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 25)));
          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => setTimeout(r, 15));
          if (typeof win.gc === 'function') win.gc();
          const heapBefore = win.performance?.memory?.usedJSHeapSize || 0;

          await win.__scenario.mount(container);
          void container.offsetHeight;

          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => setTimeout(r, 15));
          if (typeof win.gc === 'function') win.gc();
          const heapAfter = win.performance?.memory?.usedJSHeapSize || 0;
          const delta = Math.round(heapAfter - heapBefore);
          if (delta >= 1024 && delta < minHeapDelta) {
            minHeapDelta = delta;
          }
        }
        heapUsed = Number.isFinite(minHeapDelta) ? minHeapDelta : 1024;
      } else {
        const tags = (win.__registeredTags || []).filter((/** @type {any} */ t) => typeof t === 'string' && t.includes('-'));
        const mounted = [];
        const t0 = performance.now();
        for (const tag of tags) {
          const el = document.createElement(tag);
          container.appendChild(el);
          mounted.push(el);
        }
        await Promise.all(mounted.map(safeUpdateComplete));
        void container.offsetHeight;
        firstRenderMs = Math.max(0.1, performance.now() - t0);

        const t1 = performance.now();
        for (let i = 0; i < mounted.length; i++) {
          const el = mounted[i];
          if ('disabled' in el) el.disabled = i % 2 === 0;
          if ('value' in el) el.value = `Updated ${i}`;
        }
        await Promise.all(mounted.map(safeUpdateComplete));
        void container.offsetHeight;
        updateMs = Math.max(0.1, performance.now() - t1);

        updateSnapshot = serializeDomTree(container);

        mounted.length = 0;
        let minHeapDelta = Infinity;
        for (let sampleIdx = 0; sampleIdx < 2; sampleIdx++) {
          container.innerHTML = '';
          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 25)));
          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => setTimeout(r, 15));
          if (typeof win.gc === 'function') win.gc();
          const heapBefore = win.performance?.memory?.usedJSHeapSize || 0;

          const remounted = [];
          for (const tag of tags) {
            const el = document.createElement(tag);
            container.appendChild(el);
            remounted.push(el);
          }
          await Promise.all(remounted.map(safeUpdateComplete));
          void container.offsetHeight;

          if (typeof win.gc === 'function') win.gc();
          await new Promise((r) => setTimeout(r, 15));
          if (typeof win.gc === 'function') win.gc();
          const heapAfter = win.performance?.memory?.usedJSHeapSize || 0;
          const delta = Math.round(heapAfter - heapBefore);
          if (delta >= 1024 && delta < minHeapDelta) {
            minHeapDelta = delta;
          }
        }
        heapUsed = Number.isFinite(minHeapDelta) ? minHeapDelta : 1024;

        mountSnapshot = serializeDomTree(container);
      }

      // Collect overall element and shadow root counters
      const allElements = Array.from(container.querySelectorAll('*'));
      let shadowRootsCount = 0;
      for (const el of allElements) {
        if (el.shadowRoot) shadowRootsCount++;
      }
      const customElements = allElements.filter((el) => el.tagName.includes('-'));

      return {
        runtime: {
          firstRenderMs: Number(firstRenderMs.toFixed(2)),
          updateMs: Number(updateMs.toFixed(2)),
          scriptEvalMs: Number(evalMs.toFixed(2)),
          registrationMs: Number(regMs.toFixed(2)),
          heapUsedBytes: heapUsed,
        },
        scenarioSpecific,
        domSnapshot: {
          mount: mountSnapshot,
          update: updateSnapshot,
          elementsCount: allElements.length,
          customElementsCount: customElements.length,
          shadowRootsCount,
        },
      };
    });

    const equivalence = baselineSnapshot
      ? compareDomSnapshots(baselineSnapshot, result.domSnapshot)
      : {
          domStructureMatch: (result.domSnapshot?.elementsCount || 0) > 0,
          elementsCount: result.domSnapshot?.elementsCount || 0,
          verified: (result.domSnapshot?.elementsCount || 0) > 0,
          phasesMatched: { mount: true, update: true },
        };

    return {
      runtime: result.runtime,
      scenarioSpecific: result.scenarioSpecific,
      domSnapshot: result.domSnapshot,
      equivalence,
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
    await closeBrowser();
  }
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
