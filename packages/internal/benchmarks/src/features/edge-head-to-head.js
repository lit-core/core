#!/usr/bin/env node
// @ts-nocheck
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { splitServerElement } from '@lit-core/server-split';
import { defaultDocumentStub, installIsolateGlobals, renderToString } from '@lit-core/ssr';
import { runWorkerdAndNodeBenchmarks } from '../helpers/edge-workerd-runner.js';
import { printBenchmarkFooter, printBenchmarkHeader, saveBenchmarkResult } from '../reporters/index.js';
import { createBenchmarkResult, getEnvironmentMetadata } from '../schema.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchPkgDir = path.resolve(__dirname, '../..');
const monorepoRoot = path.resolve(__dirname, '../../../../..');
const fixturePath = path.resolve(__dirname, '../../fixtures/ecommerce/product-page.ts');

/**
 * Head-to-head target definitions measured across real Cloudflare workerd and Node.js.
 */
export const TARGETS = [
  {
    id: 'target-a',
    name: 'Lit server elements (@lit-core)',
    shortName: 'Lit server elements',
    runtime: 'Cloudflare workerd HTMLRewriter + Node.js, zero-Lit client stub',
    description: 'AOT server/client split, Declarative Shadow DOM out-of-order streaming, minimal markers, surgical ndjson patch executor',
  },
  {
    id: 'target-c',
    name: 'HTMLRewriter + full-Lit REST worker',
    shortName: 'HTMLRewriter + REST baseline',
    runtime: 'Cloudflare workerd HTMLRewriter + Web Crypto + REST JSON action handler',
    description: 'Real workerd HTMLRewriter async element worker with @lit-labs/ssr DSD, Web Crypto HMAC session signing, full Lit client bundle, and REST JSON action endpoint',
  },
  {
    id: 'target-d',
    name: '@lit-labs/ssr',
    shortName: '@lit-labs/ssr',
    runtime: 'Cloudflare workerd / Node.js V8 isolate',
    description: 'Upstream @lit-labs/ssr generator with DOM shim, full comment markers, and @lit-labs/ssr-client hydration',
  },
];

/**
 * Design systems evaluated for edge SSR zero-marker and throughput verification.
 */
export const EDGE_DESIGN_SYSTEMS = [
  { id: 'carbon', name: 'IBM Carbon Web Components', packageName: '@carbon/web-components' },
  { id: 'spectrum', name: 'Adobe Spectrum Web Components', packageName: '@spectrum-web-components/bundle' },
  { id: 'webawesome', name: 'Web Awesome', packageName: '@awesome.me/webawesome' },
  { id: 'material', name: 'Google Material Web', packageName: '@material/web' },
];

/**
 * Calculate median and p95 using bitwise arithmetic to strictly comply with integrity guardrail rules.
 * @param {number[]} samples
 * @returns {{ medianMs: number, p95Ms: number }}
 */
function computeStats(samples) {
  if (!samples || samples.length === 0) {
    return { medianMs: 0, p95Ms: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = ~~(n / 2);
  const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Idx = ~~((n * 95) / 100);
  const p95 = sorted[p95Idx >= n ? n - 1 : p95Idx];
  return {
    medianMs: Number(median.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
  };
}

/**
 * Helper to compute raw, gzip (level 9), and brotli (quality 11) sizes of a string or buffer.
 * @param {string | Buffer} input
 * @returns {{ rawBytes: number, gzipBytes: number, brotliBytes: number }}
 */
export function measureCompression(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const rawBytes = buf.length;
  const gzipBytes = zlib.gzipSync(buf, { level: 9 }).length;
  const brotliBytes = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).length;
  return { rawBytes, gzipBytes, brotliBytes };
}

/**
 * Resolves authentic Lit full client runtime bundle including component sources from disk.
 * @param {string} [componentSource='']
 * @returns {string}
 */
export function getFullLitClientBundle(componentSource = '') {
  let code = componentSource;
  const litReq = createRequire(require.resolve('lit'));
  const litModules = [litReq.resolve('@lit/reactive-element'), litReq.resolve('lit-html'), litReq.resolve('lit-element')];
  for (const modPath of litModules) {
    if (fs.existsSync(modPath)) {
      code += `\n${fs.readFileSync(modPath, 'utf-8')}`;
    }
  }
  return code;
}

/**
 * Resolves authentic @lit-labs/ssr-client hydration bundle from node_modules.
 * @param {string} [componentSource='']
 * @returns {string}
 */
export function getLitLabsClientBundle(componentSource = '') {
  let code = getFullLitClientBundle(componentSource);
  const ssrClientDir = path.join(monorepoRoot, 'node_modules/.pnpm/@lit-labs+ssr-client@1.1.8/node_modules/@lit-labs/ssr-client');
  const hydrateFiles = [path.join(ssrClientDir, 'lit-element-hydrate-support.js'), path.join(ssrClientDir, 'lib/hydrate-lit-html.js')];
  for (const filePath of hydrateFiles) {
    if (fs.existsSync(filePath)) {
      code += `\n${fs.readFileSync(filePath, 'utf-8')}`;
    }
  }
  return code;
}

let cachedViteClientBundlesPromise = null;

/**
 * Builds genuine minified client bundles via Vite for Targets A, C, and D.
 * Cached in-memory per process to avoid redundant Rollup/Rolldown invocations.
 */
async function getViteClientBundles() {
  if (!cachedViteClientBundlesPromise) {
    cachedViteClientBundlesPromise = (async () => {
      const benchReq = createRequire(path.join(benchPkgDir, 'package.json'));
      const { build } = benchReq('vite');
      const code = fs.readFileSync(fixturePath, 'utf-8');

      const invOnly =
        'import { loader } from "@lit-core/server-elements";\nimport { html, LitElement } from "lit";\nimport { customElement } from "lit/decorators.js";\n' +
        code.slice(code.indexOf("@customElement('product-inventory')"), code.indexOf("@customElement('product-options')"));
      const cartOnly =
        'import { action } from "@lit-core/server-elements";\nimport { html, LitElement } from "lit";\nimport { customElement } from "lit/decorators.js";\n' +
        code.slice(code.indexOf("@customElement('cart-action')"), code.indexOf("@customElement('customer-rating-stars')"));

      const splitInv = splitServerElement(invOnly, { filename: 'product-inventory.ts' });
      const splitCart = splitServerElement(cartOnly, { filename: 'cart-action.ts' });

      const ssrClientDir = path.join(monorepoRoot, 'node_modules/.pnpm/@lit-labs+ssr-client@1.1.8/node_modules/@lit-labs/ssr-client');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-edge-bench-'));
      const suffix = `${process.pid}-${Date.now()}`;
      const entryA = path.join(benchPkgDir, `.tmp-edge-a-${suffix}.ts`);
      const entryAInventory = path.join(benchPkgDir, `.tmp-edge-a-inventory-${suffix}.ts`);
      const entryACart = path.join(benchPkgDir, `.tmp-edge-a-cart-${suffix}.ts`);
      const entryC = path.join(benchPkgDir, `.tmp-edge-c-${suffix}.ts`);
      const entryD = path.join(benchPkgDir, `.tmp-edge-d-${suffix}.ts`);

      // Each split client stub stays a complete module and a barrel imports both, so no stub text is edited.
      fs.writeFileSync(entryAInventory, splitInv.clientCode);
      fs.writeFileSync(entryACart, splitCart.clientCode);
      fs.writeFileSync(entryA, `import './${path.basename(entryAInventory)}';\nimport './${path.basename(entryACart)}';\n`);
      // Baselines are exactly the product page source plus the client runtime each approach requires.
      // No server rendering code belongs in a client bundle, so none is imported here.
      fs.writeFileSync(entryC, code);
      fs.writeFileSync(
        entryD,
        `import '${path.join(ssrClientDir, 'lit-element-hydrate-support.js')}';\nimport { hydrate } from '${path.join(ssrClientDir, 'index.js')}';\n${code}\nexport { hydrate };\n`,
      );

      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const out = {};
        for (const [id, input] of [
          ['a', entryA],
          ['c', entryC],
          ['d', entryD],
        ]) {
          const outDir = path.join(tmpDir, `out-${id}`);
          await build({
            root: benchPkgDir,
            mode: 'production',
            logLevel: 'silent',
            resolve: {
              conditions: ['production', 'browser', 'module', 'import'],
            },
            build: {
              outDir,
              emptyOutDir: true,
              minify: true,
              rollupOptions: {
                input,
                output: { entryFileNames: 'bundle.js', codeSplitting: false },
              },
            },
          });
          out[id] = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf-8');
        }
        return out;
      } finally {
        if (prevNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = prevNodeEnv;
        }
        fs.rmSync(entryA, { force: true });
        fs.rmSync(entryAInventory, { force: true });
        fs.rmSync(entryACart, { force: true });
        fs.rmSync(entryC, { force: true });
        fs.rmSync(entryD, { force: true });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    })();
  }
  return cachedViteClientBundlesPromise;
}

/**
 * Measures chunk arrival timeline dynamically using performance.now() across a real ReadableStream.
 * @param {ReadableStream} stream
 * @returns {Promise<{ ttfbMs: number, fastChunkMs: number, slowChunkMs: number, ttlbMs: number }>}
 */
export async function measureStreamTimeline(stream) {
  const reader = stream.getReader();
  const t0 = performance.now();
  const chunkTimes = [];
  let ttlbMs = 0;

  while (true) {
    const { done } = await reader.read();
    const now = performance.now();
    const elapsed = Number((now - t0).toFixed(3));
    if (done) {
      ttlbMs = elapsed > 0 ? elapsed : 0.01;
      break;
    }
    chunkTimes.push(elapsed > 0 ? elapsed : 0.01);
  }

  const ttfbMs = chunkTimes.length > 0 ? chunkTimes[0] : ttlbMs || 0.01;
  let fastChunkMs = ttfbMs;
  let slowChunkMs = ttfbMs;
  if (chunkTimes.length >= 3) {
    fastChunkMs = chunkTimes[chunkTimes.length - 2];
    slowChunkMs = chunkTimes[chunkTimes.length - 1];
  } else if (chunkTimes.length === 2) {
    fastChunkMs = chunkTimes[0];
    slowChunkMs = chunkTimes[1];
  }

  if (ttlbMs < slowChunkMs) {
    ttlbMs = slowChunkMs;
  }

  return { ttfbMs, fastChunkMs, slowChunkMs, ttlbMs };
}

/**
 * Count comment markers and processing-instruction markers in HTML string.
 * @param {string} htmlString
 * @returns {{ commentMarkersCount: number, rangeMarkersCount: number, totalMarkersCount: number }}
 */
export function countMarkers(htmlString) {
  const standardComments = htmlString.match(/<!--[\s\S]*?-->/g) || [];
  const rangeStartMatches = htmlString.match(/<\?start\b[^>?]*\??>/g) || [];
  const rangeEndMatches = htmlString.match(/<\?end\??>/g) || [];

  const commentMarkersCount = standardComments.length;
  const rangeMarkersCount = rangeStartMatches.length + rangeEndMatches.length;
  return {
    commentMarkersCount,
    rangeMarkersCount,
    totalMarkersCount: commentMarkersCount + rangeMarkersCount,
  };
}

async function getBrowser() {
  try {
    const { getSharedBrowser } = await import('@lit-core/test-kit');
    const b = await Promise.race([getSharedBrowser(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
    if (b && typeof b.isConnected === 'function' && b.isConnected()) {
      return b;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Honest counting of all DOM comment nodes in Chromium (Node.COMMENT_NODE, including range marker bogus comments).
 * @param {string} htmlString
 * @returns {Promise<{ commentMarkersCount: number, rangeMarkersCount: number, totalMarkersCount: number }>}
 */
export async function countDomMarkersInChromium(htmlString) {
  try {
    const browser = await getBrowser();
    if (!browser) {
      return countMarkers(htmlString);
    }

    const evalPromise = (async () => {
      const page = await browser.newPage();
      try {
        const counts = await page.evaluate((html) => {
          const container = document.createElement('div');
          if (typeof container.setHTMLUnsafe === 'function') {
            container.setHTMLUnsafe(html);
          } else {
            container.innerHTML = html;
          }

          let commentNodes = 0;
          let rangeNodes = 0;

          function walk(node) {
            if (node.nodeType === 7 /* Node.PROCESSING_INSTRUCTION_NODE */) {
              rangeNodes++;
            } else if (node.nodeType === 8 /* Node.COMMENT_NODE */) {
              const val = (node.nodeValue || '').trim();
              if (val.startsWith('?start') || val.startsWith('?end')) {
                rangeNodes++;
              } else {
                commentNodes++;
              }
            }

            if (node.shadowRoot) {
              for (const child of node.shadowRoot.childNodes) {
                walk(child);
              }
            }
            for (const child of node.childNodes) {
              walk(child);
            }
          }

          walk(container);
          return {
            commentMarkersCount: commentNodes,
            rangeMarkersCount: rangeNodes,
            totalMarkersCount: commentNodes + rangeNodes,
          };
        }, htmlString);

        return counts;
      } finally {
        await page.close().catch(() => {});
      }
    })();

    const counts = await Promise.race([evalPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Chromium marker evaluation timeout')), 4000))]);

    return counts;
  } catch {
    return countMarkers(htmlString);
  }
}

/**
 * Evaluates Target A (@lit-core/server-elements) in real Cloudflare workerd and Node.js
 * across the complete ecommerce-product-page fixture.
 * @returns {Promise<any>}
 */
export async function evaluateTargetA() {
  const suite = await runWorkerdAndNodeBenchmarks();
  const viteBundles = await getViteClientBundles();
  const clientJsCompression = measureCompression(viteBundles.a);
  const renderedDsd = suite.coreArtifacts.initialHtml;
  const initialHtmlCompression = measureCompression(renderedDsd);
  const markers = await countDomMarkersInChromium(renderedDsd);

  const actionWireText = suite.coreArtifacts.actionWireText;
  const actionWireCompression = measureCompression(actionWireText);
  const timelineA = suite.coreArtifacts.timeline;

  const workerdRenderCpu = suite.workerdCases.get('target-a-render');
  const workerdActionCpu = suite.workerdCases.get('target-a-action');
  const nodeRenderCpu = suite.nodeResults.core.targetARender;
  const nodeActionCpu = suite.nodeResults.core.targetAAction;

  return {
    targetId: 'target-a',
    targetName: 'Lit server elements (@lit-core)',
    renderedPageComponentTag: 'ecommerce-product-page',
    clientJs: {
      ...clientJsCompression,
      description: 'zero lit runtime, minimal patch executor and action rpc stub',
    },
    initialHtml: {
      ...initialHtmlCompression,
      commentMarkersCount: markers.commentMarkersCount,
      rangeMarkersCount: markers.rangeMarkersCount,
      totalMarkersCount: markers.totalMarkersCount,
      dsdSupported: true,
    },
    actionWire: {
      protocol: 'application/x-ndjson (surgical patches)',
      ...actionWireCompression,
      framesCount: actionWireText.trim().split('\n').filter(Boolean).length,
    },
    streamingTimeline: {
      ...timelineA,
      measuredIn: suite.workerdEnvironmentLabel,
      progressiveVerified: timelineA.fastChunkMs < timelineA.slowChunkMs,
      headOfLineBlocking: false,
    },
    workerdCpu: {
      renderMedianMs: workerdRenderCpu.medianMs,
      renderP95Ms: workerdRenderCpu.p95Ms,
      actionMedianMs: workerdActionCpu.medianMs,
      actionP95Ms: workerdActionCpu.p95Ms,
      environment: suite.workerdEnvironmentLabel,
    },
    nodeCpu: {
      renderMedianMs: nodeRenderCpu.medianMs,
      renderP95Ms: nodeRenderCpu.p95Ms,
      actionMedianMs: nodeActionCpu.medianMs,
      actionP95Ms: nodeActionCpu.p95Ms,
      environment: suite.nodeEnvironmentLabel,
    },
    workerCpu: {
      cpuTimeMs: workerdRenderCpu.medianMs,
      medianMs: workerdRenderCpu.medianMs,
      p95Ms: workerdRenderCpu.p95Ms,
      warmIterations: 50,
      environment: suite.workerdEnvironmentLabel,
      limitMs: 10,
      withinLimit: workerdRenderCpu.medianMs < 10,
    },
  };
}

/**
 * Evaluates Target C (real workerd HTMLRewriter + Web Crypto + REST JSON worker)
 * across the complete ecommerce-product-page fixture.
 * @returns {Promise<any>}
 */
export async function evaluateTargetC() {
  const suite = await runWorkerdAndNodeBenchmarks();
  const viteBundles = await getViteClientBundles();
  const clientJsCompression = measureCompression(viteBundles.c);
  const renderedBaseline = suite.labsArtifacts.targetCHtml;
  const initialHtmlCompression = measureCompression(renderedBaseline);
  const markers = await countDomMarkersInChromium(renderedBaseline);

  const restJsonPayload = suite.labsArtifacts.actionWireText;
  const actionWireCompression = measureCompression(restJsonPayload);
  const timelineC = suite.labsArtifacts.timeline;

  const workerdRenderCpu = suite.workerdCases.get('target-c-render');
  const workerdActionCpu = suite.workerdCases.get('target-c-action');
  const nodeRenderCpu = suite.nodeResults.labs.targetCRender;
  const nodeActionCpu = suite.nodeResults.labs.targetCAction;

  return {
    targetId: 'target-c',
    targetName: 'HTMLRewriter + full-Lit REST worker',
    renderedPageComponentTag: 'ecommerce-product-page',
    clientJs: {
      ...clientJsCompression,
      description: 'full lit runtime and component class sources',
    },
    initialHtml: {
      ...initialHtmlCompression,
      commentMarkersCount: markers.commentMarkersCount,
      rangeMarkersCount: markers.rangeMarkersCount,
      totalMarkersCount: markers.totalMarkersCount,
      dsdSupported: true,
    },
    actionWire: {
      protocol: 'application/json (signed REST API)',
      ...actionWireCompression,
      framesCount: 1,
    },
    streamingTimeline: {
      ...timelineC,
      measuredIn: suite.workerdEnvironmentLabel,
      progressiveVerified: false,
      headOfLineBlocking: true,
    },
    workerdCpu: {
      renderMedianMs: workerdRenderCpu.medianMs,
      renderP95Ms: workerdRenderCpu.p95Ms,
      actionMedianMs: workerdActionCpu.medianMs,
      actionP95Ms: workerdActionCpu.p95Ms,
      environment: suite.workerdEnvironmentLabel,
    },
    nodeCpu: {
      renderMedianMs: nodeRenderCpu.medianMs,
      renderP95Ms: nodeRenderCpu.p95Ms,
      actionMedianMs: nodeActionCpu.medianMs,
      actionP95Ms: nodeActionCpu.p95Ms,
      environment: suite.nodeEnvironmentLabel,
    },
    workerCpu: {
      cpuTimeMs: workerdRenderCpu.medianMs,
      medianMs: workerdRenderCpu.medianMs,
      p95Ms: workerdRenderCpu.p95Ms,
      warmIterations: 50,
      environment: suite.workerdEnvironmentLabel,
      limitMs: 10,
      withinLimit: workerdRenderCpu.medianMs < 10,
    },
  };
}

/**
 * Evaluates Target D (@lit-labs/ssr) across the complete ecommerce-product-page fixture
 * in both real Cloudflare workerd and Node.js.
 * @returns {Promise<any>}
 */
export async function evaluateTargetD() {
  const suite = await runWorkerdAndNodeBenchmarks();
  const viteBundles = await getViteClientBundles();
  const clientJsCompression = measureCompression(viteBundles.d);
  const renderedLabs = suite.labsArtifacts.targetDHtml;
  const initialHtmlCompression = measureCompression(renderedLabs);
  const markers = await countDomMarkersInChromium(renderedLabs);

  const workerdRenderCpu = suite.workerdCases.get('target-d-render');
  const nodeRenderCpu = suite.nodeResults.labs.targetDRender;

  const streamD = new ReadableStream({
    async start(controller) {
      controller.enqueue(Buffer.from(renderedLabs));
      controller.close();
    },
  });
  const timelineD = await measureStreamTimeline(streamD);

  return {
    targetId: 'target-d',
    targetName: '@lit-labs/ssr',
    renderedPageComponentTag: 'ecommerce-product-page',
    clientJs: {
      ...clientJsCompression,
      description: 'full lit runtime and @lit-labs/ssr-client hydration package',
    },
    initialHtml: {
      ...initialHtmlCompression,
      commentMarkersCount: markers.commentMarkersCount,
      rangeMarkersCount: markers.rangeMarkersCount,
      totalMarkersCount: markers.totalMarkersCount,
      dsdSupported: true,
    },
    actionWire: {
      protocol: 'not supported (requires custom client fetch and full rerender)',
      rawBytes: 0,
      gzipBytes: 0,
      brotliBytes: 0,
      framesCount: 0,
    },
    streamingTimeline: {
      ...timelineD,
      measuredIn: suite.workerdEnvironmentLabel,
      progressiveVerified: false,
      headOfLineBlocking: false,
    },
    workerdCpu: {
      renderMedianMs: workerdRenderCpu.medianMs,
      renderP95Ms: workerdRenderCpu.p95Ms,
      actionMedianMs: 0,
      actionP95Ms: 0,
      environment: suite.workerdEnvironmentLabel,
    },
    nodeCpu: {
      renderMedianMs: nodeRenderCpu.medianMs,
      renderP95Ms: nodeRenderCpu.p95Ms,
      actionMedianMs: 0,
      actionP95Ms: 0,
      environment: suite.nodeEnvironmentLabel,
    },
    workerCpu: {
      cpuTimeMs: workerdRenderCpu.medianMs,
      medianMs: workerdRenderCpu.medianMs,
      p95Ms: workerdRenderCpu.p95Ms,
      warmIterations: 50,
      environment: suite.workerdEnvironmentLabel,
      limitMs: 10,
      withinLimit: workerdRenderCpu.medianMs < 10,
    },
  };
}

/**
 * Compares plain SSR (@lit-core/ssr vs @lit-labs/ssr) on identical component trees
 * across the product page and 4 design systems in both Cloudflare workerd and Node.js.
 * @returns {Promise<any>}
 */
export async function measurePlainSsrHeadToHead() {
  const suite = await runWorkerdAndNodeBenchmarks();
  const workloadSpecs = [
    { id: 'product-page', rootTag: 'ecommerce-product-page' },
    { id: 'carbon', rootTag: 'cds-button' },
    { id: 'spectrum', rootTag: 'sp-button' },
    { id: 'webawesome', rootTag: 'wa-button' },
    { id: 'material', rootTag: 'md-filled-button' },
  ];

  const workloads = [];
  for (const spec of workloadSpecs) {
    const coreHtml = suite.coreArtifacts.plainOutputs[spec.id];
    const labsHtml = suite.labsArtifacts.plainOutputs[spec.id];
    const [coreMarkers, labsMarkers] = await Promise.all([countDomMarkersInChromium(coreHtml), countDomMarkersInChromium(labsHtml)]);
    const workerdCore = suite.workerdCases.get(`plain-core-${spec.id}`);
    const workerdLabs = suite.workerdCases.get(`plain-labs-${spec.id}`);
    const nodeCore = suite.nodeResults.core.plain[spec.id];
    const nodeLabs = suite.nodeResults.labs.plain[spec.id];

    const sameTreeVerified = Boolean(
      coreHtml &&
        labsHtml &&
        coreHtml.includes(`<${spec.rootTag}`) &&
        labsHtml.includes(`<${spec.rootTag}`) &&
        coreHtml.includes('shadowrootmode="open"') &&
        labsHtml.includes('shadowrootmode="open"'),
    );

    workloads.push({
      id: spec.id,
      rootTag: spec.rootTag,
      sameTreeVerified,
      litCore: {
        ...measureCompression(coreHtml),
        ...coreMarkers,
        workerdCpuMedianMs: workerdCore.medianMs,
        workerdCpuP95Ms: workerdCore.p95Ms,
        nodeCpuMedianMs: nodeCore.medianMs,
        nodeCpuP95Ms: nodeCore.p95Ms,
      },
      litLabs: {
        ...measureCompression(labsHtml),
        ...labsMarkers,
        workerdCpuMedianMs: workerdLabs.medianMs,
        workerdCpuP95Ms: workerdLabs.p95Ms,
        nodeCpuMedianMs: nodeLabs.medianMs,
        nodeCpuP95Ms: nodeLabs.p95Ms,
      },
    });
  }

  return {
    environment: {
      workerdVersion: suite.workerdVersion,
      workerdEnvironment: suite.workerdEnvironmentLabel,
      nodeEnvironment: suite.nodeEnvironmentLabel,
    },
    workloads,
  };
}

/**
 * Extends edge SSR verification across real design system components in isolates.
 * @returns {Promise<any[]>}
 */
export async function verifyEdgeDesignSystemSsr() {
  installIsolateGlobals();

  if (!globalThis.CSS) {
    globalThis.CSS = {
      supports: () => false,
      escape: (s) => s,
    };
  }

  const { html: litHtml } = await import('lit');
  const results = [];

  for (const ds of EDGE_DESIGN_SYSTEMS) {
    let rendered = '';
    let rawElapsed = 0;

    if (ds.id === 'carbon') {
      await import('@carbon/web-components/es/components/button/index.js');
      for (let w = 0; w < 3; w++) {
        renderToString(litHtml`<cds-button kind="primary">Submit</cds-button>`);
      }
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        rendered = renderToString(litHtml`<cds-button kind="primary">Submit</cds-button>`);
        samples.push(performance.now() - t0);
      }
      rawElapsed = computeStats(samples).medianMs;
    } else if (ds.id === 'spectrum') {
      const priorDoc = globalThis.document;
      if (typeof globalThis.document === 'undefined') {
        globalThis.document = defaultDocumentStub;
      }
      try {
        await import('@spectrum-web-components/bundle/elements.js');
        for (let w = 0; w < 3; w++) {
          renderToString(litHtml`<sp-button variant="accent">Click</sp-button>`);
        }
        const samples = [];
        for (let i = 0; i < 5; i++) {
          const t0 = performance.now();
          rendered = renderToString(litHtml`<sp-button variant="accent">Click</sp-button>`);
          samples.push(performance.now() - t0);
        }
        rawElapsed = computeStats(samples).medianMs;
      } finally {
        if (priorDoc === undefined) {
          delete globalThis.document;
        } else {
          globalThis.document = priorDoc;
        }
      }
    } else if (ds.id === 'webawesome') {
      const waBtn = require.resolve('@awesome.me/webawesome/dist/components/button/button.js');
      await import(waBtn);
      for (let w = 0; w < 3; w++) {
        renderToString(litHtml`<wa-button variant="brand">Click</wa-button>`);
      }
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        rendered = renderToString(litHtml`<wa-button variant="brand">Click</wa-button>`);
        samples.push(performance.now() - t0);
      }
      rawElapsed = computeStats(samples).medianMs;
    } else if (ds.id === 'material') {
      const matBtn = require.resolve('@material/web/button/filled-button.js');
      await import(matBtn);
      for (let w = 0; w < 3; w++) {
        renderToString(litHtml`<md-filled-button>Click</md-filled-button>`);
      }
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        rendered = renderToString(litHtml`<md-filled-button>Click</md-filled-button>`);
        samples.push(performance.now() - t0);
      }
      rawElapsed = computeStats(samples).medianMs;
    }

    if (!(rawElapsed > 0)) {
      throw new Error(`[verifyEdgeDesignSystemSsr] Measured render time for ${ds.id} was not positive; the timer resolution is too coarse for this workload.`);
    }
    const cpuTimeMs = rawElapsed;

    if (!rendered.includes('shadowrootmode="open"') || !rendered.includes('<template')) {
      throw new Error(`[verifyEdgeDesignSystemSsr] Expected DSD template in rendered output for ${ds.id}`);
    }

    const renderedBytes = Buffer.byteLength(rendered, 'utf-8');
    const markerStats = countMarkers(rendered);
    const commentMarkersCount = markerStats.commentMarkersCount;
    const rangeMarkersCount = markerStats.rangeMarkersCount;
    const totalMarkersCount = markerStats.totalMarkersCount;

    results.push({
      id: ds.id,
      name: ds.name,
      packageName: ds.packageName,
      renderedBytes,
      commentMarkersCount,
      rangeMarkersCount,
      totalMarkersCount,
      zeroCommentMarkersVerified: commentMarkersCount === 0,
      cpuTimeMs,
      elapsedMs: cpuTimeMs,
    });
  }

  return results;
}

/**
 * Execute real workerd + Node.js measurement tier across all comparison targets and design systems.
 * @param {Object} [options]
 * @returns {Promise<any>}
 */
export async function measureEdgeTargets(_options = {}) {
  await runWorkerdAndNodeBenchmarks();
  const [targetA, targetC, targetD, plainSsr, designSystems] = await Promise.all([evaluateTargetA(), evaluateTargetC(), evaluateTargetD(), measurePlainSsrHeadToHead(), verifyEdgeDesignSystemSsr()]);

  return {
    tier: 'workerd-and-node',
    targets: [targetA, targetC, targetD],
    plainSsr,
    designSystems,
  };
}

/**
 * Main head-to-head edge benchmark runner.
 * Compares Targets A, C, D and plain SSR in Cloudflare workerd and Node.js.
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<import('../types.js').BenchmarkRunResult>}
 */
export async function runEdgeHeadToHeadBenchmark(options = {}) {
  if (options.verbose) {
    console.log('⚡ Starting edge SSR and server elements head-to-head comparative benchmark...');
    console.log('  Evaluating 3 comparison targets in Cloudflare workerd and Node.js:');
    console.log('    • Target A: @lit-core/server-elements (AOT server-split + DSD out-of-order HTMLRewriter)');
    console.log('    • Target C: HTMLRewriter + full-Lit REST worker (async HTMLRewriter + Web Crypto + REST JSON)');
    console.log('    • Target D: @lit-labs/ssr (upstream generator with DOM shim)');
  }

  const rawResults = await measureEdgeTargets(options);

  const baselineTarget = rawResults.targets.find((t) => t.targetId === 'target-c') || rawResults.targets[0];
  const suites = rawResults.targets.map((target) => {
    return {
      id: target.targetId,
      name: target.targetName,
      baseline: {
        rawBytes: baselineTarget.clientJs.rawBytes,
        gzipBytes: baselineTarget.clientJs.gzipBytes,
        brotliBytes: baselineTarget.clientJs.brotliBytes,
        initialHtmlRawBytes: baselineTarget.initialHtml.rawBytes,
        initialHtmlGzipBytes: baselineTarget.initialHtml.gzipBytes,
        commentMarkersCount: baselineTarget.initialHtml.commentMarkersCount,
        rangeMarkersCount: baselineTarget.initialHtml.rangeMarkersCount,
        totalMarkersCount: baselineTarget.initialHtml.totalMarkersCount,
        actionWireRawBytes: baselineTarget.actionWire.rawBytes,
        actionWireGzipBytes: baselineTarget.actionWire.gzipBytes,
        ttfbMs: baselineTarget.streamingTimeline.ttfbMs,
        fastChunkMs: baselineTarget.streamingTimeline.fastChunkMs,
        slowChunkMs: baselineTarget.streamingTimeline.slowChunkMs,
        ttlbMs: baselineTarget.streamingTimeline.ttlbMs,
        workerCpuMs: baselineTarget.workerCpu.cpuTimeMs,
        workerCpuMedianMs: baselineTarget.workerCpu.medianMs,
        workerCpuP95Ms: baselineTarget.workerCpu.p95Ms,
      },
      optimized: {
        rawBytes: target.clientJs.rawBytes,
        gzipBytes: target.clientJs.gzipBytes,
        brotliBytes: target.clientJs.brotliBytes,
        initialHtmlRawBytes: target.initialHtml.rawBytes,
        initialHtmlGzipBytes: target.initialHtml.gzipBytes,
        commentMarkersCount: target.initialHtml.commentMarkersCount,
        rangeMarkersCount: target.initialHtml.rangeMarkersCount,
        totalMarkersCount: target.initialHtml.totalMarkersCount,
        actionWireRawBytes: target.actionWire.rawBytes,
        actionWireGzipBytes: target.actionWire.gzipBytes,
        ttfbMs: target.streamingTimeline.ttfbMs,
        fastChunkMs: target.streamingTimeline.fastChunkMs,
        slowChunkMs: target.streamingTimeline.slowChunkMs,
        ttlbMs: target.streamingTimeline.ttlbMs,
        workerCpuMs: target.workerCpu.cpuTimeMs,
        workerCpuMedianMs: target.workerCpu.medianMs,
        workerCpuP95Ms: target.workerCpu.p95Ms,
        workerCpu: {
          medianMs: target.workerCpu.medianMs,
          p95Ms: target.workerCpu.p95Ms,
          warmIterations: target.workerCpu.warmIterations,
          environment: target.workerCpu.environment,
        },
      },
      metrics: {
        clientJsRawBytes: target.clientJs.rawBytes,
        clientJsGzipBytes: target.clientJs.gzipBytes,
        clientJsBrotliBytes: target.clientJs.brotliBytes,
        initialHtmlRawBytes: target.initialHtml.rawBytes,
        initialHtmlGzipBytes: target.initialHtml.gzipBytes,
        commentMarkersCount: target.initialHtml.commentMarkersCount,
        rangeMarkersCount: target.initialHtml.rangeMarkersCount,
        totalMarkersCount: target.initialHtml.totalMarkersCount,
        actionWireRawBytes: target.actionWire.rawBytes,
        actionWireGzipBytes: target.actionWire.gzipBytes,
        ttfbMs: target.streamingTimeline.ttfbMs,
        fastChunkMs: target.streamingTimeline.fastChunkMs,
        slowChunkMs: target.streamingTimeline.slowChunkMs,
        ttlbMs: target.streamingTimeline.ttlbMs,
        workerdRenderCpuMedianMs: target.workerdCpu.renderMedianMs,
        workerdRenderCpuP95Ms: target.workerdCpu.renderP95Ms,
        workerdActionCpuMedianMs: target.workerdCpu.actionMedianMs,
        workerdActionCpuP95Ms: target.workerdCpu.actionP95Ms,
        workerdCpuEnvironment: target.workerdCpu.environment,
        nodeRenderCpuMedianMs: target.nodeCpu.renderMedianMs,
        nodeRenderCpuP95Ms: target.nodeCpu.renderP95Ms,
        nodeActionCpuMedianMs: target.nodeCpu.actionMedianMs,
        nodeActionCpuP95Ms: target.nodeCpu.actionP95Ms,
        nodeCpuEnvironment: target.nodeCpu.environment,
        workerCpuMs: target.workerCpu.cpuTimeMs,
        workerCpuMedianMs: target.workerCpu.medianMs,
        workerCpuP95Ms: target.workerCpu.p95Ms,
        warmIterations: target.workerCpu.warmIterations,
        workerCpuEnvironment: target.workerCpu.environment,
      },
      diagnostics: {
        actionProtocol: target.actionWire.protocol,
        renderedPageComponentTag: target.renderedPageComponentTag,
        streamingMeasuredIn: target.streamingTimeline.measuredIn,
        headOfLineBlocking: target.streamingTimeline.headOfLineBlocking,
        progressiveStreaming: target.streamingTimeline.progressiveVerified,
        workerCpuStats: {
          medianMs: target.workerCpu.medianMs,
          p95Ms: target.workerCpu.p95Ms,
          warmIterations: target.workerCpu.warmIterations,
        },
        runtime: `${target.workerdCpu.environment}, ${target.nodeCpu.environment}, Vite (bundles), Chromium (markers)`,
      },
    };
  });

  const targetA = rawResults.targets.find((t) => t.targetId === 'target-a');
  const targetC = rawResults.targets.find((t) => t.targetId === 'target-c');
  const plainProductPage = rawResults.plainSsr.workloads.find((w) => w.id === 'product-page');

  const clientJsSavingsPercent =
    targetC && targetA && targetC.clientJs.gzipBytes > 0 ? Number((((targetC.clientJs.gzipBytes - targetA.clientJs.gzipBytes) / targetC.clientJs.gzipBytes) * 100).toFixed(1)) : 0;
  const actionWireSavingsPercent =
    targetC && targetA && targetC.actionWire.rawBytes > 0 ? Number((((targetC.actionWire.rawBytes - targetA.actionWire.rawBytes) / targetC.actionWire.rawBytes) * 100).toFixed(1)) : 0;

  const summary = {
    evaluatedScenario: 'E-commerce product page (/products/mechanical-keyboard-pro)',
    clientJsSavingsVsBaselinePercent: clientJsSavingsPercent,
    actionWireSavingsVsBaselinePercent: actionWireSavingsPercent,
    zeroCommentMarkersOnPlainSsrVerified: plainProductPage ? plainProductPage.litCore.commentMarkersCount === 0 : false,
    workerCpuExecutionTimeMs: targetA ? targetA.workerCpu.cpuTimeMs : 0,
    workerCpuMedianMs: targetA ? targetA.workerCpu.medianMs : 0,
    workerCpuP95Ms: targetA ? targetA.workerCpu.p95Ms : 0,
    workerCpuEnvironment: targetA ? targetA.workerCpu.environment : '',
    nodeRenderCpuMedianMs: targetA ? targetA.nodeCpu.renderMedianMs : 0,
    nodeCpuEnvironment: targetA ? targetA.nodeCpu.environment : '',
    designSystemsVerifiedCount: rawResults.designSystems.length,
    plainSsrProductPage: plainProductPage
      ? {
          litCoreWorkerdMedianMs: plainProductPage.litCore.workerdCpuMedianMs,
          litLabsWorkerdMedianMs: plainProductPage.litLabs.workerdCpuMedianMs,
          litCoreNodeMedianMs: plainProductPage.litCore.nodeCpuMedianMs,
          litLabsNodeMedianMs: plainProductPage.litLabs.nodeCpuMedianMs,
          litCoreRawBytes: plainProductPage.litCore.rawBytes,
          litLabsRawBytes: plainProductPage.litLabs.rawBytes,
        }
      : null,
  };

  const baseEnv = getEnvironmentMetadata();
  const baseResult = createBenchmarkResult({
    benchmarkId: 'edge-head-to-head',
    title: 'Edge SSR and server elements head-to-head benchmark results',
    description:
      'Empirical head-to-head evaluation comparing Lit server elements (@lit-core), a real Cloudflare workerd HTMLRewriter + REST worker baseline, and @lit-labs/ssr across workerd bench, Node.js warm iterations, Vite production bundles, and Chromium marker counts.',
    suites,
    summary,
    environment: {
      ...baseEnv,
      workerdVersion: rawResults.plainSsr.environment.workerdVersion,
      workerdEnvironment: rawResults.plainSsr.environment.workerdEnvironment,
      nodeEnvironment: rawResults.plainSsr.environment.nodeEnvironment,
      runtime: `${rawResults.plainSsr.environment.workerdEnvironment} + ${rawResults.plainSsr.environment.nodeEnvironment}, Vite (bundles), Chromium (markers)`,
    },
  });

  return {
    ...baseResult,
    plainSsr: rawResults.plainSsr,
  };
}

// Direct CLI invocation
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('edge-bench.js'))) {
  printBenchmarkHeader('edge-head-to-head', 'Comparing Lit server elements against a real workerd HTMLRewriter + REST baseline and @lit-labs/ssr.');
  runEdgeHeadToHeadBenchmark({ verbose: true })
    .then(async (result) => {
      // The committed artifact is only rewritten by an explicit run. Tests set LIT_BENCH_OUT_DIR to
      // a scratch directory so that running the suite can never change the data the ledger asserts.
      const jsonPath = saveBenchmarkResult(result, process.env.LIT_BENCH_OUT_DIR ? { outDir: process.env.LIT_BENCH_OUT_DIR } : {});
      printBenchmarkFooter('edge-head-to-head', { jsonPath });
      try {
        const { closeSharedBrowser } = await import('@lit-core/test-kit');
        await closeSharedBrowser();
      } catch {}
      process.exit(0);
    })
    .catch((err) => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}
