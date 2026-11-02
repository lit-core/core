import path from 'node:path';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { installIsolateGlobals } from '@lit-core/ssr';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestBrowser, getShadowText, getTestBrowser } from '../harness.js';

const ORIGIN = 'http://lit-app.local';
const TEST_SECRET = 'golden-e2e-test-secret-key-32b!';
const workerOutDir = path.resolve('./dist/fixtures/server-elements-worker');

const FIXTURE_SOURCE = `
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { loader, action } from '@lit-core/server-elements';

export class ServerCounter extends LitElement {
  @property({ type: String }) title = 'Server Counter';
  @state() count = 0;
  @state() status = 'ready';
  @state() query = 'active-focus';

  @loader()
  async load() {
    this.count = 0;
    this.status = 'ready';
    this.query = 'active-focus';
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
      <div class="container" data-status="\${this.status}">
        <input class="query-input" .value="\${this.query}" />
        <span class="sole-count">\${this.count}</span>
        <div class="adjacent-text">Value: \${this.count} items (\${this.status})</div>
        <button class="inc-btn" @click="\${this.increment}">Increment</button>
        <button class="set10-btn" @click="\${() => this.setCount(10)}">Set 10</button>
        <button class="set20-btn" @click="\${() => this.setCount(20)}">Set 20</button>
      </div>
    \`;
  }
}
customElements.define('server-counter', ServerCounter);
`;

describe('golden end-to-end acceptance test: lit server elements', () => {
  let browser: any;
  let page: any;
  let clientBundleCode: string;
  let actionHash: string;
  let initialSig: string;
  let initialToken: string;
  let initialState: Record<string, unknown>;
  const recordedActionBodies: any[] = [];
  const recordedPatchStreams: string[] = [];
  const recordedActionResponses: { status: number; body: string }[] = [];
  const requestedUrls: string[] = [];

  // Deferred network delay controllers for stale sequence race test
  let delaySeq1Resolver: (() => void) | null = null;
  let shouldDelaySeq1 = false;

  beforeAll(async () => {
    installIsolateGlobals();

    // 1. Programmatic Vite build for client artifact
    const clientBuildResult = await build({
      logLevel: 'silent',
      configFile: false,
      build: {
        write: false,
        minify: false,
        sourcemap: false,
        rollupOptions: {
          input: 'entry.ts',
          output: { format: 'es' },
        },
      },
      plugins: [
        {
          name: 'virtual-entry',
          resolveId(id) {
            if (id === 'entry.ts') return '\0entry.ts';
          },
          load(id) {
            if (id === '\0entry.ts') return FIXTURE_SOURCE;
          },
        },
        propsLower(),
        serverElements({
          target: 'client',
          autoInjectExecutor: true,
        }),
      ],
    });

    const clientOutput = Array.isArray(clientBuildResult) ? clientBuildResult[0].output : (clientBuildResult as any).output;
    const jsChunk = clientOutput.find((c: any) => c.fileName.endsWith('.js'));
    clientBundleCode = jsChunk?.code ?? '';

    // 2. Discover generated action hash from client bundle
    const hashMatch = clientBundleCode.match(/__litActionRpc\([^,]+,\s*["']([0-9a-f]{16})["']/);
    actionHash = hashMatch ? hashMatch[1] : '0538a431477cdf2a';

    // 3. Programmatic Vite build for worker artifact (zero hand-written descriptors)
    await build({
      logLevel: 'silent',
      configFile: false,
      build: {
        write: true,
        outDir: workerOutDir,
        minify: false,
        ssr: true,
        rollupOptions: {
          input: 'entry.ts',
          output: { format: 'es', entryFileNames: 'worker.js' },
        },
      },
      plugins: [
        {
          name: 'virtual-entry',
          resolveId(id) {
            if (id === 'entry.ts') return '\0entry.ts';
          },
          load(id) {
            if (id === '\0entry.ts') return FIXTURE_SOURCE;
          },
        },
        propsLower(),
        serverElements({ target: 'worker' }),
      ],
    });

    // Import the compiled worker module to register definition and descriptors
    await import(path.join(workerOutDir, 'worker.js'));

    // 4. Launch browser and configure network virtualization
    browser = await getTestBrowser();
    page = await browser.newPage();

    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const req = route.request();
      const url = new URL(req.url());
      requestedUrls.push(url.pathname);

      if (url.pathname === '/') {
        const ssrResult = await renderServerElement(
          'server-counter',
          {},
          {
            mode: 'dsd',
            secret: TEST_SECRET,
          },
        );

        initialSig = ssrResult.sig;
        initialToken = ssrResult.token;
        initialState = ssrResult.state;

        const htmlDocument = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Server elements e2e</title>
  <script type="module" src="/client.js"></script>
</head>
<body>
  ${ssrResult.html}
</body>
</html>`;

        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: htmlDocument,
        });
      }

      if (url.pathname === '/client.js') {
        return route.fulfill({
          status: 200,
          contentType: 'text/javascript',
          body: clientBundleCode,
        });
      }

      if (url.pathname.startsWith('/_lit/a/')) {
        const rawBody = req.postData();
        let parsedBody: any = null;
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
            recordedActionBodies.push(parsedBody);
          } catch {}
        }

        // Realistic out-of-order delay for sequence 1 if enabled
        if (shouldDelaySeq1 && parsedBody?.seq === 1) {
          await new Promise<void>((resolve) => {
            delaySeq1Resolver = resolve;
          });
        }

        const webReq = new Request(req.url(), {
          method: 'POST',
          headers: req.headers(),
          body: rawBody,
        });

        const webRes = await handleActionRequest(webReq, {
          env: {},
          secret: TEST_SECRET,
          registry: (globalThis as any).customElements,
        });

        const resBody = await webRes.text();
        recordedPatchStreams.push(resBody);
        recordedActionResponses.push({ status: webRes.status, body: resBody });

        return route.fulfill({
          status: webRes.status,
          contentType: webRes.headers.get('content-type') || 'application/x-ndjson',
          body: resBody,
        });
      }

      return route.fulfill({ status: 404, body: 'Not found' });
    });
  }, 90_000);

  beforeEach(async () => {
    recordedActionBodies.length = 0;
    recordedPatchStreams.length = 0;
    recordedActionResponses.length = 0;
    shouldDelaySeq1 = false;
    delaySeq1Resolver = null;
    await page.goto(`${ORIGIN}/`);
  });

  afterAll(async () => {
    if (page) await page.close();
    await closeTestBrowser();
  });

  it('renders initial Declarative Shadow DOM with zero Lit runtime on client', async () => {
    const hasDsd = await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      return Boolean(host?.shadowRoot && host.shadowRoot.mode === 'open');
    });
    expect(hasDsd).toBe(true);

    const initialCount = await getShadowText(page, 'server-counter', '.sole-count');
    expect(initialCount).toBe('0');

    const initialAdjacent = await getShadowText(page, 'server-counter', '.adjacent-text');
    expect(initialAdjacent).toBe('Value: 0 items (ready)');

    const initialStatus = await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      const container = host?.shadowRoot?.querySelector('.container');
      return container?.getAttribute('data-status');
    });
    expect(initialStatus).toBe('ready');

    expect(clientBundleCode).not.toContain('from "lit"');
    expect(clientBundleCode).not.toContain("from 'lit'");
    expect(clientBundleCode).toContain('extends HTMLElement');
    expect(clientBundleCode).not.toContain('render()');

    const clientGlobals = await page.evaluate(() => ({
      hasLit: 'lit' in window || 'litHtml' in window,
      hasLitElement: 'LitElement' in window,
    }));
    expect(clientGlobals.hasLit).toBe(false);
    expect(clientGlobals.hasLitElement).toBe(false);
  });

  it('dispatches action POST request when clicking @click action button', async () => {
    await page.click('server-counter button.inc-btn');
    await page.waitForTimeout(500);

    expect(recordedActionBodies.length).toBeGreaterThan(0);
    const lastAction = recordedActionBodies[recordedActionBodies.length - 1];
    expect(lastAction?.tag).toBe('server-counter');
    expect(lastAction?.seq).toBe(1);
  });

  it('streams surgical dirty-part patches omitting non-dirty expressions', async () => {
    let streamText = recordedPatchStreams[recordedPatchStreams.length - 1];
    if (!streamText) {
      const actionReq = new Request(`${ORIGIN}/_lit/a/${actionHash}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
          'X-Lit-Action-Token': initialToken,
        },
        body: JSON.stringify({
          tag: 'server-counter',
          state: initialState,
          sig: initialSig,
          args: [],
          seq: 1,
        }),
      });
      const res = await handleActionRequest(actionReq, {
        env: {},
        secret: TEST_SECRET,
        registry: (globalThis as any).customElements,
      });
      streamText = await res.text();
    }

    const lines = streamText.split('\n').filter(Boolean);
    const frames = lines.map((l) => JSON.parse(l));
    const partFrames = frames.filter((f) => 'p' in f);
    const partIndices = partFrames.map((f) => f.p);

    // Non-dirty input property part (p: 1 for .value=${this.query}) must be excluded from surgical patch stream
    expect(partIndices).not.toContain(1);
    // Dirty count part (p: 2 for ${this.count}) must be included
    expect(partIndices).toContain(2);
  });

  it('preserves active input focus and text selection across action patch in Shadow Root', async () => {
    await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      const input = host?.shadowRoot?.querySelector('input.query-input') as HTMLInputElement | null;
      if (input) {
        input.value = 'active-focus';
        input.focus();
        input.setSelectionRange(3, 8);
      }
    });

    const preState = await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      const input = host?.shadowRoot?.querySelector('input.query-input') as HTMLInputElement | null;
      return {
        isFocused: Boolean(input && host?.shadowRoot?.activeElement === input),
        selStart: input?.selectionStart ?? -1,
        selEnd: input?.selectionEnd ?? -1,
      };
    });
    expect(preState.isFocused).toBe(true);
    expect(preState.selStart).toBe(3);
    expect(preState.selEnd).toBe(8);

    await page.click('server-counter button.inc-btn');

    await page.waitForFunction(
      () => {
        const host = document.querySelector('server-counter');
        const countEl = host?.shadowRoot?.querySelector('.sole-count');
        return countEl?.textContent?.trim() === '1';
      },
      undefined,
      { timeout: 3000 },
    );

    const postState = await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      const input = host?.shadowRoot?.querySelector('input.query-input') as HTMLInputElement | null;
      return {
        isFocused: Boolean(input && host?.shadowRoot?.activeElement === input),
        selStart: input?.selectionStart ?? -1,
        selEnd: input?.selectionEnd ?? -1,
      };
    });

    expect(postState.isFocused).toBe(true);
    expect(postState.selStart).toBe(3);
    expect(postState.selEnd).toBe(8);
  });

  it('round-trips signed state across 3 sequential actions with sequence increment and updates attribute and range-marker parts', async () => {
    // Action 1
    await page.click('server-counter button.inc-btn');
    await page.waitForFunction(
      () => {
        const host = document.querySelector('server-counter');
        const countEl = host?.shadowRoot?.querySelector('.sole-count');
        const adjEl = host?.shadowRoot?.querySelector('.adjacent-text');
        const container = host?.shadowRoot?.querySelector('.container');
        return countEl?.textContent?.trim() === '1' && adjEl?.textContent?.trim() === 'Value: 1 items (incremented)' && container?.getAttribute('data-status') === 'incremented';
      },
      undefined,
      { timeout: 3000 },
    );

    // Action 2
    await page.click('server-counter button.inc-btn');
    await page.waitForFunction(
      () => {
        const host = document.querySelector('server-counter');
        const countEl = host?.shadowRoot?.querySelector('.sole-count');
        const adjEl = host?.shadowRoot?.querySelector('.adjacent-text');
        return countEl?.textContent?.trim() === '2' && adjEl?.textContent?.trim() === 'Value: 2 items (incremented)';
      },
      undefined,
      { timeout: 3000 },
    );

    // Action 3
    await page.click('server-counter button.inc-btn');
    await page.waitForFunction(
      () => {
        const host = document.querySelector('server-counter');
        const countEl = host?.shadowRoot?.querySelector('.sole-count');
        const adjEl = host?.shadowRoot?.querySelector('.adjacent-text');
        return countEl?.textContent?.trim() === '3' && adjEl?.textContent?.trim() === 'Value: 3 items (incremented)';
      },
      undefined,
      { timeout: 3000 },
    );

    const seqs = recordedActionBodies.map((b) => b.seq);
    expect(seqs).toContain(1);
    expect(seqs).toContain(2);
    expect(seqs).toContain(3);
  });

  it('rejects tampered state, tampered signature, and empty-state bypass with 403 STATE_TAMPERED', async () => {
    // 1. Rejects tampered property value
    const tamperedReq = new Request(`${ORIGIN}/_lit/a/${actionHash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: 'server-counter',
        state: { count: 9999 },
        sig: 'invalid.sig',
        args: [],
        seq: 4,
      }),
    });

    const res = await handleActionRequest(tamperedReq, {
      env: {},
      secret: TEST_SECRET,
      registry: (globalThis as any).customElements,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('STATE_TAMPERED');

    // 2. Rejects empty-state bypass attempt ({ state: {}, sig: "" })
    const emptyStateReq = new Request(`${ORIGIN}/_lit/a/${actionHash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag: 'server-counter',
        state: {},
        sig: '',
        args: [],
        seq: 1,
      }),
    });

    const emptyRes = await handleActionRequest(emptyStateReq, {
      env: {},
      secret: TEST_SECRET,
      registry: (globalThis as any).customElements,
    });

    expect(emptyRes.status).toBe(403);
    const emptyBody = await emptyRes.json();
    expect(emptyBody.code).toBe('STATE_TAMPERED');

    // 3. Rejects action when data-lit-sig is tampered on the DOM element
    await page.evaluate(() => {
      const host = document.querySelector('server-counter');
      host?.setAttribute('data-lit-sig', 'forged-attacker-signature');
    });

    await page.click('server-counter button.inc-btn');
    await page.waitForTimeout(500);

    expect(recordedActionResponses.length).toBeGreaterThan(0);
    const lastResponse = recordedActionResponses[recordedActionResponses.length - 1];
    expect(lastResponse.status).toBe(403);
    const parsed = JSON.parse(lastResponse.body);
    expect(parsed.code).toBe('STATE_TAMPERED');
  });

  it('drops out-of-order stale sequence responses without rolling back DOM state', async () => {
    // Configure network race: delay seq=1 until seq=2 completes
    shouldDelaySeq1 = true;

    // Trigger action 1 (will be held by network router)
    await page.click('server-counter button.set10-btn');
    await page.waitForTimeout(200);

    // Trigger action 2 (will complete first)
    shouldDelaySeq1 = false;
    await page.click('server-counter button.set20-btn');

    // Wait for the second click (seq=2) to update the DOM
    await page.waitForFunction(
      () => {
        const host = document.querySelector('server-counter');
        const countEl = host?.shadowRoot?.querySelector('.sole-count');
        const adjEl = host?.shadowRoot?.querySelector('.adjacent-text');
        return countEl?.textContent?.trim() === '20' && adjEl?.textContent?.trim() === 'Value: 20 items (set)';
      },
      undefined,
      { timeout: 3000 },
    );

    // Release delayed action 1
    if (delaySeq1Resolver) {
      delaySeq1Resolver();
      delaySeq1Resolver = null;
    }

    await page.waitForTimeout(500);

    // The DOM must remain at seq=2's state (not rolled back to count 10)
    const text = await getShadowText(page, 'server-counter', '.sole-count');
    const adjacentText = await getShadowText(page, 'server-counter', '.adjacent-text');
    expect(text).toBe('20');
    expect(adjacentText).toBe('Value: 20 items (set)');
  });
});
