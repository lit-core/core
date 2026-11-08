import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { bundleComponentForBrowser } from '../bundler.js';
import { resolvePackageDir } from '../components.js';
import { getTestBrowser, setupTestPage } from '../harness.js';

const fixtureDir = path.resolve(fileURLToPath(import.meta.url), '../../../dist/fixtures/server-elements-workerd');
const capnpPath = path.join(fixtureDir, 'config.capnp');
const workerdBin = path.resolve(fileURLToPath(import.meta.url), '../../../../../../node_modules/.bin/workerd');
const ssrWasmSourcePath = path.resolve(fileURLToPath(import.meta.url), '../../../../../rendering/ssr/wasm/ssr_bg.wasm');
const spectrumButtonEntry = path.join(resolvePackageDir('@spectrum-web-components'), 'button/sp-button.js');

const COMPONENT_FIXTURE = `
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { loader, action } from '@lit-core/server-elements';

export const loaderTimings: Record<string, { start: number; end: number; inFlight?: number }> = {};
export const loaderConcurrency = { active: 0, maxActive: 0 };

export class ServerProductCounter extends LitElement {
  @property({ type: String }) title = 'Workerd Counter';
  @state() count = 0;
  @state() status = 'idle';

  @loader()
  async load() {
    const start = Date.now();
    loaderConcurrency.active += 1;
    if (loaderConcurrency.active > loaderConcurrency.maxActive) {
      loaderConcurrency.maxActive = loaderConcurrency.active;
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 70));
      this.count = 0;
      this.status = 'loaded';
      loaderTimings['counter'] = { start, end: Date.now(), inFlight: loaderConcurrency.maxActive };
    } finally {
      loaderConcurrency.active -= 1;
    }
  }

  @action()
  async increment() {
    this.count += 1;
    this.status = 'incremented';
  }

  @action()
  async setCount(next: number) {
    this.count = next;
    this.status = 'set';
  }

  render() {
    return html\`
      <div class="product" data-status="\${this.status}">
        <span class="count">\${this.count}</span>
        <button class="inc" @click="\${this.increment}">Add</button>
      </div>
    \`;
  }
}
customElements.define('server-product-counter', ServerProductCounter);
`;

const INVENTORY_COMPONENT_FIXTURE = `
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { loader, action } from '@lit-core/server-elements';
import { loaderConcurrency, loaderTimings } from './component.ts';

export class ServerInventoryBadge extends LitElement {
  @state() stock = 0;
  @state() warehouse = 'pending';

  @loader()
  async load() {
    const start = Date.now();
    loaderConcurrency.active += 1;
    if (loaderConcurrency.active > loaderConcurrency.maxActive) {
      loaderConcurrency.maxActive = loaderConcurrency.active;
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 70));
      this.stock = 10;
      this.warehouse = 'eu-west';
      loaderTimings['inventory'] = { start, end: Date.now(), inFlight: loaderConcurrency.maxActive };
    } finally {
      loaderConcurrency.active -= 1;
    }
  }

  @action()
  async restock() {
    this.stock += 5;
  }

  render() {
    return html\`
      <div class="inventory" data-warehouse="\${this.warehouse}">
        <span class="stock">\${this.stock}</span>
        <button class="restock" @click="\${this.restock}">Restock</button>
      </div>
    \`;
  }
}
customElements.define('server-inventory-badge', ServerInventoryBadge);
`;

const WORKERD_HARNESS_TEMPLATE = `
import 'virtual:lit-core/install-globals';
import ssrWasmModule from './ssr_bg.wasm';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { createSignedStateSnapshot } from '@lit-core/server-elements/crypto';
import { renderServerElement, transformServerElementsWithHtmlRewriter } from '@lit-core/server-elements/edge';
import { initSsrWasmSync, renderToString, transformWithHtmlRewriter } from '@lit-core/ssr';
import { html } from 'lit';
import '@carbon/web-components/es/components/button/index.js';
import '@material/web/button/filled-button.js';
import ${JSON.stringify(spectrumButtonEntry)};
import '@awesome.me/webawesome/dist/components/button/button.js';
import { loaderTimings, ServerProductCounter } from './component.ts';
import { ServerInventoryBadge } from './inventory-badge.ts';

initSsrWasmSync(ssrWasmModule);

const TEST_SECRET = 'workerd-golden-e2e-secret-key-32b!!';

export async function executeWorkerdAction(url, headers, body) {
  const req = new Request(url, { method: 'POST', headers, body });
  const res = await handleActionRequest(req, {
    env: {},
    secret: TEST_SECRET,
    registry: globalThis.customElements,
  });
  return {
    status: res.status,
    contentType: res.headers.get('Content-Type') || 'application/x-ndjson',
    body: await res.text(),
  };
}

export const testNativeHtmlRewriter = {
  async test(ctrl, env, ctx) {
    if (typeof HTMLRewriter === 'undefined') {
      throw new Error('Native HTMLRewriter is not available in workerd environment');
    }

    const rewriter = new HTMLRewriter().on('span.echo', {
      element(el) {
        el.setInnerContent('native-workerd-rewriter-active', { html: false });
      }
    });

    const res = rewriter.transform(
      new Response('<span class="echo">pending</span>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    );

    const body = await res.text();
    if (!body.includes('native-workerd-rewriter-active')) {
      throw new Error('HTMLRewriter transform failed in workerd: ' + body);
    }
  }
};

export const testProgressiveDsdStreaming = {
  async test(ctrl, env, ctx) {
    const htmlPage = '<!DOCTYPE html><html><body><async-counter delay="30"></async-counter></body></html>';

    const response = transformWithHtmlRewriter(htmlPage, {
      tagManifest: ['async-counter'],
      islands: {
        'async-counter': {
          pending: () => '<div class="skeleton">Loading...</div>',
          render: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return '<div class="resolved">Counter Ready</div>';
          }
        }
      }
    });

    if (response.status !== 200) {
      throw new Error('Expected 200 from transformWithHtmlRewriter, got ' + response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let initialChunks = '';
    let foundResolved = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      if (!foundResolved) {
        if (text.includes('Counter Ready')) {
          foundResolved = true;
        } else {
          initialChunks += text;
        }
      }
      accumulated += text;
    }

    if (!initialChunks.includes('<slot name="pending">') && !initialChunks.includes('Loading...')) {
      throw new Error('Initial stream chunks must flush shell and pending slot without blocking');
    }
    if (!accumulated.includes('Counter Ready')) {
      throw new Error('Stream did not flush resolved island markup');
    }
    if (!accumulated.includes('</body>') || !accumulated.includes('</html>')) {
      throw new Error('Stream missing trailing closing tags');
    }
  }
};

export const testHtmlRewriterConcurrentLoaders = {
  async test(ctrl, env, ctx) {
    delete loaderTimings['counter'];
    delete loaderTimings['inventory'];

    const pageHtml = '<!DOCTYPE html><html><head></head><body><main><server-product-counter id="counter-el"></server-product-counter><server-inventory-badge id="inventory-el"></server-inventory-badge></main></body></html>';
    const t0 = Date.now();
    const res = transformServerElementsWithHtmlRewriter(pageHtml, {
      secret: TEST_SECRET,
      tagManifest: ['server-product-counter', 'server-inventory-badge'],
      customElements: globalThis.customElements,
    });
    const outHtml = await res.text();
    const elapsedMs = Date.now() - t0;

    const tCounter = loaderTimings['counter'];
    const tInventory = loaderTimings['inventory'];
    if (!tCounter || !tInventory) {
      throw new Error('Expected both @loader() methods to execute in HTMLRewriter pipeline');
    }

    // Both 70ms loaders must overlap in time and execute concurrently in-flight (not a sequential waterfall)
    const overlapped = tCounter.start < tInventory.end && tInventory.start < tCounter.end;
    const maxInFlight = Math.max(tCounter.inFlight ?? 0, tInventory.inFlight ?? 0);
    if (!overlapped || maxInFlight < 2) {
      throw new Error('Expected concurrent @loader() execution in HTMLRewriter pipeline, got elapsedMs=' + elapsedMs + ' timings=' + JSON.stringify(loaderTimings));
    }

    const hasAttrOrStreamedAttr = (attrName, expectedVal) => {
      if (expectedVal === undefined) {
        return outHtml.includes(attrName + '=') || outHtml.includes('"' + attrName + '":');
      }
      return (
        outHtml.includes(attrName + '="' + expectedVal + '"') ||
        outHtml.includes('"' + attrName + '":"' + expectedVal + '"')
      );
    };

    if (
      !hasAttrOrStreamedAttr('data-lit-sig') ||
      !hasAttrOrStreamedAttr('data-lit-token') ||
      !hasAttrOrStreamedAttr('data-lit-state')
    ) {
      throw new Error('Expected HTMLRewriter server elements pipeline to sign state and attach tokens, got: ' + outHtml);
    }
    if (!hasAttrOrStreamedAttr('data-lit-ssr', '0') || !hasAttrOrStreamedAttr('data-lit-ssr', '1')) {
      throw new Error('Expected unique per-request host IDs (0 and 1), got: ' + outHtml);
    }
    if (outHtml.includes('lit/state')) {
      throw new Error('HTMLRewriter server elements must not emit <script type="lit/state">');
    }

    console.log('__WORKERD_REWRITER_PAGE__:' + JSON.stringify({
      html: outHtml,
      counterActions: ServerProductCounter.__lit_actions || {},
      inventoryActions: ServerInventoryBadge.__lit_actions || {},
    }));
  }
};

export const testActionEndpointExecution = {
  async test(ctrl, env, ctx) {
    const actionHash = Object.keys(ServerProductCounter.__lit_actions || {})[0];
    if (!actionHash) {
      throw new Error('Action hash not found on ServerProductCounter.__lit_actions');
    }

    const signed = await createSignedStateSnapshot(
      'server-product-counter',
      { count: 5, status: 'loaded' },
      TEST_SECRET,
      900_000,
      { seq: 0, buildId: 'dev' }
    );

    const actionReq = new Request('http://worker.local/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/x-ndjson',
        'X-Lit-Action-Token': signed.token,
      },
      body: JSON.stringify({
        tag: 'server-product-counter',
        state: signed.state,
        sig: signed.sig,
        args: [],
        seq: 1,
      }),
    });

    const res = await handleActionRequest(actionReq, {
      env: {},
      secret: TEST_SECRET,
      registry: (globalThis).customElements,
    });

    if (res.status !== 200) {
      throw new Error('Expected status 200 from handleActionRequest, got ' + res.status);
    }

    const streamText = await res.text();
    const frames = streamText.split('\\n').filter(Boolean).map((line) => JSON.parse(line));
    const partFrames = frames.filter((f) => 'p' in f);

    if (partFrames.length === 0) {
      throw new Error('Expected surgical dirty part frames in action response stream');
    }

    const stateFrame = frames.find((f) => 's' in f);
    if (!stateFrame || !stateFrame.sig) {
      throw new Error('Expected signed state update frame in action response stream');
    }

    // Empty-state bypass validation
    const emptyReq = new Request('http://worker.local/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: 'server-product-counter',
        state: {},
        sig: '',
        args: [],
        seq: 1,
      }),
    });
    const emptyRes = await handleActionRequest(emptyReq, {
      env: {},
      secret: TEST_SECRET,
      registry: (globalThis).customElements,
    });
    if (emptyRes.status !== 403) {
      throw new Error('Expected 403 for empty-state bypass, got ' + emptyRes.status);
    }
    const emptyJson = await emptyRes.json();
    if (emptyJson.code !== 'STATE_TAMPERED') {
      throw new Error('Expected STATE_TAMPERED code, got ' + emptyJson.code);
    }

    // BuildId mismatch validation
    (ServerProductCounter as any).__litBuildId = 'build-v2.0.0';
    try {
      const staleReq = new Request('http://worker.local/_lit/a/' + actionHash, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lit-Action-Token': signed.token,
        },
        body: JSON.stringify({
          tag: 'server-product-counter',
          state: signed.state,
          sig: signed.sig,
          args: [],
          seq: 1,
          attrs: { 'data-lit-build-id': 'build-v1.0.0' },
        }),
      });
      const staleRes = await handleActionRequest(staleReq, {
        env: {},
        secret: TEST_SECRET,
        registry: (globalThis).customElements,
        buildId: 'build-v2.0.0',
      });
      if (staleRes.status !== 409) {
        throw new Error('Expected 409 for buildId mismatch, got ' + staleRes.status);
      }
      const staleJson = await staleRes.json();
      if (staleJson.code !== 'ACTION_STALE') {
        throw new Error('Expected ACTION_STALE code, got ' + staleJson.code);
      }
    } finally {
      (ServerProductCounter as any).__litBuildId = 'dev';
    }
  }
};

export const testRenderAndActionRoundTrip = {
  async test(ctrl, env, ctx) {
    const rendered = await renderServerElement('server-product-counter', {}, {
      secret: TEST_SECRET,
      customElements: globalThis.customElements,
    });

    if (!rendered.html.includes('shadowrootmode="open"')) {
      throw new Error('Expected Declarative Shadow DOM from the real component render, got: ' + rendered.html);
    }
    if (!rendered.html.includes('data-status="loaded"') || !rendered.html.includes('class="count"')) {
      throw new Error('Expected the real component template to be rendered, got: ' + rendered.html);
    }
    if (rendered.html.includes('<script') && rendered.html.includes('lit/state')) {
      throw new Error('Server element render must use a single state transport (data-lit-state)');
    }

    const actionHash = Object.keys(ServerProductCounter.__lit_actions || {})[0];
    const callAction = async (snapshot, snapshotSeq) => {
      const req = new Request('http://worker.local/_lit/a/' + actionHash, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/x-ndjson',
          'X-Lit-Action-Token': rendered.token,
        },
        body: JSON.stringify({
          tag: 'server-product-counter',
          state: snapshot.s ?? snapshot.state,
          sig: snapshot.sig,
          args: [],
          seq: 1,
          snapshotSeq,
        }),
      });
      return handleActionRequest(req, { env: {}, secret: TEST_SECRET, registry: globalThis.customElements });
    };

    // 1. First action consumes the SSR snapshot (snapshot sequence 0) and returns snapshot sequence 1.
    const first = await callAction({ state: rendered.state, sig: rendered.sig }, 0);
    if (first.status !== 200) {
      throw new Error('Expected 200 for the first action on the SSR snapshot, got ' + first.status);
    }
    const firstFrames = (await first.text()).split('\\n').filter(Boolean).map((line) => JSON.parse(line));
    const stateFrame = firstFrames.find((f) => 's' in f);
    if (!stateFrame || stateFrame.sq !== 1) {
      throw new Error('Expected a signed state frame with snapshot sequence 1, got ' + JSON.stringify(stateFrame));
    }

    // 2. The returned snapshot is valid at exactly its own sequence number.
    const second = await callAction(stateFrame, 1);
    if (second.status !== 200) {
      throw new Error('Expected 200 for the second action on snapshot sequence 1, got ' + second.status);
    }

    // 3. Replaying that snapshot under any other sequence number is rejected.
    const replayed = await callAction(stateFrame, 0);
    if (replayed.status !== 403) {
      throw new Error('Expected 403 when replaying a snapshot under a different sequence, got ' + replayed.status);
    }

    // 4. Rendering without a secret fails closed even though nodejs_compat exposes process.
    let failedClosed = false;
    try {
      await renderServerElement('server-product-counter', {}, { customElements: globalThis.customElements });
    } catch (err) {
      failedClosed = /Missing mandatory secret/.test(String(err && err.message));
    }
    if (!failedClosed) {
      throw new Error('Expected renderServerElement to fail closed without a secret');
    }
  }
};

export const testDesignSystemComponents = {
  async test(ctrl, env, ctx) {
    const cases = {
      carbon: ['cds-button', html\`<cds-button kind="primary">Submit</cds-button>\`],
      material: ['md-filled-button', html\`<md-filled-button>Click</md-filled-button>\`],
      spectrum: ['sp-button', html\`<sp-button variant="accent">Save</sp-button>\`],
      webawesome: ['wa-button', html\`<wa-button variant="brand">Click</wa-button>\`],
    };
    const renderedOutputs: Record<string, string> = {};
    for (const [key, [tag, template]] of Object.entries(cases)) {
      const out = renderToString(template);
      if (!out.includes('<' + tag) || !out.includes('shadowrootmode="open"')) {
        throw new Error('Expected ' + tag + ' to render Declarative Shadow DOM inside workerd, got: ' + out.slice(0, 300));
      }
      renderedOutputs[key] = out;
    }
    console.log('__WORKERD_DS_OUTPUT__:' + JSON.stringify(renderedOutputs));
  }
};

export const testSecurityTamperRejection = {
  async test(ctrl, env, ctx) {
    const actionHash = Object.keys(ServerProductCounter.__lit_actions || {})[0];
    if (!actionHash) {
      throw new Error('Action hash not found on ServerProductCounter.__lit_actions');
    }

    const tamperedReq = new Request('http://worker.local/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: 'server-product-counter',
        state: { count: 9999 },
        sig: 'forged.signature',
        args: [],
        seq: 2,
      }),
    });

    const res = await handleActionRequest(tamperedReq, {
      env: {},
      secret: TEST_SECRET,
      registry: (globalThis).customElements,
    });

    if (res.status !== 403) {
      throw new Error('Expected 403 for forged signature, got ' + res.status);
    }
    const body = await res.json();
    if (body.code !== 'STATE_TAMPERED') {
      throw new Error('Expected STATE_TAMPERED error code, got ' + body.code);
    }
  }
};
`;

const TEST_SECRET_NODE = 'workerd-golden-e2e-secret-key-32b!!';

describe('milestone m6 tier b acceptance test: real workerd execution', () => {
  let workerdOutput = '';
  let workerdExitCode = -1;
  let workerdDesignSystemOutputs: Record<string, string> = {};
  let workerdRewriterPayload: { html: string; counterActions: Record<string, string>; inventoryActions: Record<string, string> } | null = null;

  beforeAll(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });

    // 1. Programmatic Vite bundle with ssr: { noExternal: true }
    await build({
      root: path.resolve(fileURLToPath(import.meta.url), '../../..'),
      logLevel: 'silent',
      configFile: false,
      build: {
        write: true,
        outDir: fixtureDir,
        minify: false,
        ssr: true,
        rollupOptions: {
          input: 'entry.ts',
          external: ['./ssr_bg.wasm'],
          output: { format: 'es', entryFileNames: 'worker-bundle.mjs' },
        },
      },
      ssr: {
        noExternal: true,
      },
      plugins: [
        {
          name: 'virtual-entry',
          resolveId(id) {
            if (id === 'entry.ts') return '\0entry.ts';
            if (id === './component.ts' || id === './component.js') return '\0component.ts';
            if (id === './inventory-badge.ts' || id === './inventory-badge.js') return '\0inventory-badge.ts';
          },
          load(id) {
            if (id === '\0entry.ts') return WORKERD_HARNESS_TEMPLATE;
            if (id === '\0component.ts') return COMPONENT_FIXTURE;
            if (id === '\0inventory-badge.ts') return INVENTORY_COMPONENT_FIXTURE;
          },
        },
        propsLower(),
        serverElements({ target: 'worker' }),
      ],
    });

    const emittedWasmPath = path.join(fixtureDir, 'ssr_bg.wasm');
    if (!fs.existsSync(emittedWasmPath) && fs.existsSync(ssrWasmSourcePath)) {
      fs.copyFileSync(ssrWasmSourcePath, emittedWasmPath);
    }

    // 2. Generate socketless Cap'n Proto configuration embedding ssr_bg.wasm
    const capnpContent = `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "main", worker = .mainWorker )
  ],
);

const mainWorker :Workerd.Worker = (
  modules = [
    ( name = "worker", esModule = embed "worker-bundle.mjs" ),
    ( name = "./ssr_bg.wasm", wasm = embed "ssr_bg.wasm" )
  ],
  compatibilityDate = "2024-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`;
    fs.writeFileSync(capnpPath, capnpContent);

    // 3. Execute workerd test in-process inside standard sandbox
    const proc = spawnSync(workerdBin, ['test', capnpPath], {
      encoding: 'utf-8',
      cwd: fixtureDir,
    });
    workerdOutput = `${proc.stdout || ''}\n${proc.stderr || ''}`;
    workerdExitCode = proc.status ?? -1;

    for (const line of workerdOutput.split('\n')) {
      const dsIdx = line.indexOf('__WORKERD_DS_OUTPUT__:');
      if (dsIdx !== -1) {
        workerdDesignSystemOutputs = JSON.parse(line.slice(dsIdx + '__WORKERD_DS_OUTPUT__:'.length));
      }
      const rwIdx = line.indexOf('__WORKERD_REWRITER_PAGE__:');
      if (rwIdx !== -1) {
        workerdRewriterPayload = JSON.parse(line.slice(rwIdx + '__WORKERD_REWRITER_PAGE__:'.length));
      }
    }
  }, 90_000);

  it('runs all workerd unit tests successfully with exit code 0', () => {
    if (workerdExitCode !== 0) {
      throw new Error(`workerd exited with ${workerdExitCode}:\n${workerdOutput}`);
    }
    expect(workerdExitCode).toBe(0);
    expect(workerdOutput).toContain('[ PASS ]');
  });

  it('verifies native cloudflare c++ htmlrewriter inside workerd', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testNativeHtmlRewriter');
  });

  it('verifies progressive out-of-order declarative shadow dom streaming and non-blocking shell flush', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testProgressiveDsdStreaming');
  });

  it('verifies concurrent @loader() execution, state signing, and unique host ids in HTMLRewriter pipeline inside workerd', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testHtmlRewriterConcurrentLoaders');
    expect(workerdRewriterPayload).not.toBeNull();
  });

  it('applies surgical action patches in Chromium for two server elements served through workerd HTMLRewriter', async () => {
    expect(workerdRewriterPayload).not.toBeNull();
    const payload = workerdRewriterPayload!;

    const actionRunnerPath = path.join(fixtureDir, 'action-runner.mjs');
    fs.writeFileSync(
      actionRunnerPath,
      `import { executeWorkerdAction } from './worker-bundle.mjs';
export const runAction = {
  async test(ctrl, env) {
    const payload = JSON.parse(env.ACTION_PAYLOAD);
    const res = await executeWorkerdAction(payload.url, payload.headers, payload.body);
    console.log('__WORKERD_ACTION_RES__:' + JSON.stringify(res));
  }
};
`,
    );

    const runActionInWorkerd = (url: string, headers: Record<string, string>, body: string) => {
      const actionCapnpPath = path.join(fixtureDir, 'action.capnp');
      const escapedPayload = JSON.stringify(JSON.stringify({ url, headers, body }));
      fs.writeFileSync(
        actionCapnpPath,
        `using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    ( name = "main", worker = .actionWorker )
  ],
);

const actionWorker :Workerd.Worker = (
  modules = [
    ( name = "action", esModule = embed "action-runner.mjs" ),
    ( name = "./worker-bundle.mjs", esModule = embed "worker-bundle.mjs" ),
    ( name = "./ssr_bg.wasm", wasm = embed "ssr_bg.wasm" )
  ],
  bindings = [
    ( name = "ACTION_PAYLOAD", text = ${escapedPayload} )
  ],
  compatibilityDate = "2024-01-01",
  compatibilityFlags = ["nodejs_compat"],
);
`,
      );
      const proc = spawnSync(workerdBin, ['test', actionCapnpPath], {
        encoding: 'utf-8',
        cwd: fixtureDir,
      });
      const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
      if (proc.status !== 0) {
        throw new Error(`workerd action runner failed (${proc.status}):\n${out}`);
      }
      for (const line of out.split('\n')) {
        const idx = line.indexOf('__WORKERD_ACTION_RES__:');
        if (idx !== -1) {
          return JSON.parse(line.slice(idx + '__WORKERD_ACTION_RES__:'.length)) as {
            status: number;
            contentType: string;
            body: string;
          };
        }
      }
      throw new Error(`Missing __WORKERD_ACTION_RES__ in workerd output:\n${out}`);
    };

    const { splitServerElement } = await import('@lit-core/server-split');
    const { transformLitProps } = await import('@lit-core/props-lower');
    const counterClient = splitServerElement(transformLitProps(COMPONENT_FIXTURE, { filename: 'component.ts' }).code, { filename: 'component.ts' }).clientCode;
    const inventoryClient = splitServerElement(transformLitProps(INVENTORY_COMPONENT_FIXTURE, { filename: 'inventory-badge.ts' }).code, { filename: 'inventory-badge.ts' }).clientCode;

    const clientBuildRes = await build({
      root: path.resolve(fileURLToPath(import.meta.url), '../../..'),
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: 'client-entry.js',
          output: { format: 'iife', name: '__workerdClient' },
        },
      },
      plugins: [
        {
          name: 'virtual-workerd-client',
          resolveId(id) {
            if (id === 'client-entry.js') return '\0client-entry.ts';
            if (id === './component-client.ts') return '\0component-client.ts';
            if (id === './inventory-client.ts') return '\0inventory-client.ts';
            if (id === './component.ts') return '\0component-client.ts';
          },
          load(id) {
            if (id === '\0client-entry.ts') return `import './component-client.ts'; import './inventory-client.ts';`;
            if (id === '\0component-client.ts') return counterClient;
            if (id === '\0inventory-client.ts') return inventoryClient;
          },
        },
      ],
    });
    const clientOutputs = Array.isArray(clientBuildRes) ? clientBuildRes[0].output : (clientBuildRes as any).output;
    const clientRuntimeBundle = clientOutputs.find((o: any) => o.type === 'chunk').code;

    const page = await setupTestPage();
    try {
      const fullPageHtml = payload.html.replace('</body>', `<script type="module">${clientRuntimeBundle}</script></body>`);
      await page.route('http://workerd.test/**', async (route: any) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.pathname === '/') {
          return route.fulfill({ status: 200, contentType: 'text/html', body: fullPageHtml });
        }
        if (url.pathname.startsWith('/_lit/a/')) {
          const res = runActionInWorkerd(req.url(), req.headers(), req.postData() ?? '');
          return route.fulfill({
            status: res.status,
            contentType: res.contentType,
            body: res.body,
          });
        }
        return route.fulfill({ status: 404, body: 'not found' });
      });

      await page.goto('http://workerd.test/');

      const beforeClick = await page.evaluate(() => {
        const counterShadow = document.getElementById('counter-el')?.shadowRoot;
        const inventoryShadow = document.getElementById('inventory-el')?.shadowRoot;
        (window as any).__counterSpan = counterShadow?.querySelector('.count');
        (window as any).__inventorySpan = inventoryShadow?.querySelector('.stock');
        return {
          count: counterShadow?.querySelector('.count')?.textContent?.trim(),
          stock: inventoryShadow?.querySelector('.stock')?.textContent?.trim(),
        };
      });
      expect(beforeClick).toEqual({ count: '0', stock: '10' });

      await page.locator('#counter-el button.inc').click();
      await page.waitForFunction(() => document.getElementById('counter-el')?.shadowRoot?.querySelector('.count')?.textContent?.trim() === '1', undefined, { timeout: 5000 });

      await page.locator('#inventory-el button.restock').click();
      await page.waitForFunction(() => document.getElementById('inventory-el')?.shadowRoot?.querySelector('.stock')?.textContent?.trim() === '15', undefined, { timeout: 5000 });

      const afterClicks = await page.evaluate(() => {
        const counterShadow = document.getElementById('counter-el')?.shadowRoot;
        const inventoryShadow = document.getElementById('inventory-el')?.shadowRoot;
        return {
          count: counterShadow?.querySelector('.count')?.textContent?.trim(),
          stock: inventoryShadow?.querySelector('.stock')?.textContent?.trim(),
          sameCounterNode: counterShadow?.querySelector('.count') === (window as any).__counterSpan,
          sameInventoryNode: inventoryShadow?.querySelector('.stock') === (window as any).__inventorySpan,
        };
      });
      expect(afterClicks).toEqual({
        count: '1',
        stock: '15',
        sameCounterNode: true,
        sameInventoryNode: true,
      });
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  it('verifies surgical action ndjson stream response, empty state bypass, and build id mismatch in workerd', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testActionEndpointExecution');
  });

  it('renders a real Lit component to Declarative Shadow DOM in workerd and round-trips signed snapshots with exact sequence binding', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testRenderAndActionRoundTrip');
  });

  it('renders real Carbon, Material Web, Spectrum, and Web Awesome components in workerd DOM-equal to Node', async () => {
    expect(workerdOutput).toContain('[ PASS ] main:testDesignSystemComponents');
    expect(Object.keys(workerdDesignSystemOutputs).sort()).toEqual(['carbon', 'material', 'spectrum', 'webawesome']);

    const { installIsolateGlobals, renderToString } = await import('@lit-core/ssr');
    const { html } = await import('lit');
    installIsolateGlobals();
    await import('@carbon/web-components/es/components/button/index.js');
    await import('@material/web/button/filled-button.js');
    await import(pathToFileURL(spectrumButtonEntry).href);
    await import('@awesome.me/webawesome/dist/components/button/button.js');

    const nodeOutputs: Record<string, string> = {
      carbon: renderToString(html`<cds-button kind="primary">Submit</cds-button>`),
      material: renderToString(html`<md-filled-button>Click</md-filled-button>`),
      spectrum: renderToString(html`<sp-button variant="accent">Save</sp-button>`),
      webawesome: renderToString(html`<wa-button variant="brand">Click</wa-button>`),
    };

    const page = await setupTestPage();
    try {
      for (const key of ['carbon', 'material', 'spectrum', 'webawesome']) {
        const workerdHtml = workerdDesignSystemOutputs[key];
        const nodeHtml = nodeOutputs[key];
        await page.setContent(`<!DOCTYPE html><html><body><div id="workerd-mount">${workerdHtml}</div><div id="node-mount">${nodeHtml}</div></body></html>`);

        const comparison = await page.evaluate(() => {
          function serializeTree(node: Node): any {
            if (node.nodeType === Node.TEXT_NODE) {
              const t = (node.textContent || '').trim();
              return t ? { type: 'text', value: t } : null;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return null;
            const el = node as Element;
            const attrs: Record<string, string> = {};
            for (const name of el.getAttributeNames().sort()) {
              attrs[name] = el.getAttribute(name) ?? '';
            }
            const children = Array.from(el.childNodes)
              .map(serializeTree)
              .filter((c) => c !== null);
            const shadow = el.shadowRoot
              ? Array.from(el.shadowRoot.childNodes)
                  .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'STYLE'))
                  .map(serializeTree)
                  .filter((c) => c !== null)
              : null;
            return {
              tag: el.tagName.toLowerCase(),
              attrs,
              shadow,
              children,
            };
          }

          const wHost = document.querySelector('#workerd-mount')?.firstElementChild;
          const nHost = document.querySelector('#node-mount')?.firstElementChild;
          return {
            workerdTree: wHost ? serializeTree(wHost) : null,
            nodeTree: nHost ? serializeTree(nHost) : null,
          };
        });

        expect(comparison.workerdTree).not.toBeNull();
        expect(comparison.workerdTree).toEqual(comparison.nodeTree);
      }
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });

  it('verifies security rejection of tampered state snapshots with 403 in workerd', () => {
    expect(workerdOutput).toContain('[ PASS ] main:testSecurityTamperRejection');
  });
});
