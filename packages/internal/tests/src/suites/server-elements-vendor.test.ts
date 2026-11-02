import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { installIsolateGlobals } from '@lit-core/ssr';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestBrowser, getShadowText, getTestBrowser } from '../harness.js';

const ORIGIN = 'http://lit-vendor-app.local';
const TEST_SECRET = 'vendor-tier-d-test-secret-32b!!';
const workerOutDir = path.resolve(fileURLToPath(import.meta.url), '../../../dist/fixtures/server-elements-vendor-worker');

const FIXTURE_SOURCE = `
import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { loader, action } from '@lit-core/server-elements';

export class ServerVendorWrapper extends LitElement {
  @property({ type: String }) title = 'Vendor Action Wrapper';
  @state() count = 0;
  @state() kind = 'primary';
  @state() label = 'Submit';

  @loader()
  async load() {
    this.count = 0;
    this.kind = 'primary';
    this.label = 'Submit';
  }

  @action()
  async submit() {
    this.count += 1;
    this.kind = 'danger';
    this.label = \`Processed (\${this.count})\`;
  }

  render() {
    return html\`
      <div class="wrapper-shell">
        <span class="count">\${this.count}</span>
        <cds-button kind="\${this.kind}" @click="\${this.submit}">\${this.label}</cds-button>
      </div>
    \`;
  }
}
customElements.define('server-vendor-wrapper', ServerVendorWrapper);
`;

describe('milestone m6 tier d acceptance test: real design-system vendor integration', () => {
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

  beforeAll(async () => {
    installIsolateGlobals();

    // 1. Register canonical Carbon component in isolate environment
    await import('@carbon/web-components/es/components/button/index.js');

    // 2. Programmatic Vite build for client artifact (zero-Lit client stub)
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

    // 3. Discover generated action hash from client bundle RPC call
    const hashMatch = clientBundleCode.match(/__litActionRpc\([^,]+,\s*["']([0-9a-f]{16})["']/);
    actionHash = hashMatch ? hashMatch[1] : '';

    // 4. Programmatic Vite build for worker artifact
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

    await import(path.join(workerOutDir, 'worker.js'));

    // 5. Launch browser and configure virtual routing
    browser = await getTestBrowser();
    page = await browser.newPage();

    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const req = route.request();
      const url = new URL(req.url());
      requestedUrls.push(url.pathname);

      if (url.pathname === '/') {
        const ssrResult = await renderServerElement(
          'server-vendor-wrapper',
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
  <title>Vendor server elements e2e</title>
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
    await page.goto(`${ORIGIN}/`);
  });

  afterAll(async () => {
    if (page) await page.close();
    await closeTestBrowser();
  });

  it('renders initial declarative shadow dom with full carbon vendor styles and zero lit on client', async () => {
    const inspect = await page.evaluate(() => {
      const wrapper = document.querySelector('server-vendor-wrapper');
      const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
      const innerButton = cdsButton?.shadowRoot?.querySelector('button');
      const innerStyle = cdsButton?.shadowRoot?.querySelector('style');
      const textNodes = Array.from(cdsButton?.childNodes ?? []).filter((n) => n.nodeType === 3);
      const slottedText = textNodes
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .join('');
      return {
        hasWrapperShadow: Boolean(wrapper?.shadowRoot && wrapper.shadowRoot.mode === 'open'),
        hasCdsButtonShadow: Boolean(cdsButton?.shadowRoot && cdsButton.shadowRoot.mode === 'open'),
        kind: cdsButton?.getAttribute('kind'),
        label: slottedText || cdsButton?.textContent?.trim(),
        hasInnerButton: Boolean(innerButton),
        styleLength: innerStyle?.textContent?.length ?? 0,
      };
    });

    expect(inspect.hasWrapperShadow).toBe(true);
    expect(inspect.hasCdsButtonShadow).toBe(true);
    expect(inspect.kind).toBe('primary');
    expect(inspect.label).toBe('Submit');
    expect(inspect.hasInnerButton).toBe(true);
    expect(inspect.styleLength).toBeGreaterThan(50_000);

    const initialCount = await getShadowText(page, 'server-vendor-wrapper', '.count');
    expect(initialCount).toBe('0');
    expect(actionHash).toMatch(/^[0-9a-f]{16}$/);
    expect(initialSig).toContain('.');
    expect(initialToken).toBeDefined();
    expect(initialState).toMatchObject({ count: 0, kind: 'primary', label: 'Submit' });

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

  it('dispatches action post request when clicking real vendor cds-button', async () => {
    await page.click('server-vendor-wrapper cds-button');
    await page.waitForTimeout(500);

    expect(recordedActionBodies.length).toBeGreaterThan(0);
    const lastAction = recordedActionBodies[recordedActionBodies.length - 1];
    expect(lastAction?.tag).toBe('server-vendor-wrapper');
    expect(lastAction?.seq).toBe(1);
  });

  it('streams surgical dirty-part patches updating vendor attributes and text while preserving vendor shadow root', async () => {
    await page.click('server-vendor-wrapper cds-button');

    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('server-vendor-wrapper');
        const countEl = wrapper?.shadowRoot?.querySelector('.count');
        const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
        return countEl?.textContent?.trim() === '1' && cdsButton?.getAttribute('kind') === 'danger' && cdsButton?.textContent?.trim() === 'Processed (1)';
      },
      undefined,
      { timeout: 3000 },
    );

    const updated = await page.evaluate(() => {
      const wrapper = document.querySelector('server-vendor-wrapper');
      const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
      const innerButton = cdsButton?.shadowRoot?.querySelector('button');
      const innerStyle = cdsButton?.shadowRoot?.querySelector('style');
      return {
        hasWrapperShadow: Boolean(wrapper?.shadowRoot),
        hasCdsButtonShadow: Boolean(cdsButton?.shadowRoot),
        kind: cdsButton?.getAttribute('kind'),
        label: cdsButton?.textContent?.trim(),
        hasInnerButton: Boolean(innerButton),
        styleLength: innerStyle?.textContent?.length ?? 0,
      };
    });

    expect(updated.kind).toBe('danger');
    expect(updated.label).toBe('Processed (1)');
    expect(updated.hasCdsButtonShadow).toBe(true);
    expect(updated.hasInnerButton).toBe(true);
    expect(updated.styleLength).toBeGreaterThan(50_000);

    // Verify surgical patch frames
    expect(recordedPatchStreams.length).toBeGreaterThan(0);
    const streamText = recordedPatchStreams[recordedPatchStreams.length - 1];
    const frames = streamText
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const partFrames = frames.filter((f) => 'p' in f);
    expect(partFrames.length).toBeGreaterThan(0);

    const stateFrame = frames.find((f) => 's' in f);
    expect(stateFrame).toBeDefined();
    expect(stateFrame.sig).toContain('.');
  });

  it('round-trips state across multiple sequential clicks on vendor button', async () => {
    // Click 1
    await page.click('server-vendor-wrapper cds-button');
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('server-vendor-wrapper');
        const countEl = wrapper?.shadowRoot?.querySelector('.count');
        const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
        return countEl?.textContent?.trim() === '1' && cdsButton?.getAttribute('kind') === 'danger' && cdsButton?.textContent?.trim() === 'Processed (1)';
      },
      undefined,
      { timeout: 3000 },
    );

    // Click 2
    await page.click('server-vendor-wrapper cds-button');
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('server-vendor-wrapper');
        const countEl = wrapper?.shadowRoot?.querySelector('.count');
        const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
        return countEl?.textContent?.trim() === '2' && cdsButton?.getAttribute('kind') === 'danger' && cdsButton?.textContent?.trim() === 'Processed (2)';
      },
      undefined,
      { timeout: 3000 },
    );

    // Click 3
    await page.click('server-vendor-wrapper cds-button');
    await page.waitForFunction(
      () => {
        const wrapper = document.querySelector('server-vendor-wrapper');
        const countEl = wrapper?.shadowRoot?.querySelector('.count');
        const cdsButton = wrapper?.shadowRoot?.querySelector('cds-button');
        return countEl?.textContent?.trim() === '3' && cdsButton?.getAttribute('kind') === 'danger' && cdsButton?.textContent?.trim() === 'Processed (3)';
      },
      undefined,
      { timeout: 3000 },
    );

    const seqs = recordedActionBodies.map((b) => b.seq);
    expect(seqs).toContain(1);
    expect(seqs).toContain(2);
    expect(seqs).toContain(3);
  });
});
