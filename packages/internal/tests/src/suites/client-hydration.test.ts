import path from 'node:path';
import { installIsolateGlobals, renderToString } from '@lit-core/ssr';
import { lit as viteLit } from '@lit-core/vite-plugin';
import { html } from 'lit';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const ORIGIN = 'http://hydrate.local';
const ssrOutDir = path.resolve('./dist/fixtures/client-hydration-ssr');

const COMPONENT_SOURCE = `
import { LitElement, html } from 'lit';

export class HydrateProbe extends LitElement {
  static properties = { count: { type: Number } };
  declare count: number;
  constructor() {
    super();
    this.count = 0;
  }
  render() {
    return html\`<input id="field" /><button id="inc" @click=\${() => this.count++}>+</button><span id="out">\${this.count}</span>\`;
  }
}
customElements.define('hydrate-probe', HydrateProbe);
`;

function virtualEntry() {
  return {
    name: 'virtual-entry',
    enforce: 'pre' as const,
    resolveId: (id: string) => (id === 'entry.ts' ? '\0entry.ts' : undefined),
    load: (id: string) => (id === '\0entry.ts' ? COMPONENT_SOURCE : undefined),
  };
}

describe('automatic non-destructive client hydration', () => {
  let page: any;
  let clientBundle = '';
  let releaseClientScript: () => void = () => {};
  let clientScriptGate: Promise<void> = Promise.resolve();

  beforeAll(async () => {
    installIsolateGlobals();

    // Server: the same component source, rendered to Declarative Shadow DOM.
    await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: true, outDir: ssrOutDir, minify: false, ssr: true, rollupOptions: { input: 'entry.ts', output: { format: 'es', entryFileNames: 'server.js' } } },
      plugins: [virtualEntry(), ...viteLit({ ssr: true })],
    });
    await import(path.join(ssrOutDir, 'server.js'));
    const documentHtml = `<!DOCTYPE html><html><head><script type="module" src="/client.js"></script></head><body>${renderToString(html`<hydrate-probe></hydrate-probe>`, { customElements: (globalThis as any).customElements })}</body></html>`;

    // Client: the plugin injects hydration support into the entry on its own.
    const clientBuild = await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: false, minify: false, rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
      plugins: [virtualEntry(), ...viteLit({ ssr: true })],
    });
    const output = Array.isArray(clientBuild) ? clientBuild[0].output : (clientBuild as any).output;
    clientBundle = output.find((chunk: any) => chunk.type === 'chunk').code;

    const browser = await getTestBrowser();
    page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documentHtml });
      if (pathname === '/client.js') {
        // Hold the script so the test can interact with the server-rendered page first.
        await clientScriptGate;
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: clientBundle });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    });
  }, 90_000);

  afterAll(async () => {
    await page?.close();
    await closeTestBrowser();
  });

  it('keeps nodes, typed text, focus and selection that existed before the component script loaded', async () => {
    clientScriptGate = new Promise<void>((resolve) => {
      releaseClientScript = resolve;
    });
    // A module script defers DOMContentLoaded, so wait for the server-rendered shadow root instead.
    await page.goto(`${ORIGIN}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.querySelector('hydrate-probe')?.shadowRoot?.querySelector('input'));

    // The page is complete and interactive as plain HTML; the user starts typing before any script runs.
    await page.evaluate(() => {
      const shadow = document.querySelector('hydrate-probe')?.shadowRoot as ShadowRoot;
      const input = shadow.querySelector('input') as HTMLInputElement;
      input.focus();
      input.value = 'typed early';
      input.setSelectionRange(2, 7);
      (window as any).__input = input;
      (window as any).__button = shadow.querySelector('button');
      (window as any).__out = shadow.querySelector('#out');
    });

    releaseClientScript();
    await page.locator('hydrate-probe button').click();
    await page.waitForFunction(() => document.querySelector('hydrate-probe')?.shadowRoot?.querySelector('#out')?.textContent === '1');

    const after = await page.evaluate(() => {
      const host = document.querySelector('hydrate-probe') as HTMLElement;
      const shadow = host.shadowRoot as ShadowRoot;
      const input = shadow.querySelector('input') as HTMLInputElement;
      return {
        sameInput: input === (window as any).__input,
        sameButton: shadow.querySelector('button') === (window as any).__button,
        sameOut: shadow.querySelector('#out') === (window as any).__out,
        inputCount: shadow.querySelectorAll('input').length,
        value: input.value,
      };
    });

    expect(after).toEqual({ sameInput: true, sameButton: true, sameOut: true, inputCount: 1, value: 'typed early' });
  });

  it('keeps focus and the selection range through hydration', async () => {
    clientScriptGate = new Promise<void>((resolve) => {
      releaseClientScript = resolve;
    });
    // A module script defers DOMContentLoaded, so wait for the server-rendered shadow root instead.
    await page.goto(`${ORIGIN}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.querySelector('hydrate-probe')?.shadowRoot?.querySelector('input'));
    await page.evaluate(() => {
      const input = document.querySelector('hydrate-probe')?.shadowRoot?.querySelector('input') as HTMLInputElement;
      input.focus();
      input.value = 'selection check';
      input.setSelectionRange(3, 9);
    });

    releaseClientScript();
    await page.waitForFunction(() => (document.querySelector('hydrate-probe') as any)?.hasUpdated === true);

    const state = await page.evaluate(() => {
      const shadow = document.querySelector('hydrate-probe')?.shadowRoot as ShadowRoot;
      const input = shadow.querySelector('input') as HTMLInputElement;
      return { focused: shadow.activeElement === input, start: input.selectionStart, end: input.selectionEnd, value: input.value };
    });
    expect(state).toEqual({ focused: true, start: 3, end: 9, value: 'selection check' });
  });
});
