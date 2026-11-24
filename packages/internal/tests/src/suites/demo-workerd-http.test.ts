import path from 'node:path';
import type { Page, Route } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DemoServer, startDemo } from '../demo/demo-server.js';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const outDir = path.resolve('./dist/fixtures/demo-workerd-http');

describe('demo app on real workerd over HTTP', () => {
  let demo: DemoServer;
  let page: Page;
  let scriptsBlocked: ((route: Route) => Promise<void>) | null = null;

  const rows = () => page.locator('demo-todos li.row .title').allTextContents();
  const actionResponse = () => page.waitForResponse((response) => response.url().includes('/_lit/a/'));

  /** Serves the real pages with a CSP that stops every script, so the browser behaves as if JavaScript were off. */
  const blockScripts = async () => {
    scriptsBlocked = async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'none'" } });
    };
    await page.route(`${demo.origin}/**`, scriptsBlocked);
  };
  const allowScripts = async () => {
    if (scriptsBlocked) await page.unroute(`${demo.origin}/**`, scriptsBlocked);
    scriptsBlocked = null;
  };

  /** Reads the element's signed snapshot from its host attributes and the add action from its form, as a script on the page would. */
  const snapshotFromPage = async () => {
    const html = await (await fetch(`${demo.origin}/`)).text();
    const host = html.match(/<demo-todos([^>]*)>/)?.[1] ?? '';
    const attribute = (name: string) =>
      host
        .match(new RegExp(`${name}="([^"]*)"`))?.[1]
        ?.replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&') ?? '';
    const hash = html.match(/<form class="add"[^>]*action="\/_lit\/a\/([^"]+)"/)?.[1] ?? '';
    const attrs: Record<string, string> = { 'data-lit-token': attribute('data-lit-token'), 'data-lit-build-id': attribute('data-lit-build-id') };
    return { html, hash, tag: 'demo-todos', state: JSON.parse(attribute('data-lit-state')), sig: attribute('data-lit-sig'), token: attribute('data-lit-token'), attrs };
  };

  /** Adds a task through the enhanced form and waits for the action to settle. */
  const addTask = async (title: string) => {
    await page.fill('demo-todos input[name=title]', title);
    const settled = actionResponse();
    await page.click('demo-todos .add-btn');
    await settled;
  };

  beforeAll(async () => {
    demo = await startDemo({ outDir });
    page = await (await getTestBrowser()).newPage();
  }, 120_000);

  beforeEach(async () => {
    await allowScripts();
    await page.goto(`${demo.origin}/`);
    await page.waitForSelector('demo-todos .add-btn');
    // The store outlives a test, so start each one from an empty list.
    while ((await page.locator('demo-todos li.row').count()) > 0) {
      const settled = actionResponse();
      await page.locator('demo-todos li.row .remove').first().click();
      await settled;
      await page.waitForTimeout(30);
    }
  });

  afterAll(async () => {
    await page?.close();
    await closeTestBrowser();
    await demo?.stop();
  });

  it('puts the list and its forms in the HTML itself, signed and in Declarative Shadow DOM', async () => {
    const response = await fetch(`${demo.origin}/`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('<form class="add"');
    expect(html).toContain('data-lit-sig');
    expect(html).not.toContain('<slot name="pending">');
  });

  it('keeps every form the same small size, however much state the element holds', async () => {
    const html = await (await fetch(`${demo.origin}/`)).text();
    const forms = html.match(/<form [\s\S]*?<\/form>/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      expect(form).not.toContain('name="_lit_state"');
      expect(form.length).toBeLessThan(1200);
    }
  });

  it('stamps a build id derived from the source, and refuses actions from a page of another build', async () => {
    const snapshot = await snapshotFromPage();
    expect(snapshot.attrs['data-lit-build-id']).toMatch(/^[0-9a-f]{16}$/);

    const stale = await fetch(`${demo.origin}/_lit/a/${snapshot.hash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': snapshot.token },
      body: JSON.stringify({ tag: snapshot.tag, attrs: { ...snapshot.attrs, 'data-lit-build-id': 'an-older-build' }, state: snapshot.state, sig: snapshot.sig, args: [{ title: 'x' }], seq: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'ACTION_STALE' });
  });

  it('ships a client with no Lit runtime and no action bodies', async () => {
    const client = await (await fetch(`${demo.origin}/client.js`)).text();
    expect(client).not.toMatch(/LitElement|lit-html/);
    expect(client).not.toContain('callStore');
    expect(client).not.toContain('MAX_TODOS');
  });

  describe('with JavaScript', () => {
    it('adds, completes and removes a task in place, and the server remembers each change', async () => {
      await page.evaluate(() => {
        (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
      });

      await addTask('Buy milk');
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelectorAll('li.row').length === 1);
      expect(await rows()).toEqual(['Buy milk']);
      expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
      expect(await (await fetch(`${demo.origin}/`)).text()).toContain('Buy milk');

      const toggled = actionResponse();
      await page.click('demo-todos li.row .toggle');
      await toggled;
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelector('li.row .title')?.getAttribute('data-done') === 'yes');

      const removed = actionResponse();
      await page.click('demo-todos li.row .remove');
      await removed;
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelectorAll('li.row').length === 0);
      expect(await (await fetch(`${demo.origin}/`)).text()).not.toContain('Buy milk');
    });

    it('keeps the node the user is typing in when another action patches the list', async () => {
      await addTask('First');
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelectorAll('li.row').length === 1);
      await page.fill('demo-todos input[name=title]', 'half-typed');
      const settled = actionResponse();
      await page.click('demo-todos li.row .toggle');
      await settled;
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelector('li.row .title')?.getAttribute('data-done') === 'yes');
      expect(await page.inputValue('demo-todos input[name=title]')).toBe('half-typed');
    });

    it('reports a deliberate ActionError with its code and the field it concerns', async () => {
      await page.evaluate(() => {
        (window as unknown as { __errors: unknown[] }).__errors = [];
        document.addEventListener('lit-action-error', (event) => {
          const detail = (event as CustomEvent).detail as { error: { code: string; fields?: Record<string, string> } };
          (window as unknown as { __errors: unknown[] }).__errors.push({ code: detail.error.code, fields: detail.error.fields });
        });
      });
      await addTask('   ');
      await page.waitForFunction(() => (window as unknown as { __errors: unknown[] }).__errors.length === 1);
      expect(await page.evaluate(() => (window as unknown as { __errors: unknown[] }).__errors[0])).toEqual({ code: 'UNPROCESSABLE_CONTENT', fields: { title: 'Required' } });
      expect(await rows()).toEqual([]);
    });

    it('keeps working after a failed action, so one rejection does not strand the element', async () => {
      await addTask('   ');
      await page.waitForTimeout(100);
      await addTask('Still works');
      await page.waitForFunction(() => document.querySelector('demo-todos')?.shadowRoot?.querySelectorAll('li.row').length === 1);
      expect(await rows()).toEqual(['Still works']);
    });
  });

  describe('without JavaScript', () => {
    it('shows the list and the form, because the loader finished before the page was sent', async () => {
      await blockScripts();
      await page.goto(`${demo.origin}/`);
      expect(await page.locator('demo-todos input[name=title]').count()).toBe(1);
    });

    it('adds a task with a plain form post and lands back on the page showing it', async () => {
      await blockScripts();
      await page.goto(`${demo.origin}/`);
      await page.fill('demo-todos input[name=title]', 'Posted without script');
      await Promise.all([page.waitForURL(`${demo.origin}/`), page.click('demo-todos .add-btn')]);
      await page.waitForSelector('demo-todos li.row');
      expect(await rows()).toEqual(['Posted without script']);
    });

    it('answers a rejected form with the error and its status, not a blank page', async () => {
      await blockScripts();
      await page.goto(`${demo.origin}/`);
      await page.fill('demo-todos input[name=title]', '   ');
      const [response] = await Promise.all([page.waitForResponse((r) => r.url().includes('/_lit/a/')), page.click('demo-todos .add-btn')]);
      expect(response.status()).toBe(422);
      expect(await page.textContent('body')).toContain('Give the task a title.');
    });
  });

  describe('requests handled at the same time stay apart', () => {
    const VISITORS = 80;

    const asVisitor = async (route: string, visitor: string) => {
      const response = await fetch(`${demo.origin}${route}`, { headers: { Cookie: `visitor=${encodeURIComponent(visitor)}` } });
      return response.text();
    };

    for (const route of ['/', '/stream']) {
      it(`greets every visitor by their own name on ${route}, however the requests interleave`, async () => {
        const names = Array.from({ length: VISITORS }, (_, index) => `visitor${index}x`);
        const pages = await Promise.all(names.map((name) => asVisitor(route, name)));

        pages.forEach((page, index) => {
          // Range markers split text nodes in the markup (`Hello, <?start>name<?end>`), so read the text without them.
          const text = page.replace(/<\?(?:start[^>]*|end)>/g, '');
          const greeted = [...text.matchAll(/Hello, (visitor\d+x)/g)].map((match) => match[1]);
          expect(greeted.length, `page ${index} has a greeting`).toBeGreaterThan(0);
          expect(new Set(greeted), `page ${index} only names its own visitor`).toEqual(new Set([names[index]]));
          // The signed state in the page is that visitor's too.
          for (const other of names.filter((name) => name !== names[index])) {
            expect(page).not.toContain(other);
          }
        });
      });
    }

    it('escapes what a cookie says instead of letting one visitor inject markup into their own page', async () => {
      for (const route of ['/', '/stream']) {
        const page = await asVisitor(route, '<img src=x onerror=alert(1)>');
        expect(page).not.toContain('<img src=x');
        expect(page).toContain('&lt;img');
      }
    });

    it('applies actions to the visitor that sent them, with many in flight at once', async () => {
      const list = async () => (await (await fetch(`${demo.origin}/`)).text()).match(/class="title"/g)?.length ?? 0;
      const before = await list();
      const snapshots = await Promise.all(Array.from({ length: 4 }, () => snapshotFromPage()));
      const results = await Promise.all(
        snapshots.map((snapshot, index) =>
          fetch(`${demo.origin}/_lit/a/${snapshot.hash}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Lit-Action-Token': snapshot.token },
            body: JSON.stringify({ tag: snapshot.tag, attrs: snapshot.attrs, state: snapshot.state, sig: snapshot.sig, args: [{ title: `parallel-${index}` }], seq: 1, snapshotSeq: 0 }),
          }).then((response) => response.status),
        ),
      );
      // Only the first fits the list's limit of five tasks, but none is mistaken for another's snapshot.
      expect(results.every((status) => status === 200 || status === 409)).toBe(true);
      expect(results.filter((status) => status === 200).length).toBeGreaterThan(0);
      expect(await list()).toBeGreaterThan(before);
    });
  });

  describe('which tags in a page are expanded on the server', () => {
    it('expands only the tags it was told to, though other registered elements appear in the page', async () => {
      const html = await (await fetch(`${demo.origin}/unlisted`, { headers: { Cookie: 'visitor=reachable' } })).text();
      expect(html).toContain('class="stats"');
      expect(html).not.toContain('Hello,');
      expect(html).not.toContain('reachable');
      expect(html).toMatch(/<demo-greeting><\/demo-greeting>/);
    });
  });

  describe('replay protection backed by a Durable Object', () => {
    const send = (snapshot: Awaited<ReturnType<typeof snapshotFromPage>>, title: string) =>
      fetch(`${demo.origin}/_lit/a/${snapshot.hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Lit-Action-Token': snapshot.token },
        body: JSON.stringify({ tag: snapshot.tag, attrs: snapshot.attrs, state: snapshot.state, sig: snapshot.sig, args: [{ title }], seq: 1, snapshotSeq: 0 }),
      });

    it('lets exactly one of many simultaneous requests with the same snapshot run the action', async () => {
      const snapshot = await snapshotFromPage();
      const responses = await Promise.all(Array.from({ length: 10 }, () => send(snapshot, 'raced')));
      const statuses = responses.map((response) => response.status).sort();

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(9);
      const html = await (await fetch(`${demo.origin}/`)).text();
      expect(html.match(/class="title"/g)).toHaveLength(1);
    });

    it('does not spend a snapshot on arguments the compiler-generated validator rejects, so the corrected retry works', async () => {
      const snapshot = await snapshotFromPage();
      const rejected = await send(snapshot, 123 as unknown as string);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
      const retry = await send(snapshot, 'second try');
      expect(retry.status).toBe(200);
      expect(await (await fetch(`${demo.origin}/`)).text()).toContain('second try');
    });

    it('answers an action that fails with a fresh snapshot, which the next request can use', async () => {
      const snapshot = await snapshotFromPage();
      const failed = await send(snapshot, '   ');
      const frames = (await failed.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const fresh = frames.find((frame) => 'sig' in frame);
      expect(frames.find((frame) => 'e' in frame)).toMatchObject({ code: 'UNPROCESSABLE_CONTENT', fields: { title: 'Required' } });
      expect(fresh).toBeDefined();

      const next = await fetch(`${demo.origin}/_lit/a/${snapshot.hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', 'X-Lit-Action-Token': snapshot.token },
        body: JSON.stringify({ tag: snapshot.tag, attrs: snapshot.attrs, state: fresh.s, sig: fresh.sig, args: [{ title: 'after failure' }], seq: 2, snapshotSeq: fresh.sq }),
      });
      expect(next.status).toBe(200);
      expect(await (await fetch(`${demo.origin}/`)).text()).toContain('after failure');
    });

    it('rejects a snapshot that was already used, and says so', async () => {
      const snapshot = await snapshotFromPage();
      expect((await send(snapshot, 'once')).status).toBe(200);
      const second = await send(snapshot, 'twice');
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ code: 'STATE_REPLAYED' });
    });
  });

  describe('on the streaming route', () => {
    /** Reads the response as it arrives, noting when each chunk landed. */
    const readStreaming = async () => {
      const started = performance.now();
      const response = await fetch(`${demo.origin}/stream`);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: Array<{ at: number; text: string }> = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push({ at: performance.now() - started, text: decoder.decode(value) });
      }
      return { chunks, html: chunks.map((chunk) => chunk.text).join('') };
    };

    it('sends the shell and a skeleton long before the slow element resolves', async () => {
      const { chunks } = await readStreaming();
      const firstWithSkeleton = chunks.find((chunk) => chunk.text.includes('Counting tasks'));
      const withStats = chunks.find((chunk) => chunk.text.includes('class="stats"'));
      expect(firstWithSkeleton).toBeDefined();
      expect(withStats).toBeDefined();
      // The count takes about 300 ms; the shell must not have waited for it.
      expect(withStats!.at - firstWithSkeleton!.at).toBeGreaterThan(150);
    });

    it('swaps the todo list in before the slower stats, whatever their order in the page', async () => {
      const { html } = await readStreaming();
      expect(html.indexOf('<demo-stats')).toBeLessThan(html.indexOf('<demo-todos'));
      expect(html.indexOf('class="add-btn"')).toBeLessThan(html.indexOf('class="stats"'));
    });

    it('fills in both elements in the browser, with the stats replacing its skeleton', async () => {
      await page.goto(`${demo.origin}/stream`);
      await page.waitForSelector('demo-todos .add-btn');
      await page.waitForSelector('demo-stats .stats');
      expect(await page.locator('demo-stats .pending').count()).toBe(0);
      expect(await page.textContent('demo-stats .stats')).toMatch(/\d+ of \d+ done/);
    });

    it('shows the todo list before the stats has arrived', async () => {
      await page.goto(`${demo.origin}/stream`, { waitUntil: 'commit' });
      await page.waitForSelector('demo-todos .add-btn');
      expect(await page.locator('demo-stats .stats').count()).toBe(0);
      await page.waitForSelector('demo-stats .stats');
    });

    // The element arrives as a swap script, so without scripts only the pending slot is left. This is why `/` is the no-JavaScript route.
    it('leaves only the pending slot when scripts cannot run', async () => {
      await blockScripts();
      await page.goto(`${demo.origin}/stream`);
      expect(await page.locator('demo-todos input[name=title]').count()).toBe(0);
      expect(await page.locator('demo-todos slot[name=pending]').count()).toBe(1);
    });
  });
});

describe('a page left open past its signed state', () => {
  let short: DemoServer;
  let page: Page;

  beforeAll(async () => {
    short = await startDemo({ outDir: path.resolve('./dist/fixtures/demo-workerd-expiry'), stateTtlMs: 700 });
    page = await (await getTestBrowser()).newPage();
  }, 120_000);

  afterAll(async () => {
    await page?.close();
    await short?.stop();
  });

  it('tells the script that the page expired, with a code the app can act on, instead of a tamper error', async () => {
    await page.goto(`${short.origin}/`);
    await page.waitForSelector('demo-todos .add-btn');
    await page.evaluate(() => {
      (window as unknown as { __errors: unknown[] }).__errors = [];
      document.addEventListener('lit-action-error', (event) => {
        (window as unknown as { __errors: unknown[] }).__errors.push((event as CustomEvent).detail.error.code);
      });
    });

    await page.waitForTimeout(1_000);
    await page.fill('demo-todos input[name=title]', 'too late');
    await page.click('demo-todos .add-btn');
    await page.waitForFunction(() => (window as unknown as { __errors: unknown[] }).__errors.length === 1);

    expect(await page.evaluate(() => (window as unknown as { __errors: unknown[] }).__errors[0])).toBe('STATE_EXPIRED');
  });

  it('answers a form post from an expired page with a page that says to reload', async () => {
    await page.route(`${short.origin}/**`, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'none'" } });
    });
    await page.goto(`${short.origin}/`);
    await page.fill('demo-todos input[name=title]', 'too late');
    await page.waitForTimeout(1_000);
    const [response] = await Promise.all([page.waitForResponse((r) => r.url().includes('/_lit/a/')), page.click('demo-todos .add-btn')]);

    expect(response.status()).toBe(409);
    expect(await page.textContent('body')).toContain('Reload to continue');
  });
});
