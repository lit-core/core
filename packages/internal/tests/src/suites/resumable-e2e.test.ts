import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installIsolateGlobals, renderToString } from '@lit-core/ssr';
import { lit as litPlugin } from '@lit-core/vite-plugin';
import { html } from 'lit';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTestBrowser } from '../harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, '../../fixtures/resumable-app');
const ORIGIN = 'http://app.test';

interface BuiltApp {
  files: Map<string, string>;
}

async function buildFixtureApp(): Promise<BuiltApp> {
  const result = await build({
    logLevel: 'silent',
    configFile: false,
    root: fixtureRoot,
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: path.join(fixtureRoot, 'index.html'),
          'x-counter': path.join(fixtureRoot, 'src/x-counter.ts'),
          'x-toggle': path.join(fixtureRoot, 'src/x-toggle.ts'),
          'x-greeter': path.join(fixtureRoot, 'src/x-greeter.ts'),
        },
      },
    },
    plugins: [...litPlugin({ resumable: true, propsLower: true, cssFuse: false, virtual: true })],
  });

  const outputs = Array.isArray(result) ? result.flatMap((r) => r.output) : 'output' in result ? result.output : [];
  const files = new Map<string, string>();
  for (const item of outputs) {
    files.set(item.fileName, item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8'));
  }
  return { files };
}

async function renderFixtureHtml(): Promise<string> {
  installIsolateGlobals();
  await import('../../fixtures/resumable-app/src/x-counter.js');
  await import('../../fixtures/resumable-app/src/x-toggle.js');
  await import('../../fixtures/resumable-app/src/x-greeter.js');
  return renderToString(html`<x-counter id="counter"></x-counter><x-toggle id="toggle-host"></x-toggle><x-greeter id="greeter"></x-greeter>`, { resumable: true });
}

describe('resumable end to end with real Lit components, a real Vite build and real SSR output', () => {
  let app: BuiltApp;
  let ssrHtml: string;
  let browser: any;
  let page: any;
  const requested: string[] = [];
  const diagnostics: string[] = [];

  beforeAll(async () => {
    [app, ssrHtml] = await Promise.all([buildFixtureApp(), renderFixtureHtml()]);
    browser = await getTestBrowser();
    page = await browser.newPage();

    const documentHtml = (app.files.get('index.html') ?? '').replace('<!--ssr-outlet-->', ssrHtml);
    page.on('request', (request: any) => {
      requested.push(new URL(request.url()).pathname);
    });
    page.on('console', (message: any) => {
      diagnostics.push(`console.${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error: any) => {
      diagnostics.push(`pageerror: ${error?.message ?? error}`);
    });
    page.on('requestfailed', (request: any) => {
      diagnostics.push(`requestfailed: ${request.url()}`);
    });
    await page.route(`${ORIGIN}/**`, (route: any) => {
      const pathname = new URL(route.request().url()).pathname;
      const key = pathname === '/' ? 'index.html' : pathname.slice(1);
      const body = key === 'index.html' ? documentHtml : app.files.get(key);
      if (body === undefined) {
        return route.fulfill({ status: 404, body: 'not found' });
      }
      return route.fulfill({
        status: 200,
        contentType: key.endsWith('.js') ? 'text/javascript' : key.endsWith('.html') ? 'text/html' : 'application/octet-stream',
        body,
      });
    });
    await page.goto(`${ORIGIN}/`);
  }, 120_000);

  afterAll(async () => {
    if (page) {
      await page.close();
    }
  });

  const chunkRequests = () => requested.filter((p) => p.endsWith('.js'));

  const waitUntil = async (label: string, predicate: (arg: any) => boolean, arg?: unknown) => {
    try {
      await page.waitForFunction(predicate, arg, { timeout: 8000 });
    } catch {
      const indexHtml = app.files.get('index.html') ?? '';
      const snapshot = await page
        .evaluate(() =>
          ['counter', 'toggle-host', 'greeter'].map((id) => {
            const host = document.getElementById(id) as any;
            return `${id}: defined=${Boolean(customElements.get(host?.localName))} state=${JSON.stringify({ name: host?.name, count: host?.count, open: host?.open })} shadow=${host?.shadowRoot?.innerHTML}`;
          }),
        )
        .catch(() => []);
      const manifestAt = indexHtml.indexOf('x-counter');
      throw new Error(
        [
          `${label}: condition not met within 8s`,
          `requested: ${JSON.stringify(requested)}`,
          `diagnostics: ${JSON.stringify(diagnostics)}`,
          `dom: ${snapshot.join('\n')}`,
          `greeter chunk: ${[...app.files.entries()].find(([name]) => name.includes('x-greeter'))?.[1]?.slice(-3000)}`,
          `manifest excerpt: ${manifestAt >= 0 ? indexHtml.slice(Math.max(0, manifestAt - 80), manifestAt + 260) : 'tag not present in built index.html'}`,
        ].join('\n'),
      );
    }
  };

  it('builds one chunk per component plus a manifest naming both tags', () => {
    const indexHtml = app.files.get('index.html') ?? '';
    const jsFiles = [...app.files.keys()].filter((name) => name.endsWith('.js'));
    expect(jsFiles.some((name) => name.includes('x-counter'))).toBe(true);
    expect(jsFiles.some((name) => name.includes('x-toggle'))).toBe(true);
    expect(indexHtml).toContain('x-counter');
    expect(indexHtml).toContain('x-toggle');
  });

  it('paints complete shadow DOM with zero component JavaScript requested', async () => {
    const state = await page.evaluate(() => ({
      counterDefined: Boolean(customElements.get('x-counter')),
      toggleDefined: Boolean(customElements.get('x-toggle')),
      value: document.getElementById('counter')?.shadowRoot?.querySelector('#value')?.textContent,
      buttons: document.getElementById('counter')?.shadowRoot?.querySelectorAll('button').length,
    }));
    expect(state).toEqual({ counterDefined: false, toggleDefined: false, value: '0', buttons: 1 });
    expect(chunkRequests()).toEqual([]);
  });

  it('loads only the clicked component, replays the click once, and keeps the same DOM nodes', async () => {
    await page.evaluate(() => {
      const shadow = document.getElementById('counter')?.shadowRoot;
      (window as any).__button = shadow?.querySelector('button');
      (window as any).__value = shadow?.querySelector('#value');
    });

    await page.locator('#counter button').click();
    await waitUntil('first click replay', () => document.getElementById('counter')?.shadowRoot?.querySelector('#value')?.textContent === '1');
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const shadow = document.getElementById('counter')?.shadowRoot;
      return {
        value: shadow?.querySelector('#value')?.textContent,
        buttons: shadow?.querySelectorAll('button').length,
        sameButton: shadow?.querySelector('button') === (window as any).__button,
        sameValue: shadow?.querySelector('#value') === (window as any).__value,
        counterDefined: Boolean(customElements.get('x-counter')),
        toggleDefined: Boolean(customElements.get('x-toggle')),
      };
    });

    expect(after).toEqual({ value: '1', buttons: 1, sameButton: true, sameValue: true, counterDefined: true, toggleDefined: false });
    expect(chunkRequests().some((p) => p.includes('x-counter'))).toBe(true);
    expect(chunkRequests().some((p) => p.includes('x-toggle'))).toBe(false);
  });

  it('keeps counting on later clicks without recreating nodes', async () => {
    for (const expected of ['2', '3']) {
      await page.locator('#counter button').click();
      await waitUntil(`click to ${expected}`, (value: string) => document.getElementById('counter')?.shadowRoot?.querySelector('#value')?.textContent === value, expected);
    }
    const same = await page.evaluate(() => {
      const shadow = document.getElementById('counter')?.shadowRoot;
      return shadow?.querySelector('button') === (window as any).__button && shadow?.querySelectorAll('button').length === 1;
    });
    expect(same).toBe(true);
  });

  it('resumes the second component independently and updates boolean attributes in place', async () => {
    const before = await page.evaluate(() => {
      const shadow = document.getElementById('toggle-host')?.shadowRoot;
      (window as any).__toggleButton = shadow?.querySelector('button');
      return { hidden: shadow?.querySelector('#panel')?.hasAttribute('hidden'), label: shadow?.querySelector('button')?.textContent };
    });
    expect(before).toEqual({ hidden: true, label: 'Open' });

    await page.locator('#toggle-host button').click();
    await waitUntil('toggle click', () => document.getElementById('toggle-host')?.shadowRoot?.querySelector('button')?.textContent === 'Close');

    const after = await page.evaluate(() => {
      const shadow = document.getElementById('toggle-host')?.shadowRoot;
      return {
        hidden: shadow?.querySelector('#panel')?.hasAttribute('hidden'),
        sameButton: shadow?.querySelector('button') === (window as any).__toggleButton,
        buttons: shadow?.querySelectorAll('button').length,
      };
    });
    expect(after).toEqual({ hidden: false, sameButton: true, buttons: 1 });
    expect(chunkRequests().some((p) => p.includes('x-toggle'))).toBe(true);
  });

  it('resumes a decorator based component from an input event and keeps the input node', async () => {
    const before = await page.evaluate(() => {
      const shadow = document.getElementById('greeter')?.shadowRoot;
      (window as any).__input = shadow?.querySelector('input');
      return { text: shadow?.querySelector('#out')?.textContent, defined: Boolean(customElements.get('x-greeter')) };
    });
    expect(before).toEqual({ text: 'Hello, world', defined: false });

    await page.locator('#greeter input').fill('lit');
    await waitUntil('greeter input', () => document.getElementById('greeter')?.shadowRoot?.querySelector('#out')?.textContent === 'Hello, lit');

    const after = await page.evaluate(() => {
      const shadow = document.getElementById('greeter')?.shadowRoot;
      return { sameInput: shadow?.querySelector('input') === (window as any).__input, inputs: shadow?.querySelectorAll('input').length };
    });
    expect(after).toEqual({ sameInput: true, inputs: 1 });
    expect(chunkRequests().some((p) => p.includes('x-greeter'))).toBe(true);
  });
});
