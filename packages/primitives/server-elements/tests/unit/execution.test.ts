import { describe, expect, it } from 'vitest';
import type { LoaderContext } from '../../src/context.js';
import { bindContext, declaredLoaderNames, runLoaders } from '../../src/execution.js';
import { CONTEXT_SYMBOL } from '../../src/symbols.js';

const context = { env: {} } as unknown as LoaderContext;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeClass(loaders: Record<string, (this: any) => Promise<void>>) {
  class Element {
    static __lit_loaders = Object.fromEntries(Object.keys(loaders).map((name) => [name, { writes: [] }]));
  }
  for (const [name, fn] of Object.entries(loaders)) {
    (Element.prototype as any)[name] = fn;
  }
  return Element;
}

describe('bindContext', () => {
  it('uses _setContext when the element provides it', () => {
    let received: unknown;
    bindContext({ _setContext: (c: unknown) => (received = c) }, context);
    expect(received).toBe(context);
  });

  it('falls back to the context symbol for plain elements', () => {
    const el: any = {};
    bindContext(el, context);
    expect(el[CONTEXT_SYMBOL]).toBe(context);
  });
});

describe('declaredLoaderNames', () => {
  it('prefers compiled loader metadata', () => {
    const Element = makeClass({ users: async () => {}, posts: async () => {} });
    expect(declaredLoaderNames(Element, new Element())).toEqual(['users', 'posts']);
  });

  it('falls back to a conventional load() method', () => {
    class Plain {
      async load() {}
    }
    expect(declaredLoaderNames(Plain, new Plain())).toEqual(['load']);
  });

  it('returns nothing for elements without loaders', () => {
    class Plain {}
    expect(declaredLoaderNames(Plain, new Plain())).toEqual([]);
  });
});

describe('runLoaders', () => {
  it('runs loaders concurrently instead of one after another', async () => {
    const Element = makeClass({
      a: async function (this: any) {
        await sleep(60);
        this.a = 1;
      },
      b: async function (this: any) {
        await sleep(60);
        this.b = 2;
      },
      c: async function (this: any) {
        await sleep(60);
        this.c = 3;
      },
    });
    const instance: any = new Element();
    const started = performance.now();
    await runLoaders(instance, Element, context);
    const elapsed = performance.now() - started;

    expect(instance).toMatchObject({ a: 1, b: 2, c: 3 });
    expect(elapsed).toBeLessThan(150);
  });

  it('lets every loader settle before reporting the first failure', async () => {
    let slowFinished = false;
    const Element = makeClass({
      fails: async () => {
        throw new Error('boom');
      },
      slow: async () => {
        await sleep(40);
        slowFinished = true;
      },
    });

    await expect(runLoaders(new Element(), Element, context)).rejects.toThrow('boom');
    expect(slowFinished).toBe(true);
  });

  it('passes env and context to each loader', async () => {
    const seen: unknown[] = [];
    class Element {
      static __lit_loaders = { load: {} };
      async load(env: unknown, ctx: unknown) {
        seen.push(env, ctx);
      }
    }
    await runLoaders(new Element(), Element, context);
    expect(seen).toEqual([context.env, context]);
  });
});
