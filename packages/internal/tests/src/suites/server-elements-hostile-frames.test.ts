import path from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DemoServer, startDemo } from '../demo/demo-server.js';
import { closeTestBrowser, getTestBrowser } from '../harness.js';

const outDir = path.resolve('./dist/fixtures/hostile-frames');

/**
 * Frames come from the server, which is trusted, but a corrupted response or a bug on the server side
 * should still not be able to do more than get the page wrong: no markup from a value, no prototype
 * pollution, nothing changed outside the element, and no exception that strands the action queue.
 *
 * The host is the real compiled and server-rendered demo element, so its part table and markers come
 * from the compiler and renderer rather than from hand-written fixtures.
 */
describe('the client patch executor against hostile and malformed frames', () => {
  let demo: DemoServer;
  let page: Page;

  beforeAll(async () => {
    demo = await startDemo({ outDir });
    page = await (await getTestBrowser()).newPage();
    await page.goto(`${demo.origin}/`);
    await page.waitForSelector('demo-todos .add-btn');
    await page.evaluate(() => {
      const outside = document.createElement('div');
      outside.id = 'outside';
      outside.textContent = 'untouched';
      document.body.append(outside);
      (window as unknown as { __pwned?: boolean }).__pwned = false;
    });
  }, 120_000);

  afterAll(async () => {
    await page?.close();
    await demo?.stop();
    await closeTestBrowser();
  });

  /** Runs `script` against the real host with the executor, a part count and a before/after structure probe. */
  const run = <T>(script: (host: HTMLElement, execute: (host: HTMLElement, frame: unknown) => void, parts: number) => T, argument?: unknown) =>
    page.evaluate(
      ({ source, input }) => {
        const host = document.querySelector('demo-todos') as HTMLElement;
        const execute = (window as unknown as { __litExecutePatches: (host: HTMLElement, frame: unknown) => void }).__litExecutePatches;
        const parts = ((host.constructor as unknown as { __litParts?: unknown[] }).__litParts ?? []).length;
        const tags = () => Array.from((host.shadowRoot as ShadowRoot).querySelectorAll('*')).map((el) => el.tagName.toLowerCase());
        const count = (names: string[]) => names.reduce<Record<string, number>>((tally, name) => ({ ...tally, [name]: (tally[name] ?? 0) + 1 }), {});
        const before = count(tags());
        const prototypeBefore = Object.getOwnPropertyNames(Object.prototype).sort().join();
        const result = new Function('host', 'execute', 'parts', 'input', `return (${source})(host, execute, parts, input)`)(host, execute, parts, input);
        return {
          result,
          parts,
          // A scalar may clear content it replaces, but it must never add an element.
          addedElements: Object.entries(count(tags()))
            .filter(([name, total]) => total > (before[name] ?? 0))
            .map(([name]) => name),
          prototypePolluted: Object.getOwnPropertyNames(Object.prototype).sort().join() !== prototypeBefore || ({} as Record<string, unknown>).polluted !== undefined,
          pwned: Boolean((window as unknown as { __pwned?: boolean }).__pwned),
          outside: document.getElementById('outside')?.textContent,
          injected:
            document.querySelectorAll('img[src="x"], iframe[srcdoc], svg[onload]').length +
            (host.shadowRoot as ShadowRoot).querySelectorAll('img[src="x"], iframe[srcdoc], svg[onload], script').length,
        };
      },
      { source: script.toString(), input: argument },
    );

  /** Applies every frame on its own and reports how many threw. */
  const applyAll = (script: string, frames: unknown[]) =>
    run((host, execute, _parts, input) => {
      let threw = 0;
      const messages: string[] = [];
      for (const frame of input as unknown[]) {
        try {
          execute(host, frame);
        } catch (error) {
          threw++;
          if (messages.length < 5) messages.push(String(error).slice(0, 120));
        }
      }
      return { threw, messages };
    }, frames);

  it('finds the real part table the compiler produced', async () => {
    const { parts } = await run(() => null);
    expect(parts).toBeGreaterThan(2);
  });

  it('never turns a scalar value into markup, whatever the value holds', async () => {
    const payloads = [
      '<img src=x onerror="window.__pwned=true">',
      '<script>window.__pwned=true</script>',
      '"><svg onload="window.__pwned=true">',
      '</p><iframe srcdoc="x"></iframe>',
      '<!-- -->',
      '\u0000',
      '\u2028',
      'x'.repeat(100_000),
    ];
    const { parts } = await run(() => null);
    const frames = payloads.flatMap((value) => Array.from({ length: parts }, (_, p) => ({ p, v: value })));
    const outcome = await applyAll('', frames);

    expect(outcome.result.messages).toEqual([]);
    expect(outcome.pwned).toBe(false);
    expect(outcome.injected).toBe(0);
    expect(outcome.addedElements).toEqual([]);
    expect(outcome.outside).toBe('untouched');
  });

  it('survives scalar values of every type', async () => {
    const values = [null, undefined, 0, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, true, false, {}, [], { toString: 1 }, JSON.parse('{"__proto__":{"polluted":true}}'), [1, [2, [3]]]];
    const { parts } = await run(() => null);
    const outcome = await applyAll(
      '',
      values.flatMap((value) => Array.from({ length: parts }, (_, p) => ({ p, v: value }))),
    );
    expect(outcome.result.messages).toEqual([]);
    expect(outcome.prototypePolluted).toBe(false);
  });

  it('ignores part indexes that do not name a part, without touching anything', async () => {
    const indexes = [-1, 99, 1e9, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0', null, undefined, {}, [], '__proto__', 'constructor', true];
    const outcome = await applyAll(
      '',
      indexes.map((p) => ({ p, v: 'hostile' })),
    );
    expect(outcome.result.messages).toEqual([]);
    expect(outcome.prototypePolluted).toBe(false);
    expect(outcome.addedElements).toEqual([]);
  });

  it('does not throw on frames of the wrong shape, so one bad frame cannot strand the action queue', async () => {
    const wrongShapes: unknown[] = [null, undefined, 0, 1, 'text', true, [], {}, { s: null }, { s: 5 }, { s: { a: 1 }, sig: 7 }, { r: undefined }, { e: 5 }];
    const { parts } = await run(() => null);
    for (let p = 0; p < parts; p++) {
      wrongShapes.push(
        { p },
        { p, f: null },
        { p, f: 'html' },
        { p, f: { html: 5 } },
        { p, f: {} },
        { p, k: null },
        { p, k: { ops: 'no' } },
        {
          p,
          k: {
            ops: [
              null,
              1,
              'x',
              {},
              { op: 'nope' },
              { op: 'remove' },
              { op: 'insert' },
              { op: 'update' },
              { op: 'reorder', order: null },
              { op: 'replace', items: null },
              { op: 'replace', items: [null, 1, {}] },
            ],
          },
        },
      );
    }
    const outcome = await applyAll('', wrongShapes);
    expect(outcome.result.messages).toEqual([]);
    expect(outcome.result.threw).toBe(0);
    expect(outcome.prototypePolluted).toBe(false);
    expect(outcome.outside).toBe('untouched');
  });

  it('survives a long run of randomly generated frames, with nothing escaping the element', async () => {
    const outcome = await run((host, execute, parts) => {
      let seed = 0x2f6e2b1;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
      // Structural and keyed html is markup by design, so the generated markup is inert; scalar values are the injection surface.
      const atom = () => pick<unknown>([null, undefined, 0, 1, -1, 2.5, '', 'text', '<b>x</b>', true, false, {}, [], '__proto__', '<img src=x onerror="window.__pwned=true">']);
      const inert = () => pick<unknown>([null, undefined, 0, 1, '', 'text', '<b>x</b>', true, {}, [], '__proto__']);
      const value = (depth = 0): unknown =>
        depth > 2 ? atom() : pick<unknown>([atom(), atom(), [value(depth + 1), value(depth + 1)], { [pick(['a', 'html', 'key', 'op', '__proto__'])]: value(depth + 1) }]);
      const part = () => pick<unknown>([Math.floor(random() * (parts + 2)), inert()]);
      const frame = () =>
        pick<() => unknown>([
          () => ({ p: part(), v: value() }),
          () => ({ p: part(), f: { html: pick(['<i>x</i>', '', 'plain', inert()]) } }),
          () => ({
            p: part(),
            k: {
              ops: [
                inert(),
                {
                  op: pick(['insert', 'remove', 'update', 'reorder', 'replace']),
                  key: inert(),
                  html: pick(['<li>k</li>', inert()]),
                  text: inert(),
                  items: [{ key: inert(), html: '<li>k</li>' }, inert()],
                  order: [inert(), inert()],
                },
              ],
            },
          }),
          () => ({ s: inert(), sig: inert(), sq: inert() }),
          () => inert(),
        ])();

      let threw = 0;
      const messages = new Set<string>();
      for (let index = 0; index < 3000; index++) {
        try {
          execute(host, frame());
        } catch (error) {
          threw++;
          messages.add(String(error).slice(0, 100));
        }
      }
      return { threw, messages: [...messages].slice(0, 8) };
    });
    expect(outcome.result.messages).toEqual([]);
    expect(outcome.result.threw).toBe(0);
    expect(outcome.prototypePolluted).toBe(false);
    expect(outcome.pwned).toBe(false);
    expect(outcome.outside).toBe('untouched');
  });
});
