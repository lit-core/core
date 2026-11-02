// @ts-nocheck
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchPkgDir = path.resolve(__dirname, '../..');
const monorepoRoot = path.resolve(__dirname, '../../../../..');
const fixturePath = path.resolve(benchPkgDir, 'fixtures/ecommerce/product-page.ts');
const workerdBin = path.join(monorepoRoot, 'node_modules/.bin/workerd');
const ssrWasmSourcePath = path.join(monorepoRoot, 'packages/rendering/ssr/wasm/ssr_bg.wasm');

const benchReq = createRequire(path.join(benchPkgDir, 'package.json'));

function computePercentilesFromNs(samplesNs) {
  if (!Array.isArray(samplesNs) || samplesNs.length === 0) {
    return { medianMs: 0, p95Ms: 0 };
  }
  const ms = samplesNs.map((ns) => ns / 1e6).sort((a, b) => a - b);
  const n = ms.length;
  const mid = ~~(n / 2);
  const median = n % 2 !== 0 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2;
  const p95Idx = ~~((n * 95) / 100);
  const p95 = ms[p95Idx >= n ? n - 1 : p95Idx];
  return {
    medianMs: Number(median.toFixed(4)),
    p95Ms: Number(p95.toFixed(4)),
  };
}

function splitAllServerElementsInFile(source, filename) {
  return import(path.join(monorepoRoot, 'packages/transforms/server-split/src/index.js')).then(({ splitServerElement }) => {
    let current = source;
    const actions = [];
    const loaders = [];
    for (let pass = 0; pass < 6; pass++) {
      const res = splitServerElement(current, { filename });
      if (!res.isServerElement || !res.workerCode || res.workerCode === current) {
        break;
      }
      current = res.workerCode;
      if (Array.isArray(res.actions)) actions.push(...res.actions);
      if (Array.isArray(res.loaders)) loaders.push(...res.loaders);
    }
    return { workerCode: current, actions, loaders };
  });
}

const FAST_SHIPPING_SOURCE = `
import { loader } from '@lit-core/server-elements';
import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('shipping-eta')
export class ShippingEtaElement extends LitElement {
  static properties = {
    sku: { type: String },
    etaLabel: { type: String, state: true },
    ready: { type: Boolean, state: true },
  };

  sku = 'APX-9800';
  etaLabel = '';
  ready = false;

  @loader()
  async loadEta(env) {
    const latency = env?.fastLatencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
    this.etaLabel = 'Arrives in 2 business days';
    this.ready = true;
  }

  render() {
    if (!this.ready) {
      return html\`<div class="shipping-skeleton" slot="pending">Calculating delivery window...</div>\`;
    }
    return html\`<div class="shipping-card"><span class="shipping-eta">\${this.etaLabel}</span></div>\`;
  }
}
`;

function buildCoreWorkerEntrySource(actionHash) {
  return `
import 'virtual:lit-core/install-globals';
import ssrWasmModule from './ssr_bg.wasm';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { createSignedStateSnapshot } from '@lit-core/server-elements/crypto';
import { renderServerElement, transformServerElementsWithHtmlRewriter } from '@lit-core/server-elements/edge';
import { defaultDocumentStub, registerSsrWasmModule, renderToString } from '@lit-core/ssr';
import { html } from 'lit';
import '@carbon/web-components/es/components/button/index.js';
import '@material/web/button/filled-button.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './spectrum-init.js';
import './product-page-split.ts';
import './shipping-eta-split.ts';

registerSsrWasmModule(ssrWasmModule);

const SECRET = 'm3-edge-bench-hmac-secret-key-32b!';
const PAGE_SHELL = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body><ecommerce-product-page sku="APX-9800"></ecommerce-product-page></body></html>';
const STREAM_SHELL = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body><ecommerce-product-page sku="APX-9800"></ecommerce-product-page><shipping-eta sku="APX-9800"></shipping-eta></body></html>';
const TAG_MANIFEST = [
  'ecommerce-product-page',
  'ecommerce-header',
  'product-hero',
  'customer-rating-stars',
  'product-inventory',
  'product-options',
  'cart-action',
  'shipping-eta',
];

const plainTemplates = {
  'product-page': () => html\`<ecommerce-product-page sku="APX-9800"></ecommerce-product-page>\`,
  carbon: () => html\`<cds-button kind="primary">Submit</cds-button>\`,
  spectrum: () => html\`<sp-button variant="accent">Click</sp-button>\`,
  webawesome: () => html\`<wa-button variant="brand">Click</wa-button>\`,
  material: () => html\`<md-filled-button>Click</md-filled-button>\`,
};

let cachedSignedCart = null;
async function ensureSignedCart() {
  if (!cachedSignedCart) {
    cachedSignedCart = await renderServerElement('cart-action', { sku: 'APX-9800' }, {
      mode: 'dsd',
      secret: SECRET,
      customElements: globalThis.customElements,
    });
  }
  return cachedSignedCart;
}

function makeActionRequest(signed) {
  return new Request('http://localhost/_lit/a/${actionHash}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      Origin: 'http://localhost',
      'X-Lit-Action-Token': signed.token,
    },
    body: JSON.stringify({
      tag: 'cart-action',
      attrs: { sku: 'APX-9800' },
      state: signed.state,
      sig: signed.sig,
      args: ['APX-9800', 1],
      seq: 0,
    }),
  });
}

async function renderResolvedTargetADocument() {
  const res = transformServerElementsWithHtmlRewriter(PAGE_SHELL, {
    secret: SECRET,
    env: { latencyMs: 0 },
    tagManifest: TAG_MANIFEST,
    customElements: globalThis.customElements,
  });
  return await res.text();
}

async function measureRewriterTimeline() {
  const res = transformServerElementsWithHtmlRewriter(STREAM_SHELL, {
    secret: SECRET,
    env: { latencyMs: 30, fastLatencyMs: 5 },
    tagManifest: TAG_MANIFEST,
    customElements: globalThis.customElements,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const t0 = performance.now();
  let ttfbMs = 0;
  let fastChunkMs = 0;
  let slowChunkMs = 0;
  let ttlbMs = 0;
  let fullHtml = '';

  while (true) {
    const { done, value } = await reader.read();
    const elapsed = Number((performance.now() - t0).toFixed(3));
    if (done) {
      ttlbMs = elapsed > 0 ? elapsed : 0.05;
      break;
    }
    const text = decoder.decode(value, { stream: true });
    fullHtml += text;
    if (ttfbMs === 0 && text.length > 0) {
      ttfbMs = elapsed > 0 ? elapsed : 0.05;
    }
    if (fastChunkMs === 0 && fullHtml.includes('Arrives in 2 business days')) {
      fastChunkMs = elapsed > 0 ? elapsed : ttfbMs;
    }
    if (slowChunkMs === 0 && fullHtml.includes('In stock (14 units available)')) {
      slowChunkMs = elapsed > 0 ? elapsed : fastChunkMs;
    }
  }
  fullHtml += decoder.decode();
  if (ttfbMs === 0) ttfbMs = 0.05;
  if (fastChunkMs === 0) fastChunkMs = ttfbMs;
  if (slowChunkMs === 0) slowChunkMs = ttlbMs;
  if (ttlbMs < slowChunkMs) ttlbMs = slowChunkMs;
  return { ttfbMs, fastChunkMs, slowChunkMs, ttlbMs, wireHtml: fullHtml };
}

export const collectCoreArtifacts = {
  async test() {
    const plainOutputs = {};
    for (const [id, fn] of Object.entries(plainTemplates)) {
      plainOutputs[id] = renderToString(fn(), {
        resumable: false,
        cssFuse: false,
        customElements: globalThis.customElements,
      });
    }
    const signed = await ensureSignedCart();
    const actionRes = await handleActionRequest(makeActionRequest(signed), {
      env: { LIT_ACTION_SECRET: SECRET },
      secret: SECRET,
      registry: globalThis.customElements,
    });
    const actionWireText = await actionRes.text();
    const initialHtml = await renderResolvedTargetADocument();
    const timeline = await measureRewriterTimeline();
    console.log('__M3_CORE_ARTIFACTS__:' + JSON.stringify({
      plainOutputs,
      actionWireText,
      initialHtml,
      timeline: {
        ttfbMs: timeline.ttfbMs,
        fastChunkMs: timeline.fastChunkMs,
        slowChunkMs: timeline.slowChunkMs,
        ttlbMs: timeline.ttlbMs,
      },
    }));
  },
};

export default {
  async bench(b) {
    for (const fn of Object.values(plainTemplates)) {
      for (let w = 0; w < 80; w++) {
        renderToString(fn(), {
          resumable: false,
          cssFuse: false,
          customElements: globalThis.customElements,
        });
      }
    }
    for (const [id, fn] of Object.entries(plainTemplates)) {
      await b.run(
        'plain-core-' + id,
        () =>
          b.blackBox(
            renderToString(fn(), {
              resumable: false,
              cssFuse: false,
              customElements: globalThis.customElements,
            }),
          ),
        { minTime: '80ms' },
      );
    }

    await b.run(
      'target-a-render',
      async () => {
        const res = transformServerElementsWithHtmlRewriter(PAGE_SHELL, {
          secret: SECRET,
          env: { latencyMs: 0 },
          tagManifest: TAG_MANIFEST,
          customElements: globalThis.customElements,
        });
        b.blackBox(await res.text());
      },
      { minTime: '35ms' },
    );

    const signed = await ensureSignedCart();
    await b.run(
      'target-a-action',
      async () => {
        const res = await handleActionRequest(makeActionRequest(signed), {
          env: { LIT_ACTION_SECRET: SECRET },
          secret: SECRET,
          registry: globalThis.customElements,
        });
        b.blackBox(await res.text());
      },
      { minTime: '35ms' },
    );
  },
};
`;
}

function buildLabsWorkerEntrySource() {
  return `
import './labs-globals-init.js';
import { render } from '@lit-labs/ssr';
import { html } from 'lit';
import '@carbon/web-components/es/components/button/index.js';
import '@material/web/button/filled-button.js';
import '@awesome.me/webawesome/dist/components/button/button.js';
import './spectrum-labs-init.js';
import { CartActionElement, ProductInventoryElement } from './product-page-plain.ts';
import { ShippingEtaElement } from './shipping-eta-plain.ts';

const SECRET = 'm3-edge-bench-hmac-secret-key-32b!';
const encoder = new TextEncoder();
const PAGE_SHELL = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body><ecommerce-product-page sku="APX-9800"></ecommerce-product-page></body></html>';
const STREAM_SHELL = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body><ecommerce-product-page sku="APX-9800"></ecommerce-product-page><shipping-eta sku="APX-9800"></shipping-eta></body></html>';

let hmacKeyPromise = null;
function getBaselineHmacKey() {
  if (!hmacKeyPromise) {
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
  }
  return hmacKeyPromise;
}

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function collectLabsRender(tpl) {
  let out = '';
  for (const chunk of render(tpl)) {
    out += chunk;
  }
  return out;
}

const plainTemplates = {
  'product-page': () => html\`<ecommerce-product-page sku="APX-9800"></ecommerce-product-page>\`,
  carbon: () => html\`<cds-button kind="primary">Submit</cds-button>\`,
  spectrum: () => html\`<sp-button variant="accent">Click</sp-button>\`,
  webawesome: () => html\`<wa-button variant="brand">Click</wa-button>\`,
  material: () => html\`<md-filled-button>Click</md-filled-button>\`,
};

function transformBaselineHtmlRewriter(shellHtml, env) {
  const rewriter = new HTMLRewriter()
    .on('ecommerce-product-page', {
      async element(el) {
        const sku = el.getAttribute('sku') || 'APX-9800';
        const inv = new ProductInventoryElement();
        inv.sku = sku;
        await inv.loadInventory(env);
        const key = await getBaselineHmacKey();
        const sessionPayload = JSON.stringify({ sku, stock: inv.stock, cartCount: 0 });
        const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(sessionPayload));
        const dsd = collectLabsRender(html\`<ecommerce-product-page sku=\${sku} data-session-sig=\${toHex(sigBuf)} data-session-state=\${sessionPayload}></ecommerce-product-page>\`);
        el.replace(dsd, { html: true });
      },
    })
    .on('shipping-eta', {
      async element(el) {
        const sku = el.getAttribute('sku') || 'APX-9800';
        const eta = new ShippingEtaElement();
        eta.sku = sku;
        await eta.loadEta(env);
        const dsd = collectLabsRender(html\`<shipping-eta sku=\${sku}></shipping-eta>\`);
        el.replace(dsd, { html: true });
      },
    });
  return rewriter.transform(
    new Response(shellHtml, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  );
}

async function handleBaselineRestAction(req) {
  const body = await req.json();
  const key = await getBaselineHmacKey();
  const payload = JSON.stringify({ sku: body.sku, cartCount: body.cartCount });
  const valid = await crypto.subtle.verify('HMAC', key, fromHex(body.sig), encoder.encode(payload));
  if (!valid) {
    return Response.json({ error: 'Invalid signature' }, { status: 403 });
  }
  const cart = new CartActionElement();
  cart.sku = body.sku;
  cart.cartCount = body.cartCount;
  await cart.addToCart(body.sku, body.quantity);
  const nextPayload = JSON.stringify({ sku: cart.sku, cartCount: cart.cartCount });
  const nextSig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(nextPayload)));
  return Response.json({
    success: true,
    sku: cart.sku,
    cartCount: cart.cartCount,
    statusMessage: cart.statusMessage,
    sig: nextSig,
  });
}

async function makeBaselineRestRequest() {
  const key = await getBaselineHmacKey();
  const payload = JSON.stringify({ sku: 'APX-9800', cartCount: 0 });
  const sig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return () =>
    new Request('http://localhost/api/cart/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'APX-9800', cartCount: 0, quantity: 1, sig }),
    });
}

async function measureBaselineTimeline() {
  const res = transformBaselineHtmlRewriter(STREAM_SHELL, { latencyMs: 30, fastLatencyMs: 5 });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const t0 = performance.now();
  let ttfbMs = 0;
  let fastChunkMs = 0;
  let slowChunkMs = 0;
  let ttlbMs = 0;
  let fullHtml = '';

  while (true) {
    const { done, value } = await reader.read();
    const elapsed = Number((performance.now() - t0).toFixed(3));
    if (done) {
      ttlbMs = elapsed > 0 ? elapsed : 0.05;
      break;
    }
    const text = decoder.decode(value, { stream: true });
    fullHtml += text;
    if (ttfbMs === 0 && text.length > 0) {
      ttfbMs = elapsed > 0 ? elapsed : 0.05;
    }
    if (fastChunkMs === 0 && fullHtml.includes('<shipping-eta')) {
      fastChunkMs = elapsed > 0 ? elapsed : ttfbMs;
    }
    if (slowChunkMs === 0 && fullHtml.includes('<ecommerce-product-page')) {
      slowChunkMs = elapsed > 0 ? elapsed : ttfbMs;
    }
  }
  fullHtml += decoder.decode();
  if (ttfbMs === 0) ttfbMs = 0.05;
  if (fastChunkMs === 0) fastChunkMs = ttlbMs;
  if (slowChunkMs === 0) slowChunkMs = ttlbMs;
  if (ttlbMs < fastChunkMs) ttlbMs = fastChunkMs;
  if (ttlbMs < slowChunkMs) ttlbMs = slowChunkMs;
  return { ttfbMs, fastChunkMs, slowChunkMs, ttlbMs };
}

export const collectLabsArtifacts = {
  async test() {
    const plainOutputs = {};
    for (const [id, fn] of Object.entries(plainTemplates)) {
      plainOutputs[id] = collectLabsRender(fn());
    }
    const targetCHtml = await transformBaselineHtmlRewriter(PAGE_SHELL, { latencyMs: 0 }).text();
    const targetDHtml = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body>' + collectLabsRender(plainTemplates['product-page']()) + '</body></html>';
    const reqFactory = await makeBaselineRestRequest();
    const actionRes = await handleBaselineRestAction(reqFactory());
    const actionWireText = await actionRes.text();
    const timeline = await measureBaselineTimeline();
    console.log('__M3_LABS_ARTIFACTS__:' + JSON.stringify({
      plainOutputs,
      targetCHtml,
      targetDHtml,
      actionWireText,
      timeline,
    }));
  },
};

export default {
  async bench(b) {
    for (const fn of Object.values(plainTemplates)) {
      for (let w = 0; w < 80; w++) {
        collectLabsRender(fn());
      }
    }
    for (const [id, fn] of Object.entries(plainTemplates)) {
      await b.run('plain-labs-' + id, () => b.blackBox(collectLabsRender(fn())), { minTime: '80ms' });
    }

    await b.run(
      'target-c-render',
      async () => {
        const res = transformBaselineHtmlRewriter(PAGE_SHELL, { latencyMs: 0 });
        b.blackBox(await res.text());
      },
      { minTime: '35ms' },
    );

    const reqFactory = await makeBaselineRestRequest();
    await b.run(
      'target-c-action',
      async () => {
        const res = await handleBaselineRestAction(reqFactory());
        b.blackBox(await res.text());
      },
      { minTime: '35ms' },
    );

    await b.run('target-d-render', () => b.blackBox(collectLabsRender(plainTemplates['product-page']())), { minTime: '35ms' });
  },
};
`;
}

function runIsolatedNodeMeasurements(buildDir, actionHash) {
  const nodeRunnerPath = path.join(buildDir, 'node-runner.mjs');
  const script = `
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const mode = process.argv[2];
const root = ${JSON.stringify(monorepoRoot)};
const buildDir = ${JSON.stringify(buildDir)};
const benchReq = createRequire(${JSON.stringify(path.join(benchPkgDir, 'package.json'))});
const SECRET = 'm3-edge-bench-hmac-secret-key-32b!';
const PAGE_SHELL = '<!DOCTYPE html><html><head><title>Mechanical Keyboard Pro Store</title></head><body><ecommerce-product-page sku="APX-9800"></ecommerce-product-page></body></html>';
const TAG_MANIFEST = [
  'ecommerce-product-page',
  'ecommerce-header',
  'product-hero',
  'customer-rating-stars',
  'product-inventory',
  'product-options',
  'cart-action',
];

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = ~~(n / 2);
  const median = n % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Idx = ~~((n * 95) / 100);
  const p95 = sorted[p95Idx >= n ? n - 1 : p95Idx];
  return { medianMs: Number(median.toFixed(4)), p95Ms: Number(p95.toFixed(4)) };
}

function measureSync(fn, warmup = 160, batches = 40, batchSize = 15) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let s = 0; s < batches; s++) {
    const t0 = performance.now();
    for (let b = 0; b < batchSize; b++) fn();
    samples.push((performance.now() - t0) / batchSize);
  }
  return stats(samples);
}

async function measureAsync(fn, warmup = 20, iterations = 50) {
  for (let i = 0; i < warmup; i++) await fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

if (mode === 'core') {
  const ssr = await import(benchReq.resolve('@lit-core/ssr'));
  ssr.installIsolateGlobals();
  const se = await import(benchReq.resolve('@lit-core/server-elements'));
  if (!globalThis.CSS) {
    globalThis.CSS = { supports: () => false, escape: (s) => s };
  }
  const { html } = await import(benchReq.resolve('lit'));
  const specPkgReq = createRequire(benchReq.resolve('@spectrum-web-components/bundle/package.json'));
  const spButtonPath = specPkgReq.resolve('@spectrum-web-components/button/sp-button.js');
  globalThis.document = ssr.defaultDocumentStub;
  await import(path.join(buildDir, 'node-product-page-core.mjs'));
  await import(benchReq.resolve('@carbon/web-components/es/components/button/index.js'));
  await import(spButtonPath);
  await import(benchReq.resolve('@awesome.me/webawesome/dist/components/button/button.js'));
  await import(benchReq.resolve('@material/web/button/filled-button.js'));
  delete globalThis.document;

  const plainTemplates = {
    'product-page': () => html\`<ecommerce-product-page sku="APX-9800"></ecommerce-product-page>\`,
    carbon: () => html\`<cds-button kind="primary">Submit</cds-button>\`,
    spectrum: () => html\`<sp-button variant="accent">Click</sp-button>\`,
    webawesome: () => html\`<wa-button variant="brand">Click</wa-button>\`,
    material: () => html\`<md-filled-button>Click</md-filled-button>\`,
  };

  const plain = {};
  for (const [id, fn] of Object.entries(plainTemplates)) {
    plain[id] = measureSync(() =>
      ssr.renderToString(fn(), {
        resumable: false,
        cssFuse: false,
        customElements: globalThis.customElements,
      }),
    );
  }

  const targetARender = await measureAsync(async () => {
    await ssr.renderHtmlDocumentAsync(
      PAGE_SHELL,
      se.createServerElementsRewriterOptions({
        secret: SECRET,
        env: { latencyMs: 0 },
        customElements: globalThis.customElements,
      }),
    );
  });

  const signed = await se.renderServerElement('cart-action', { sku: 'APX-9800' }, {
    mode: 'dsd',
    secret: SECRET,
    customElements: globalThis.customElements,
  });
  const targetAAction = await measureAsync(async () => {
    const req = new Request('http://localhost/_lit/a/${actionHash}', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        Origin: 'http://localhost',
        'X-Lit-Action-Token': signed.token,
      },
      body: JSON.stringify({
        tag: 'cart-action',
        attrs: { sku: 'APX-9800' },
        state: signed.state,
        sig: signed.sig,
        args: ['APX-9800', 1],
        seq: 0,
      }),
    });
    const res = await se.handleActionRequest(req, {
      env: { LIT_ACTION_SECRET: SECRET },
      secret: SECRET,
      registry: globalThis.customElements,
    });
    await res.text();
  });

  console.log(JSON.stringify({ plain, targetARender, targetAAction }));
} else {
  const waReq = createRequire(benchReq.resolve('@awesome.me/webawesome/package.json'));
  await import(waReq.resolve('@lit-labs/ssr/lib/install-global-dom-shim.js'));
  const ssr = await import(benchReq.resolve('@lit-core/ssr'));
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }
  if (!globalThis.CSS) {
    globalThis.CSS = { supports: () => false, escape: (s) => s };
  }
  const labs = await import(waReq.resolve('@lit-labs/ssr'));
  const { html } = await import(benchReq.resolve('lit'));
  const specPkgReq = createRequire(benchReq.resolve('@spectrum-web-components/bundle/package.json'));
  const spButtonPath = specPkgReq.resolve('@spectrum-web-components/button/sp-button.js');
  const prevDoc = globalThis.document;
  globalThis.document = ssr.defaultDocumentStub;
  const ppMod = await import(path.join(buildDir, 'node-product-page-labs.mjs'));
  await import(benchReq.resolve('@carbon/web-components/es/components/button/index.js'));
  await import(spButtonPath);
  await import(benchReq.resolve('@awesome.me/webawesome/dist/components/button/button.js'));
  await import(benchReq.resolve('@material/web/button/filled-button.js'));
  globalThis.document = prevDoc;

  const collectLabs = (tpl) => {
    let out = '';
    for (const chunk of labs.render(tpl)) out += chunk;
    return out;
  };

  const plainTemplates = {
    'product-page': () => html\`<ecommerce-product-page sku="APX-9800"></ecommerce-product-page>\`,
    carbon: () => html\`<cds-button kind="primary">Submit</cds-button>\`,
    spectrum: () => html\`<sp-button variant="accent">Click</sp-button>\`,
    webawesome: () => html\`<wa-button variant="brand">Click</wa-button>\`,
    material: () => html\`<md-filled-button>Click</md-filled-button>\`,
  };

  const plain = {};
  for (const [id, fn] of Object.entries(plainTemplates)) {
    plain[id] = measureSync(() => collectLabs(fn()));
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));

  const targetCRender = await measureAsync(async () => {
    const inv = new ppMod.ProductInventoryElement();
    inv.sku = 'APX-9800';
    await inv.loadInventory({ latencyMs: 0 });
    const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify({ sku: 'APX-9800', stock: inv.stock, cartCount: 0 })));
    const dsd = collectLabs(plainTemplates['product-page']());
    void toHex(sigBuf);
    void dsd;
  });

  const initPayload = JSON.stringify({ sku: 'APX-9800', cartCount: 0 });
  const initSig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(initPayload)));
  const targetCAction = await measureAsync(async () => {
    const req = new Request('http://localhost/api/cart/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'APX-9800', cartCount: 0, quantity: 1, sig: initSig }),
    });
    const body = await req.json();
    const ok = await crypto.subtle.verify('HMAC', key, fromHex(body.sig), encoder.encode(JSON.stringify({ sku: body.sku, cartCount: body.cartCount })));
    if (!ok) throw new Error('verify failed');
    const cart = new ppMod.CartActionElement();
    cart.sku = body.sku;
    cart.cartCount = body.cartCount;
    await cart.addToCart(body.sku, body.quantity);
    const nextSig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify({ sku: cart.sku, cartCount: cart.cartCount }))));
    await Response.json({ success: true, sku: cart.sku, cartCount: cart.cartCount, statusMessage: cart.statusMessage, sig: nextSig }).text();
  });

  const targetDRender = plain['product-page'];
  console.log(JSON.stringify({ plain, targetCRender, targetCAction, targetDRender }));
}
`;
  fs.writeFileSync(nodeRunnerPath, script, 'utf-8');

  const childEnv = { ...process.env, NODE_ENV: 'production' };
  const coreProc = spawnSync(process.execPath, ['--conditions=production', nodeRunnerPath, 'core'], { cwd: monorepoRoot, env: childEnv, encoding: 'utf-8', timeout: 30_000 });
  if (coreProc.status !== 0) {
    throw new Error(`Node core benchmark subprocess failed: ${coreProc.stderr || coreProc.stdout}`);
  }
  const labsProc = spawnSync(process.execPath, ['--conditions=production', nodeRunnerPath, 'labs'], { cwd: monorepoRoot, env: childEnv, encoding: 'utf-8', timeout: 30_000 });
  if (labsProc.status !== 0) {
    throw new Error(`Node labs benchmark subprocess failed: ${labsProc.stderr || labsProc.stdout}`);
  }

  const coreLine = coreProc.stdout.trim().split('\n').pop();
  const labsLine = labsProc.stdout.trim().split('\n').pop();
  return {
    core: JSON.parse(coreLine),
    labs: JSON.parse(labsLine),
  };
}

let cachedWorkerdAndNodeSuitePromise = null;

export async function runWorkerdAndNodeBenchmarks() {
  if (!cachedWorkerdAndNodeSuitePromise) {
    cachedWorkerdAndNodeSuitePromise = (async () => {
      const { build } = benchReq('vite');
      const esbuild = createRequire(benchReq.resolve('vite'))('esbuild');
      const litReq = createRequire(benchReq.resolve('lit'));
      const { propsLower, serverElements } = await import(path.join(monorepoRoot, 'packages/bundlers/vite-plugin/dist/index.js'));
      const { compileHtmlAot } = await import(path.join(monorepoRoot, 'packages/transforms/html-aot/src/index.js'));

      const rawProductPage = fs.readFileSync(fixturePath, 'utf-8');
      const splitProductPage = await splitAllServerElementsInFile(rawProductPage, 'product-page.ts');
      const splitShipping = await splitAllServerElementsInFile(FAST_SHIPPING_SOURCE, 'shipping-eta.ts');
      const addToCartMeta = splitProductPage.actions.find((a) => a.name === 'addToCart');
      const actionHash = addToCartMeta ? addToCartMeta.hash : 'addToCart';

      const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lit-m3-workerd-bench-'));
      try {
        const specPkgReq = createRequire(benchReq.resolve('@spectrum-web-components/bundle/package.json'));
        const spectrumBundlePath = specPkgReq.resolve('@spectrum-web-components/button/sp-button.js');
        const spectrumDocOnCode = `
import { defaultDocumentStub } from '@lit-core/ssr';
globalThis.__prevCoreDoc = globalThis.document;
globalThis.document = defaultDocumentStub;
`;
        const spectrumDocOffCode = `
if (globalThis.__prevCoreDoc === undefined) {
  delete globalThis.document;
} else {
  globalThis.document = globalThis.__prevCoreDoc;
}
delete globalThis.__prevCoreDoc;
`;
        const spectrumCoreInitCode = `
import './spectrum-doc-on.js';
import ${JSON.stringify(spectrumBundlePath)};
import './spectrum-doc-off.js';
`;
        const labsGlobalsInitCode = `
import '@lit-labs/ssr/lib/install-global-dom-shim.js';
import { defaultDocumentStub } from '@lit-core/ssr';
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = { supports: () => false, escape: (s) => String(s) };
}
if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
}
globalThis.__prevLabsDoc = globalThis.document;
globalThis.document = defaultDocumentStub;
`;
        const spectrumLabsInitCode = `
import ${JSON.stringify(spectrumBundlePath)};
if (globalThis.__prevLabsDoc === undefined) {
  delete globalThis.document;
} else {
  globalThis.document = globalThis.__prevLabsDoc;
}
delete globalThis.__prevLabsDoc;
`;

        const coreWorkerEntryCode = buildCoreWorkerEntrySource(actionHash);

        const coreEntryFile = path.join(benchPkgDir, `.tmp-m3-core-entry-${process.pid}.ts`);
        const corePpFile = path.join(benchPkgDir, `.tmp-m3-pp-split-${process.pid}.ts`);
        const coreShipFile = path.join(benchPkgDir, `.tmp-m3-ship-split-${process.pid}.ts`);
        const coreSpecInitFile = path.join(benchPkgDir, `.tmp-m3-spec-init-${process.pid}.js`);
        const coreSpecOnFile = path.join(benchPkgDir, `.tmp-m3-spec-on-${process.pid}.js`);
        const coreSpecOffFile = path.join(benchPkgDir, `.tmp-m3-spec-off-${process.pid}.js`);

        const patchedCoreEntry = coreWorkerEntryCode
          .replace("'./spectrum-init.js'", JSON.stringify(`./${path.basename(coreSpecInitFile)}`))
          .replace("'./product-page-split.ts'", JSON.stringify(`./${path.basename(corePpFile)}`))
          .replace("'./shipping-eta-split.ts'", JSON.stringify(`./${path.basename(coreShipFile)}`));
        const patchedSpecInit = spectrumCoreInitCode
          .replace("'./spectrum-doc-on.js'", JSON.stringify(`./${path.basename(coreSpecOnFile)}`))
          .replace("'./spectrum-doc-off.js'", JSON.stringify(`./${path.basename(coreSpecOffFile)}`));

        fs.writeFileSync(coreEntryFile, patchedCoreEntry, 'utf-8');
        fs.writeFileSync(corePpFile, splitProductPage.workerCode, 'utf-8');
        fs.writeFileSync(coreShipFile, splitShipping.workerCode, 'utf-8');
        fs.writeFileSync(coreSpecInitFile, patchedSpecInit, 'utf-8');
        fs.writeFileSync(coreSpecOnFile, spectrumDocOnCode, 'utf-8');
        fs.writeFileSync(coreSpecOffFile, spectrumDocOffCode, 'utf-8');

        const prevNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
          // 1. Build Service 1 (@lit-core worker) with Vite + propsLower + serverElements({ target: 'worker' })
          await build({
            root: benchPkgDir,
            mode: 'production',
            logLevel: 'silent',
            configFile: false,
            resolve: {
              conditions: ['production', 'workerd', 'worker', 'node', 'import'],
            },
            ssr: { noExternal: true },
            build: {
              write: true,
              outDir: buildDir,
              emptyOutDir: false,
              minify: false,
              ssr: true,
              rollupOptions: {
                input: coreEntryFile,
                external: [/ssr_bg\.wasm$/],
                output: { format: 'es', entryFileNames: 'core-worker.mjs', codeSplitting: false },
              },
            },
            plugins: [propsLower(), serverElements({ target: 'worker' })],
          });
        } finally {
          if (prevNodeEnv === undefined) {
            delete process.env.NODE_ENV;
          } else {
            process.env.NODE_ENV = prevNodeEnv;
          }
          for (const f of [coreEntryFile, corePpFile, coreShipFile, coreSpecInitFile, coreSpecOnFile, coreSpecOffFile]) {
            fs.rmSync(f, { force: true });
          }
        }

        fs.copyFileSync(ssrWasmSourcePath, path.join(buildDir, 'ssr_bg.wasm'));

        // 2. Build Service 2 (@lit-labs/ssr + HTMLRewriter REST baseline worker) with esbuild
        const labsEntryFile = path.join(buildDir, 'labs-entry.ts');
        fs.writeFileSync(path.join(buildDir, 'labs-globals-init.js'), labsGlobalsInitCode, 'utf-8');
        fs.writeFileSync(path.join(buildDir, 'product-page-plain.ts'), splitProductPage.workerCode, 'utf-8');
        fs.writeFileSync(path.join(buildDir, 'shipping-eta-plain.ts'), splitShipping.workerCode, 'utf-8');
        fs.writeFileSync(path.join(buildDir, 'spectrum-labs-init.js'), spectrumLabsInitCode, 'utf-8');
        fs.writeFileSync(labsEntryFile, buildLabsWorkerEntrySource(), 'utf-8');

        await esbuild.build({
          entryPoints: [labsEntryFile],
          bundle: true,
          format: 'esm',
          platform: 'neutral',
          target: 'es2022',
          conditions: ['production', 'workerd', 'worker', 'node', 'import'],
          mainFields: ['module', 'main'],
          absWorkingDir: benchPkgDir,
          nodePaths: [path.join(benchPkgDir, 'node_modules'), path.join(monorepoRoot, 'node_modules'), path.join(monorepoRoot, 'node_modules/.pnpm/node_modules')],
          tsconfigRaw: {
            compilerOptions: {
              experimentalDecorators: true,
              useDefineForClassFields: false,
            },
          },
          external: ['node:*', 'buffer', 'crypto', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'stream', 'tls', 'url', 'util', 'zlib', 'data:text/css*'],
          outfile: path.join(buildDir, 'labs-worker.mjs'),
        });

        // 3. Build lightweight Node.js product-page modules (transpile TS decorators first, then compileHtmlAot for core)
        const corePpRawTs = path.join(buildDir, 'node-pp-raw.ts');
        fs.writeFileSync(corePpRawTs, splitProductPage.workerCode, 'utf-8');
        const transpiledPp = await esbuild.build({
          entryPoints: [corePpRawTs],
          bundle: false,
          write: false,
          format: 'esm',
          target: 'es2022',
          tsconfigRaw: {
            compilerOptions: {
              experimentalDecorators: true,
              useDefineForClassFields: false,
            },
          },
        });
        const rawTranspiledJs = transpiledPp.outputFiles[0].text;
        const rewriteLitImports = (src) =>
          src
            .replace(/['"]lit-html\/private-ssr-support\.js['"]/g, JSON.stringify(litReq.resolve('lit-html/private-ssr-support.js')))
            .replace(/['"]lit((?:\/[^'"]*)?)['"]/g, (_, sub) => JSON.stringify(benchReq.resolve(`lit${sub}`)))
            .replace(/['"]@lit-core\/server-elements((?:\/[^'"]*)?)['"]/g, (_, sub) => JSON.stringify(benchReq.resolve(`@lit-core/server-elements${sub}`)));

        fs.writeFileSync(path.join(buildDir, 'node-product-page-labs.mjs'), rewriteLitImports(rawTranspiledJs), 'utf-8');
        const coreAotJs = compileHtmlAot(rawTranspiledJs, { filename: 'product-page.js', ssr: true, minify: false }).code;
        fs.writeFileSync(path.join(buildDir, 'node-product-page-core.mjs'), rewriteLitImports(coreAotJs), 'utf-8');

        // 4. Write multi-service workerd capnp config and execute `workerd test` + `workerd bench --format=json`
        const benchCapnpPath = path.join(buildDir, 'bench.capnp');
        fs.writeFileSync(
          benchCapnpPath,
          `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    ( name = "core", worker = .coreWorker ),
    ( name = "labs", worker = .labsWorker ),
  ],
);
const coreWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "core-worker.mjs" ),
    ( name = "./ssr_bg.wasm", wasm = embed "ssr_bg.wasm" ),
  ],
  compatibilityDate = "2026-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
const labsWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "labs-worker.mjs" ),
  ],
  compatibilityDate = "2026-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`,
          'utf-8',
        );

        const coreTestCapnpPath = path.join(buildDir, 'test-core.capnp');
        fs.writeFileSync(
          coreTestCapnpPath,
          `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ ( name = "core", worker = .coreWorker ) ],
);
const coreWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "core-worker.mjs" ),
    ( name = "./ssr_bg.wasm", wasm = embed "ssr_bg.wasm" ),
  ],
  compatibilityDate = "2026-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`,
          'utf-8',
        );

        const labsTestCapnpPath = path.join(buildDir, 'test-labs.capnp');
        fs.writeFileSync(
          labsTestCapnpPath,
          `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [ ( name = "labs", worker = .labsWorker ) ],
);
const labsWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "labs-worker.mjs" ),
  ],
  compatibilityDate = "2026-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`,
          'utf-8',
        );

        const coreTestProc = spawnSync(workerdBin, ['test', coreTestCapnpPath], { cwd: buildDir, encoding: 'utf-8', timeout: 30_000 });
        if (coreTestProc.status !== 0) {
          throw new Error(`workerd test (core) failed: ${coreTestProc.stderr}\n${coreTestProc.stdout}`);
        }
        const labsTestProc = spawnSync(workerdBin, ['test', labsTestCapnpPath], { cwd: buildDir, encoding: 'utf-8', timeout: 30_000 });
        if (labsTestProc.status !== 0) {
          throw new Error(`workerd test (labs) failed: ${labsTestProc.stderr}\n${labsTestProc.stdout}`);
        }

        const coreArtLine = `${coreTestProc.stdout}\n${coreTestProc.stderr}`.split('\n').find((l) => l.includes('__M3_CORE_ARTIFACTS__:'));
        const labsArtLine = `${labsTestProc.stdout}\n${labsTestProc.stderr}`.split('\n').find((l) => l.includes('__M3_LABS_ARTIFACTS__:'));
        if (!coreArtLine || !labsArtLine) {
          throw new Error('Missing artifact markers from workerd test output');
        }
        const coreArtifacts = JSON.parse(coreArtLine.slice(coreArtLine.indexOf('__M3_CORE_ARTIFACTS__:') + '__M3_CORE_ARTIFACTS__:'.length));
        const labsArtifacts = JSON.parse(labsArtLine.slice(labsArtLine.indexOf('__M3_LABS_ARTIFACTS__:') + '__M3_LABS_ARTIFACTS__:'.length));

        const benchProc = spawnSync(workerdBin, ['bench', '--format=json', benchCapnpPath], { cwd: buildDir, encoding: 'utf-8', timeout: 45_000 });
        if (benchProc.status !== 0) {
          throw new Error(`workerd bench failed: ${benchProc.stderr}\n${benchProc.stdout}`);
        }
        const benchJson = JSON.parse(benchProc.stdout.trim());
        const workerdVersion = benchJson.environment?.workerdVersion || 'unknown';
        const workerdCases = new Map();
        for (const group of benchJson.groups || []) {
          for (const c of group.cases || []) {
            const samples = c.cpuNs?.samples?.filter((x) => x > 0);
            const fallbackSamples = samples && samples.length > 0 ? samples : c.wallNs?.samples || [];
            workerdCases.set(c.name, computePercentilesFromNs(fallbackSamples));
          }
        }

        const nodeResults = runIsolatedNodeMeasurements(buildDir, actionHash);

        return {
          workerdVersion,
          workerdEnvironmentLabel: `Cloudflare workerd ${workerdVersion} (${process.platform} ${process.arch})`,
          nodeEnvironmentLabel: `Node.js ${process.version} (${process.platform} ${process.arch})`,
          coreArtifacts,
          labsArtifacts,
          workerdCases,
          nodeResults,
        };
      } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
      }
    })();
  }
  return cachedWorkerdAndNodeSuitePromise;
}
