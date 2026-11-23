import path from 'node:path';
import { createMemoryReplayGuard, handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { installIsolateGlobals } from '@lit-core/ssr';
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const ORIGIN = 'http://no-js.local';
const TEST_SECRET = 'no-js-form-e2e-test-secret-32-bytes!';
const workerOutDir = path.resolve('./dist/fixtures/server-elements-no-js-form');

const FIXTURE_SOURCE = `
import { html } from 'lit';
import { state } from 'lit/decorators.js';
import { loader, action, ActionError, ServerElement } from '@lit-core/server-elements';

export class GuestBook extends ServerElement {
  @state() entries: string[] = [];

  @loader()
  async load() {
    this.entries = [...globalThis.__guestBook];
  }

  @action()
  async sign(fields: { name: string; note: string }) {
    if (!fields.name) throw new ActionError('BAD_REQUEST', 'Please enter a name.');
    globalThis.__guestBook.push(fields.name + ': ' + fields.note);
  }

  render() {
    return html\`
      <ul>\${this.entries.map((entry) => html\`<li>\${entry}</li>\`)}</ul>
      <form method="post" action="\${this.actionUrl('sign')}">
        \${this.formFields({ redirect: '/' })}
        <input name="name" /> <input name="note" />
        <button>Sign</button>
      </form>
    \`;
  }
}
customElements.define('guest-book', GuestBook);
`;

describe('actions without JavaScript', () => {
  let context: any;
  let page: any;

  beforeAll(async () => {
    installIsolateGlobals();
    await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: true, outDir: workerOutDir, minify: false, ssr: true, rollupOptions: { input: 'entry.ts', output: { format: 'es', entryFileNames: 'worker.js' } } },
      plugins: [
        { name: 'virtual-entry', resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined), load: (id) => (id === '\0entry.ts' ? FIXTURE_SOURCE : undefined) },
        propsLower(),
        serverElements({ target: 'worker' }),
      ],
    });
    await import(path.join(workerOutDir, 'worker.js'));

    const browser = await getTestBrowser();
    context = await browser.newContext({ javaScriptEnabled: false });
    page = await context.newPage();

    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const req = route.request();
      const url = new URL(req.url());

      if (url.pathname === '/') {
        const ssr = await renderServerElement('guest-book', {}, { secret: TEST_SECRET, encryptState: true });
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!DOCTYPE html><html><body>${ssr.html}</body></html>` });
      }
      if (url.pathname.startsWith('/_lit/a/')) {
        const res = await handleActionRequest(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }), {
          env: {},
          secret: TEST_SECRET,
          encryptState: true,
          customElements: (globalThis as any).customElements,
        });
        return route.fulfill({
          status: res.status,
          headers: Object.fromEntries(res.headers),
          body: res.status === 303 ? '' : await res.text(),
        });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    });
  }, 90_000);

  beforeEach(async () => {
    (globalThis as any).__guestBook = ['seed: hello'];
    await page.goto(`${ORIGIN}/`);
  });

  afterAll(async () => {
    await context?.close();
    await closeTestBrowser();
  });

  const entries = () => page.evaluate(() => Array.from(document.querySelector('guest-book')?.shadowRoot?.querySelectorAll('li') ?? []).map((li) => li.textContent));

  it('keeps loaded data out of the page markup when state is encrypted', async () => {
    const attribute = await page.evaluate(() => document.querySelector('guest-book')?.getAttribute('data-lit-state'));
    expect(attribute).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(attribute).not.toContain('seed');
    const hidden = await page.evaluate(() => (document.querySelector('guest-book')?.shadowRoot?.querySelector('input[name=_lit_state]') as HTMLInputElement | null)?.value);
    expect(hidden).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hidden).not.toContain('seed');
  });

  it('renders the form with no script running on the page', async () => {
    expect(await page.evaluate(() => (document.querySelector('guest-book') as any)?.constructor?.name)).toBe('HTMLElement');
    expect(await entries()).toEqual(['seed: hello']);
  });

  it('submits a native form post, runs the action, and redirects back to the updated page', async () => {
    await page.locator('guest-book input[name=name]').fill('Ada');
    await page.locator('guest-book input[name=note]').fill('hi there');
    const posted = page.waitForResponse((r: any) => r.url().includes('/_lit/a/'));
    await page.locator('guest-book button').click();

    // The browser follows the 303 itself; a fulfilled redirect to a fake host cannot be re-intercepted,
    // so assert the redirect and then load its target the way the browser would.
    const response = await posted;
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe('/');
    expect(response.headers()['cache-control']).toBe('no-store');

    await page.waitForTimeout(300); // let the browser's own failed follow-up navigation settle
    await page.goto(`${ORIGIN}${response.headers().location}`);
    expect(await entries()).toEqual(['seed: hello', 'Ada: hi there']);
  });

  it('shows the message of a deliberate ActionError on a plain page', async () => {
    const [response] = await Promise.all([page.waitForNavigation(), page.locator('guest-book button').click()]);

    expect(response.status()).toBe(400);
    expect(await page.textContent('body')).toContain('Please enter a name.');
    expect((globalThis as any).__guestBook).toEqual(['seed: hello']);
  });
});

describe('the same forms with JavaScript available', () => {
  let page: any;
  let clientBundle = '';
  // Lets a test hold action responses to observe the in-flight state.
  let actionGate: Promise<void> = Promise.resolve();
  // Every snapshot is single-use here, as in a hardened deployment.
  const replayGuard = createMemoryReplayGuard();

  beforeAll(async () => {
    installIsolateGlobals();
    const clientBuild = await build({
      logLevel: 'silent',
      configFile: false,
      build: { write: false, minify: false, rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
      plugins: [
        { name: 'virtual-entry', resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined), load: (id) => (id === '\0entry.ts' ? FIXTURE_SOURCE : undefined) },
        propsLower(),
        serverElements({ target: 'client', autoInjectExecutor: true }),
      ],
    });
    const output = Array.isArray(clientBuild) ? clientBuild[0].output : (clientBuild as any).output;
    clientBundle = output.find((chunk: any) => chunk.type === 'chunk').code;

    const browser = await getTestBrowser();
    page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (route: any) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === '/') {
        const ssr = await renderServerElement('guest-book', {}, { secret: TEST_SECRET, encryptState: true });
        return route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!DOCTYPE html><html><head><script type="module" src="/client.js"></script></head><body>${ssr.html}</body></html>`,
        });
      }
      if (url.pathname === '/client.js') {
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: clientBundle });
      }
      if (url.pathname.startsWith('/_lit/a/')) {
        await actionGate;
        const res = await handleActionRequest(new Request(req.url(), { method: 'POST', headers: req.headers(), body: req.postData() }), {
          env: {},
          secret: TEST_SECRET,
          encryptState: true,
          customElements: (globalThis as any).customElements,
          replayGuard,
        });
        return route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: res.status === 303 ? '' : await res.text() });
      }
      return route.fulfill({ status: 404, body: 'Not found' });
    });
  }, 90_000);

  beforeEach(async () => {
    (globalThis as any).__guestBook = ['seed: hello'];
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => document.querySelector('guest-book')?.shadowRoot?.querySelector('form'));
    await page.evaluate(() => {
      (window as any).__sameDocument = true;
    });
  });

  afterAll(async () => {
    await page?.close();
  });

  const entries = () => page.evaluate(() => Array.from(document.querySelector('guest-book')?.shadowRoot?.querySelectorAll('li') ?? []).map((li) => li.textContent));

  it('submits through the action endpoint and patches in place, without a page load', async () => {
    await page.locator('guest-book input[name=name]').fill('Grace');
    await page.locator('guest-book input[name=note]').fill('hello again');
    const posted = page.waitForResponse((r: any) => r.url().includes('/_lit/a/'));
    await page.locator('guest-book button').click();
    const response = await posted;

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/x-ndjson');
    await page.waitForFunction(() => document.querySelector('guest-book')?.shadowRoot?.querySelectorAll('li').length === 2);
    expect(await entries()).toEqual(['seed: hello', 'Grace: hello again']);
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
  });

  it('keeps the signed snapshot fields out of the action input', async () => {
    const bodies: string[] = [];
    page.on('request', (req: any) => req.url().includes('/_lit/a/') && bodies.push(req.postData() ?? ''));
    await page.locator('guest-book input[name=name]').fill('Linus');
    await page.locator('guest-book button').click();
    await page.waitForFunction(() => document.querySelector('guest-book')?.shadowRoot?.querySelectorAll('li').length === 2);

    const sent = JSON.parse(bodies[0]);
    expect(sent.args).toEqual([{ name: 'Linus', note: '' }]);
  });

  it('marks the host while an action is in flight so CSS can show a pending state', async () => {
    let release: () => void = () => {};
    actionGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.locator('guest-book input[name=name]').fill('Pending');
    await page.locator('guest-book button').click();

    await page.waitForFunction(() => document.querySelector('guest-book')?.hasAttribute('data-lit-pending'));
    const during = await page.evaluate(() => {
      const host = document.querySelector('guest-book') as HTMLElement;
      return { pending: host.getAttribute('data-lit-pending'), busy: host.getAttribute('aria-busy') };
    });
    expect(during.pending).toMatch(/^[0-9a-f]{16}$/);
    expect(during.busy).toBe('true');

    release();
    actionGate = Promise.resolve();
    await page.waitForFunction(() => !document.querySelector('guest-book')?.hasAttribute('data-lit-pending'));
    expect(await page.evaluate(() => document.querySelector('guest-book')?.hasAttribute('aria-busy'))).toBe(false);
  });

  it('keeps rapid submits working under a single-use replay guard, because actions queue', async () => {
    await page.locator('guest-book input[name=name]').fill('First');
    await page.locator('guest-book button').click();
    await page.locator('guest-book input[name=name]').fill('Second');
    await page.locator('guest-book button').click();

    await page.waitForFunction(() => document.querySelector('guest-book')?.shadowRoot?.querySelectorAll('li').length === 3);
    expect(await entries()).toEqual(['seed: hello', 'First: ', 'Second: ']);
  });

  it('reports a failed action as a bubbling DOM event, since a stub has no action state', async () => {
    const failure = page.evaluate(
      () =>
        new Promise((resolve) => {
          document.addEventListener(
            'lit-action-error',
            (event) => {
              const { message, code, status } = (event as CustomEvent).detail.error;
              resolve({ message, code, status });
            },
            { once: true },
          );
        }),
    );
    await page.locator('guest-book button').click();
    const error: any = await failure;

    expect(error.message).toBe('Please enter a name.');
    expect(error.code).toBe('BAD_REQUEST');
    expect(await entries()).toEqual(['seed: hello']);
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
  });

  it('announces a successful action with its name', async () => {
    const success = page.evaluate(
      () =>
        new Promise((resolve) => {
          document.addEventListener('lit-action-success', (event) => resolve((event as CustomEvent).detail.action), { once: true });
        }),
    );
    await page.locator('guest-book input[name=name]').fill('Ada');
    await page.locator('guest-book button').click();

    expect(await success).toMatch(/^[0-9a-f]{16}$/);
  });
});
