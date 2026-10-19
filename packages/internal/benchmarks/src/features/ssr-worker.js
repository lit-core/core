#!/usr/bin/env node
// @ts-nocheck
import { performance } from 'node:perf_hooks';
import zlib from 'node:zlib';

/**
 * Worker process for executing SSR benchmarks in clean process isolation.
 * Prevents DOM shim pollution from @lit-labs/ssr leaking into @lit-core/ssr runs.
 *
 * Usage: node --expose-gc ssr-worker.js <suiteId> <engine>
 * engine: 'core' | 'labs'
 * suiteId: 'carbon' | 'spectrum' | 'material'
 */

const suiteId = process.argv[2] || 'carbon';
const engine = process.argv[3] || 'core';

async function setupEnvironment(targetEngine) {
  if (targetEngine === 'core') {
    const { installIsolateGlobals, render, renderToStream, collectResult } = await import('@lit-core/ssr');
    installIsolateGlobals();

    const { html } = await import('lit');
    return {
      engine: 'core',
      render: (tpl) => render(tpl, { customElements }),
      renderToStream: (tpl) => renderToStream(tpl, { customElements }),
      collectResult: (tpl) => collectResult(render(tpl, { customElements })),
      html,
    };
  }

  // Legacy @lit-labs/ssr
  await import('@lit-labs/ssr/lib/install-global-dom-shim.js');
  const shim = await import('@lit-labs/ssr-dom-shim');
  if (shim.HTMLElement && !shim.HTMLElement.prototype.querySelector) {
    shim.HTMLElement.prototype.querySelector = () => null;
    shim.HTMLElement.prototype.querySelectorAll = () => [];
  }

  globalThis.window = globalThis.window || globalThis;
  globalThis.window.__swc = globalThis.window.__swc || { issuedWarnings: new Set() };
  globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
  globalThis.Node = shim.Node || globalThis.Node || class Node {};
  if (!globalThis.Node.DOCUMENT_FRAGMENT_NODE) globalThis.Node.DOCUMENT_FRAGMENT_NODE = 11;
  if (globalThis.document && !globalThis.document.documentElement) {
    globalThis.document.documentElement = {
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      setAttribute() {},
      removeAttribute() {},
      hasAttribute() {
        return false;
      },
      lang: 'en-US',
    };
  }
  if (shim.document && !shim.document.documentElement) {
    shim.document.documentElement = {
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      setAttribute() {},
      removeAttribute() {},
      hasAttribute() {
        return false;
      },
      lang: 'en-US',
    };
  }
  globalThis.MutationObserver =
    globalThis.MutationObserver ||
    class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  globalThis.IntersectionObserver =
    globalThis.IntersectionObserver ||
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };

  const labsSsr = await import('@lit-labs/ssr');
  const { RenderResultReadable } = await import('@lit-labs/ssr/lib/render-result-readable.js');
  const { Readable } = await import('node:stream');
  const { html } = await import('lit');

  function toWebStream(tpl) {
    const nodeStream = new RenderResultReadable(labsSsr.render(tpl));
    return Readable.toWeb(nodeStream);
  }

  return {
    engine: 'labs',
    render: (tpl) => labsSsr.render(tpl),
    renderToStream: (tpl) => toWebStream(tpl),
    collectResult: async (tpl) => {
      let result = '';
      for (const chunk of labsSsr.render(tpl)) {
        result += chunk;
      }
      return result;
    },
    html,
  };
}

async function loadSuiteWorkload(targetSuite, html) {
  if (targetSuite === 'carbon') {
    await import('@carbon/web-components/es/components/button/index.js');
    await import('@carbon/web-components/es/components/tag/index.js');
    await import('@carbon/web-components/es/components/progress-bar/index.js');
    await import('@carbon/web-components/es/components/tile/index.js');

    return {
      name: 'IBM Carbon Web Components',
      packageName: '@carbon/web-components',
      componentCount: 4,
      template: html`
        <cds-tile class="metric-card">
          <div class="card-header">
            <span class="metric-name">Production cluster telemetry</span>
            <cds-tag type="warm-gray">Healthy</cds-tag>
          </div>
          <div class="metric-value">99.98%</div>
          <cds-progress-bar value="78" max="100"></cds-progress-bar>
          <div class="card-actions">
            <cds-button kind="primary" size="sm">Scale</cds-button>
            <cds-button kind="secondary" size="sm">Inspect</cds-button>
          </div>
        </cds-tile>
      `,
    };
  }

  if (targetSuite === 'spectrum') {
    await import('@spectrum-web-components/button/sp-button.js');
    await import('@spectrum-web-components/badge/sp-badge.js');
    await import('@spectrum-web-components/tabs/sp-tabs.js');
    await import('@spectrum-web-components/tabs/sp-tab.js');

    return {
      name: 'Adobe Spectrum Web Components',
      packageName: '@spectrum-web-components/bundle',
      componentCount: 4,
      template: html`
        <div class="metric-card">
          <sp-tabs selected="overview">
            <sp-tab value="overview" label="Overview"></sp-tab>
            <sp-tab value="nodes" label="Cluster nodes"></sp-tab>
          </sp-tabs>
          <div class="card-header">
            <span class="metric-name">Production cluster telemetry</span>
            <sp-badge variant="positive">Healthy</sp-badge>
          </div>
          <div class="metric-value">99.98%</div>
          <div class="card-actions">
            <sp-button variant="accent" size="s">Scale</sp-button>
            <sp-button variant="secondary" size="s">Inspect</sp-button>
          </div>
        </div>
      `,
    };
  }

  // Material
  await import('@material/web/button/filled-button.js');
  await import('@material/web/button/outlined-button.js');
  await import('@material/web/labs/badge/badge.js');
  await import('@material/web/progress/linear-progress.js');
  await import('@material/web/elevation/elevation.js');

  return {
    name: 'Google Material Web',
    packageName: '@material/web',
    componentCount: 5,
    template: html`
      <div class="metric-card" style="position:relative;">
        <md-elevation></md-elevation>
        <div class="card-header">
          <span class="metric-name">Production cluster telemetry</span>
          <md-badge value="Healthy"></md-badge>
        </div>
        <div class="metric-value">99.98%</div>
        <md-linear-progress value="0.78"></md-linear-progress>
        <div class="card-actions">
          <md-filled-button>Scale</md-filled-button>
          <md-outlined-button>Inspect</md-outlined-button>
        </div>
      </div>
    `,
  };
}

async function runMeasurements() {
  const runner = await setupEnvironment(engine);
  const workload = await loadSuiteWorkload(suiteId, runner.html);
  const tpl = workload.template;

  // 1. Warm-up phase (100 unmeasured renders to prime V8 JIT inline caches)
  for (let i = 0; i < 100; i++) {
    for (const _ of runner.render(tpl)) {
    }
  }

  // 2. Throughput measurement: pure rendering serialization
  const throughputIters = 500;
  const t0 = performance.now();
  for (let i = 0; i < throughputIters; i++) {
    for (const _ of runner.render(tpl)) {
    }
  }
  const throughputElapsedMs = performance.now() - t0;
  const rendersPerSec = Number(((throughputIters / throughputElapsedMs) * 1000).toFixed(1));

  // 3. In-memory Web Standards request pipeline throughput
  const requestIters = 250;
  // Warmup request pipeline
  for (let i = 0; i < 25; i++) {
    const s = runner.renderToStream(tpl);
    const res = new Response(/** @type {any} */ (s));
    await res.text();
  }
  const reqT0 = performance.now();
  for (let i = 0; i < requestIters; i++) {
    const s = runner.renderToStream(tpl);
    const res = new Response(/** @type {any} */ (s));
    await res.text();
  }
  const requestElapsedMs = performance.now() - reqT0;
  const requestsPerSec = Number(((requestIters / requestElapsedMs) * 1000).toFixed(1));

  // 4. Memory measurement under sustained load with GC calibration
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
  const baseHeapBytes = process.memoryUsage().heapUsed;
  let peakHeapBytes = baseHeapBytes;
  const memIters = 1000;

  for (let i = 0; i < memIters; i++) {
    for (const _ of runner.render(tpl)) {
    }
    if (i % 50 === 0) {
      const cur = process.memoryUsage().heapUsed;
      if (cur > peakHeapBytes) peakHeapBytes = cur;
    }
  }

  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
  const retainedHeapBytes = process.memoryUsage().heapUsed;
  const peakDeltaBytes = Math.max(0, peakHeapBytes - baseHeapBytes);
  const retainedDeltaBytes = Math.max(0, retainedHeapBytes - baseHeapBytes);
  const allocPer1kRendersBytes = peakDeltaBytes;

  // 5. Streaming TTFB and chunk metrics (multi-sample median across 20 iterations to eliminate GC/JIT spikes)
  const ttfbSamples = [];
  const ttlbSamples = [];
  const ttfbIters = 20;
  let lastChunkCount = 0;
  let lastTotalChunkBytes = 0;

  // Warm up stream generator pipeline (3 iterations)
  for (let w = 0; w < 3; w++) {
    const warmStream = runner.renderToStream(tpl);
    const warmReader = warmStream.getReader();
    await warmReader.read();
    while (true) {
      const { done } = await warmReader.read();
      if (done) break;
    }
    warmReader.releaseLock();
  }

  // Collect multi-sample measurements
  for (let i = 0; i < ttfbIters; i++) {
    const sT0 = performance.now();
    const stream = runner.renderToStream(tpl);
    const reader = stream.getReader();
    const firstChunk = await reader.read();
    const sampleTtfb = performance.now() - sT0;
    ttfbSamples.push(sampleTtfb);

    let chunks = 1;
    let bytes = firstChunk.value ? firstChunk.value.length : 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks++;
      bytes += value ? value.length : 0;
    }
    const sampleTtlb = performance.now() - sT0;
    ttlbSamples.push(sampleTtlb);
    reader.releaseLock();

    lastChunkCount = chunks;
    lastTotalChunkBytes = bytes;
  }

  // Compute median values
  ttfbSamples.sort((a, b) => a - b);
  ttlbSamples.sort((a, b) => a - b);
  const midIdx = Math.floor(ttfbIters / 2);
  const medianTtfb = ttfbIters % 2 === 0 ? (ttfbSamples[midIdx - 1] + ttfbSamples[midIdx]) / 2 : ttfbSamples[midIdx];
  const medianTtlb = ttfbIters % 2 === 0 ? (ttlbSamples[midIdx - 1] + ttlbSamples[midIdx]) / 2 : ttlbSamples[midIdx];

  const ttfbMs = Number(medianTtfb.toFixed(4));
  const ttlbMs = Number(medianTtlb.toFixed(4));
  const chunkCount = lastChunkCount;
  const avgChunkBytes = chunkCount > 0 ? Number((lastTotalChunkBytes / chunkCount).toFixed(0)) : 0;

  // 6. Serialized HTML payload analysis
  const renderedHtml = await runner.collectResult(tpl);
  const markerRegex = /<!--\/?lit-[a-z0-9_-]+(?:\s[\s\S]*?)?-->/gi;
  const commentMarkersCount = (renderedHtml.match(markerRegex) || []).length;
  const rawBytes = Buffer.byteLength(renderedHtml, 'utf8');
  const gzipBytes = zlib.gzipSync(Buffer.from(renderedHtml, 'utf8'), { level: 9 }).length;
  const brotliBytes = zlib.brotliCompressSync(Buffer.from(renderedHtml, 'utf8')).length;
  const hasDeclarativeShadowDom = renderedHtml.includes('shadowrootmode="open"') || renderedHtml.includes('shadowroot="open"');

  const result = {
    suiteId,
    engine,
    name: workload.name,
    packageName: workload.packageName,
    componentCount: workload.componentCount,
    throughput: {
      rendersPerSec,
      requestsPerSec,
      elapsedMs: throughputElapsedMs,
      iterations: throughputIters,
    },
    memory: {
      baseHeapBytes,
      peakHeapBytes,
      retainedHeapBytes,
      peakDeltaBytes,
      retainedDeltaBytes,
      allocPer1kRendersBytes,
    },
    streaming: {
      ttfbMs,
      ttlbMs,
      chunkCount,
      avgChunkBytes,
    },
    payload: {
      rawBytes,
      gzipBytes,
      brotliBytes,
      commentMarkersCount,
      hasDeclarativeShadowDom,
      sampleLength: renderedHtml.length,
    },
  };

  if (typeof process.send === 'function') {
    process.send(result, (err) => {
      if (err) {
        console.error(`[ssr-worker error] Failed to send IPC result:`, err);
        process.exit(1);
      }
      process.exit(0);
    });

    // Safety timeout in case IPC callback does not fire
    setTimeout(() => {
      process.exit(0);
    }, 500).unref();
  } else {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }
}

runMeasurements()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[ssr-worker error] Failed ${engine} execution on ${suiteId}:`, err);
    process.exit(1);
  });
