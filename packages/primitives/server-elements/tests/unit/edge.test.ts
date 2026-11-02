import { describe, expect, it } from 'vitest';
import { createLoaderContext, executeServerAction, executeServerLoader, renderServerElement, renderTemplateToString, renderToResponse } from '../../src/edge.js';
import { ServerElement } from '../../src/element.js';

describe('edge runtime and initial SSR rendering', () => {
  it('createLoaderContext parses cookies, headers, URL, and signal', () => {
    const req = new Request('https://example.com/items/42?filter=active', {
      headers: {
        Cookie: 'user=alice; token=xyz%20123',
        'X-Trace-Id': 'trace-999',
      },
    });

    const ctx = createLoaderContext(req, { DB: 'conn' }, { id: '42' });

    expect(ctx.url.pathname).toBe('/items/42');
    expect(ctx.url.searchParams.get('filter')).toBe('active');
    expect(ctx.params).toEqual({ id: '42' });
    expect(ctx.cookies.get('user')).toBe('alice');
    expect(ctx.cookies.get('token')).toBe('xyz 123');
    expect(ctx.headers.get('X-Trace-Id')).toBe('trace-999');
    expect(ctx.env).toEqual({ DB: 'conn' });
    expect(ctx.signal).toBe(req.signal);
  });

  it('createLoaderContext handles requests without cookies cleanly', () => {
    const req = new Request('https://example.com/');
    const ctx = createLoaderContext(req);

    expect(ctx.cookies.size).toBe(0);
    expect(ctx.params).toEqual({});
  });

  it('executeServerLoader injects context and calls loader', async () => {
    class TestElement extends ServerElement {
      loadedData = '';
      async load(env: any, context: any) {
        this.loadedData = `${context.url.pathname}:${env.MODE}`;
      }
    }

    const instance = new TestElement();
    const req = new Request('http://localhost/products');
    const ctx = createLoaderContext(req, { MODE: 'production' });

    await executeServerLoader(instance, ctx, 'load');
    expect(instance.loadedData).toBe('/products:production');
  });

  it('executeServerAction executes action method and returns result', async () => {
    class ActionElement extends ServerElement {
      async multiply(a: number, b: number) {
        return a * b;
      }
    }

    const instance = new ActionElement();
    const req = new Request('http://localhost/');
    const ctx = createLoaderContext(req) as any;

    const result = await executeServerAction(instance, ctx, 'multiply', [6, 7]);
    expect(result).toBe(42);
  });

  it('executeServerAction throws when action method is not found', async () => {
    const instance = new ServerElement();
    const ctx = createLoaderContext() as any;

    await expect(executeServerAction(instance, ctx, 'nonExistentAction', [])).rejects.toThrow("Action method 'nonExistentAction' not found");
  });

  it('renderTemplateToString converts strings, numbers, arrays, and template results', () => {
    expect(renderTemplateToString('<div>Hello</div>')).toBe('&lt;div&gt;Hello&lt;/div&gt;');
    expect(renderTemplateToString(123)).toBe('123');
    expect(renderTemplateToString(['a', 'b', 'c'])).toBe('abc');

    const fakeTemplate = {
      strings: ['<h1>', '</h1><p>', '</p>'],
      values: ['Title', 'Body paragraph'],
    };
    expect(renderTemplateToString(fakeTemplate)).toBe('<h1>Title</h1><p>Body paragraph</p>');
  });

  it('renderServerElement executes loaders, creates signed state snapshot, and outputs DSD', async () => {
    class UserProfileElement extends ServerElement {
      static tagName = 'user-profile';
      userId = '123';
      userName = '';
      role = 'user';

      static properties = {
        userId: { type: String },
        userName: { state: true },
        role: { state: true },
      };

      static __lit_loaders = {
        loadUser: { writes: ['userName'] },
      };

      connected = false;
      willUpdated = false;

      connectedCallback() {
        this.connected = true;
      }

      willUpdate() {
        this.willUpdated = true;
      }

      async loadUser() {
        this.userName = 'Alice Smith';
      }

      render() {
        return {
          strings: ['<div class="profile">', ' (', ')</div>'],
          values: [this.userName, this.role],
        };
      }
    }

    const req = new Request('https://example.com/user/123');
    const result = await renderServerElement(UserProfileElement, { userId: '456' }, { request: req, secret: 'test-secret' });

    expect(result.tagName).toBe('user-profile');
    expect(result.state).toEqual({
      userId: '456',
      userName: 'Alice Smith',
      role: 'user',
    });
    expect(result.sig).toContain('.');
    expect(result.token).toMatch(/^[0-9a-f]{16}$/);

    expect(result.html).toContain('<user-profile');
    expect(result.html).toContain('data-lit-ssr="0"');
    expect(result.html).toContain(`data-lit-sig="${result.sig}"`);
    expect(result.html).toContain(`data-lit-token="${result.token}"`);
    expect(result.html).toContain('<template shadowrootmode="open">');
    expect(result.html).toMatch(/<div class="profile">.*?Alice Smith.*?\(.*?user.*?\)<\/div>/);
    expect(result.html).toContain('</template></user-profile>');
  });

  it('renderServerElement looks up tag from customElements registry', async () => {
    class TagElement extends ServerElement {
      render() {
        return { strings: ['<span>Registered Tag</span>'], values: [] };
      }
    }

    const registry = {
      get(name: string) {
        if (name === 'custom-tag') return TagElement;
        return undefined;
      },
    };

    const res = await renderServerElement('custom-tag', {}, { customElements: registry, secret: 'test-secret' });
    expect(res.tagName).toBe('custom-tag');
    expect(res.html).toContain('<span>Registered Tag</span>');
  });

  it('renderServerElement throws for unresolvable custom element tag', async () => {
    await expect(renderServerElement('missing-tag', {}, { customElements: { get: () => undefined } })).rejects.toThrow("Custom element constructor for 'missing-tag' not found");
  });

  it('renderToResponse outputs streaming response with nosniff header', async () => {
    class SimpleElement extends ServerElement {
      render() {
        return { strings: ['<p>Simple component</p>'], values: [] };
      }
    }

    const res = renderToResponse(SimpleElement, { status: 201, secret: 'test-secret' });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');

    const html = await res.text();
    expect(html).toContain('<p>Simple component</p>');
  });

  it('renderToResponse handles direct strings and custom headers', async () => {
    const res = renderToResponse('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>', {
      headers: { 'X-Custom-Engine': 'lit-server-elements' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Custom-Engine')).toBe('lit-server-elements');
    const text = await res.text();
    expect(text).toBe('<!DOCTYPE html><html><body><h1>Hello</h1></body></html>');
  });
});
