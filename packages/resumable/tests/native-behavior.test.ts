import { launchBrowser } from '@lit-core/test-kit';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileResumableLoader, transformResumableComponent } from '../src/compiler/index.js';

const transform = (source: string, filename = 'component.ts') => transformResumableComponent(source, { filename });

describe('adapter injector detects custom elements by semantic binding', () => {
  it('follows aliased imports of the element base class', () => {
    const res = transform(`import { LitElement as Base } from 'lit';\nclass A extends Base {}\nexport { A };`);
    expect(res.transformed).toBe(true);
  });

  it('follows aliased imports of the customElement decorator', () => {
    const res = transform(`import { customElement as define } from 'lit/decorators.js';\n@define('x-aliased')\nclass A extends Object {}\nexport { A };`);
    expect(res.transformed).toBe(true);
  });

  it('detects mixin wrapped base classes', () => {
    const res = transform(`import { LitElement } from 'lit';\nconst Mixin = (B) => class extends B {};\nclass A extends Mixin(LitElement) {}\nexport { A };`);
    expect(res.transformed).toBe(true);
  });

  it('detects customElements.define reached through window', () => {
    const res = transform(`class A extends HTMLElement {}\nwindow.customElements.define('x-win', A);`);
    expect(res.transformed).toBe(true);
  });

  it('detects registrations nested inside functions', () => {
    const res = transform(`export function register(A) { customElements.define('x-nested', A); }`);
    expect(res.transformed).toBe(true);
  });

  it('ignores a locally declared class that only shares the name', () => {
    const res = transform(`class LitElement {}\nclass A extends LitElement {}\nexport { A };`);
    expect(res.transformed).toBe(false);
  });

  it('ignores a shadowed customElements registry', () => {
    const res = transform(`const customElements = { define() {} };\ncustomElements.define('x-fake', class {});`);
    expect(res.transformed).toBe(false);
  });

  it('leaves modules with syntax errors untouched', () => {
    const source = `import { LitElement } from 'lit';\nclass A extends LitElement {`;
    const res = transform(source);
    expect(res.transformed).toBe(false);
    expect(res.code).toBe(source);
  });

  it('does not treat unrelated text mentioning the adapter as an existing import', () => {
    const res = transform(`import { LitElement } from 'lit';\nconst note = 'resumable-adapter';\nclass A extends LitElement {}\nexport { A, note };`);
    expect(res.transformed).toBe(true);
  });

  it('skips modules that already import the adapter, including through an alias', () => {
    const res = transform(`import { installResumableAdapter as install } from 'virtual:lit-core/resumable-adapter';\ninstall();\ncustomElements.define('x-done', class extends HTMLElement {});`);
    expect(res.transformed).toBe(false);
  });
});

describe('micro-loader defaults', () => {
  it('does not eagerly hydrate during idle time unless enabled', () => {
    const manifest = { 'x-card': '/x-card.js' };
    expect(compileResumableLoader({ manifest })).not.toContain('requestIdleCallback');
    expect(compileResumableLoader({ manifest, idleHydration: true })).toContain('requestIdleCallback');
  });
});

describe('micro-loader interception in a real browser', () => {
  let browser: Browser;
  let sharedPage: Page | undefined;

  beforeAll(async () => {
    browser = await launchBrowser();
  });

  afterAll(async () => {
    await browser?.close();
  });

  const renderPage = async (body: string, manifestSource: string) => {
    sharedPage ??= await browser.newPage();
    const page = sharedPage;
    const loader = compileResumableLoader();
    await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"><script>
      window.__log = [];
      ${manifestSource}
      ${loader}
    </script></head><body>${body}</body></html>`);
    return page;
  };

  const blobManifest = (tag: string, moduleSource: string) => `
    window.__LIT_RESUMABLE_MANIFEST__ = {
      '${tag}': URL.createObjectURL(new Blob([${JSON.stringify(moduleSource)}], { type: 'text/javascript' })),
    };`;

  it('replays the click on the real inner target, not the retargeted shadow host', async () => {
    const moduleSource = `
      customElements.define('x-card', class extends HTMLElement {
        connectedCallback() {
          this.shadowRoot.querySelector('button').addEventListener('click', () => window.__log.push('inner'));
        }
      });`;
    const page = await renderPage(`<x-card><template shadowrootmode="open"><button id="b">go</button></template></x-card>`, blobManifest('x-card', moduleSource));

    await page.locator('x-card button').click();
    await page.waitForFunction(() => (window as any).__log.includes('inner'));

    expect(await page.evaluate(() => (window as any).__log)).toEqual(['inner']);
  });

  it('does not swallow interactions on hyphenated tags that have no manifest entry', async () => {
    const page = await renderPage(
      `<unknown-widget><button id="b">go</button></unknown-widget>
       <script>document.addEventListener('click', () => window.__log.push('bubbled'));</script>`,
      '',
    );

    await page.locator('unknown-widget button').click();
    await page.waitForFunction(() => (window as any).__log.includes('bubbled'));

    expect(await page.evaluate(() => (window as any).__log)).toEqual(['bubbled']);
  });

  it('still delivers the interaction when the chunk fails to load', async () => {
    const page = await renderPage(
      `<x-broken><button id="b">go</button></x-broken>
       <script>document.getElementById('b').addEventListener('click', () => window.__log.push('replayed'));</script>`,
      `window.__LIT_RESUMABLE_MANIFEST__ = { 'x-broken': 'blob:http://invalid.invalid/missing' };`,
    );

    await page.locator('#b').click();
    await page.waitForFunction(() => (window as any).__log.includes('replayed'));

    expect(await page.evaluate(() => (window as any).__log)).toEqual(['replayed']);
  });

  it('does not cancel keydown, so the first typed character is not lost while a chunk loads', async () => {
    const slowModule = `
      await new Promise((resolve) => setTimeout(resolve, 1500));
      customElements.define('x-field', class extends HTMLElement {});`;
    const page = await renderPage(`<x-field><input id="i" /></x-field>`, blobManifest('x-field', slowModule));

    await page.locator('#i').focus();
    await page.keyboard.type('a');

    expect(await page.inputValue('#i')).toBe('a');
  });
});
