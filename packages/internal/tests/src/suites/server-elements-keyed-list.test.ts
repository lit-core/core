import path from 'node:path';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { installIsolateGlobals } from '@lit-core/ssr';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const ORIGIN = 'http://keyed-list.local';
const TEST_SECRET = 'keyed-list-e2e-test-secret-32-bytes!';
const workerOutDir = path.resolve('./dist/fixtures/server-elements-keyed-list');

const FIXTURE_SOURCE = `
import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { state } from 'lit/decorators.js';
import { loader, action } from '@lit-core/server-elements';

export class KeyedList extends LitElement {
  @state() items = [];

  @loader()
  async load() {
    this.items = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];
  }

  @action()
  async add(id: string, label: string) {
    this.items = [...this.items, { id, label }];
  }

  @action()
  async removeItem(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
  }

  @action()
  async rename(id: string, label: string) {
    this.items = this.items.map((item) => (item.id === id ? { ...item, label } : item));
  }

  @action()
  async reverse() {
    this.items = [...this.items].reverse();
  }

  render() {
    return html\`
      <ul class="list">\${repeat(this.items, (item) => item.id, (item) => html\`<li class="row">\${item.label}</li>\`)}</ul>
      <button class="add-btn" @click="\${() => this.add('d', 'Delta')}">Add</button>
      <button class="remove-btn" @click="\${() => this.removeItem('b')}">Remove</button>
      <button class="rename-btn" @click="\${() => this.rename('a', 'Alpha 2')}">Rename</button>
      <button class="reverse-btn" @click="\${() => this.reverse()}">Reverse</button>
    \`;
  }
}
customElements.define('keyed-list', KeyedList);
`;

function virtualEntry() {
  return {
    name: 'virtual-entry',
    resolveId(id: string) {
      if (id === 'entry.ts') return '\0entry.ts';
    },
    load(id: string) {
      if (id === '\0entry.ts') return FIXTURE_SOURCE;
    },
  };
}

describe('keyed list patching in a real browser', () => {
  let page: any;
  let clientBundleCode = '';

  const rows = () => page.evaluate(() => Array.from(document.querySelector('keyed-list')?.shadowRoot?.querySelectorAll('li.row') ?? []).map((li) => li.textContent?.trim()));

  const clickAndWaitForAction = async (selector: string) => {
    const response = page.waitForResponse((r: any) => r.url().includes('/_lit/a/'));
    await page.click(`keyed-list ${selector}`);
    await response;
    await page.waitForTimeout(50);
  };

  beforeAll(async () => {
    installIsolateGlobals();

    const clientBuild = await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: false, minify: false, rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
      plugins: [virtualEntry(), propsLower(), serverElements({ target: 'client', autoInjectExecutor: true })],
    });
    const clientOutput = Array.isArray(clientBuild) ? clientBuild[0].output : (clientBuild as any).output;
    clientBundleCode = clientOutput.find((c: any) => c.fileName.endsWith('.js'))?.code ?? '';

    await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: true, outDir: workerOutDir, minify: false, ssr: true, rollupOptions: { input: 'entry.ts', output: { format: 'es', entryFileNames: 'worker.js' } } },
      plugins: [virtualEntry(), propsLower(), serverElements({ target: 'worker' })],
    });
    await import(path.join(workerOutDir, 'worker.js'));

    const browser = await getTestBrowser();
    page = await browser.newPage();

    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.pathname === '/') {
        const ssr = await renderServerElement('keyed-list', {}, { mode: 'dsd', secret: TEST_SECRET });
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!DOCTYPE html><html><head><meta charset="utf-8"><script type="module" src="/client.js"></script></head><body>${ssr.html}</body></html>`,
        });
      }
      if (url.pathname === '/client.js') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: clientBundleCode });
      }
      if (url.pathname.startsWith('/_lit/a/')) {
        const res = await handleActionRequest(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }), {
          env: {},
          secret: TEST_SECRET,
          customElements: (globalThis as any).customElements,
        });
        return route.fulfill({ status: res.status, contentType: res.headers.get('content-type') || 'application/x-ndjson', body: await res.text() });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    });
  }, 90_000);

  beforeEach(async () => {
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.querySelector('keyed-list')?.shadowRoot?.querySelector('li.row'));
  });

  afterAll(async () => {
    if (page) await page.close();
    await closeTestBrowser();
  });

  it('renders the initial list on the server', async () => {
    expect(await rows()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('adds an item on the first action without duplicating server-rendered rows', async () => {
    await clickAndWaitForAction('.add-btn');
    expect(await rows()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('removes an item on the first action', async () => {
    await clickAndWaitForAction('.remove-btn');
    expect(await rows()).toEqual(['Alpha', 'Gamma']);
  });

  it('updates an item in place on the first action', async () => {
    await clickAndWaitForAction('.rename-btn');
    expect(await rows()).toEqual(['Alpha 2', 'Beta', 'Gamma']);
  });

  it('reorders items on the first action', async () => {
    await clickAndWaitForAction('.reverse-btn');
    expect(await rows()).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('stays consistent across a sequence of mixed actions', async () => {
    await clickAndWaitForAction('.add-btn');
    await clickAndWaitForAction('.remove-btn');
    await clickAndWaitForAction('.rename-btn');
    await clickAndWaitForAction('.reverse-btn');
    expect(await rows()).toEqual(['Delta', 'Gamma', 'Alpha 2']);
  });
});
