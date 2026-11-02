import { describe, expect, it } from 'vitest';
import { type ActionEndpointOptions, handleActionRequest, type ServerElementRegistry } from '../../src/action-endpoint.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import type { ActionRequestBody } from '../../src/types.js';

describe('server action endpoint handler', () => {
  const secret = 'endpoint-test-secret-32-chars-long';
  const actionHash = '0123456789abcdef';

  class CounterElement extends ServerElement {
    static tagName = 'counter-element';
    count = 0;
    label = 'counter';
    stock = 100;

    static properties = {
      count: { state: true },
      label: { type: String },
      stock: { state: true },
    };

    static __lit_loaders = {
      load: { writes: ['stock'] },
    };

    static __lit_actions = {
      [actionHash]: {
        name: 'increment',
        writes: ['count'],
        validate: (args: unknown[]) => {
          if (!Array.isArray(args) || typeof args[0] !== 'number') {
            throw new TypeError('First argument must be a number');
          }
          return args;
        },
      },
    };

    async load() {
      this.stock = 99;
    }

    async increment(amount: number) {
      if (amount < 0) {
        throw new Error('Amount cannot be negative');
      }
      this.count += amount;
      return { newCount: this.count };
    }

    render() {
      return {
        strings: ['<span>Count: ', '</span>'],
        values: [this.count],
      };
    }
  }

  const registry: ServerElementRegistry = {
    get(name: string) {
      if (name === 'counter-element') return CounterElement;
      return undefined;
    },
  };

  const defaultOptions: ActionEndpointOptions = {
    env: { DB: {} },
    secret,
    registry,
  };

  it('rejects non-POST HTTP methods with 405 Method Not Allowed', async () => {
    const req = new Request('http://localhost/_lit/a/' + actionHash, { method: 'GET' });
    const res = await handleActionRequest(req, defaultOptions);

    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('returns 404 for URLs not matching route prefix', async () => {
    const req = new Request('http://localhost/api/other/' + actionHash, { method: 'POST' });
    const res = await handleActionRequest(req, defaultOptions);

    expect(res.status).toBe(404);
  });

  it('rejects invalid action hash format with 400 Bad Request', async () => {
    const req = new Request('http://localhost/_lit/a/short-hash', { method: 'POST' });
    const res = await handleActionRequest(req, defaultOptions);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('INVALID_HASH');
  });

  it('rejects cross-origin requests when not in allowedOrigins', async () => {
    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.attacker.com',
      },
    });
    const res = await handleActionRequest(req, defaultOptions);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('CSRF_BLOCKED');
  });

  it('allows cross-origin requests when origin is listed in allowedOrigins', async () => {
    const state = { count: 0 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });
    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [1],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        Origin: 'https://trusted.partner.com',
        'Content-Type': 'application/json',
        'X-Lit-Action-Token': 'token123',
      },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, {
      ...defaultOptions,
      allowedOrigins: ['https://trusted.partner.com'],
    });

    expect(res.status).toBe(200);
  });

  it('rejects cross-site Sec-Fetch-Site requests with 403', async () => {
    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Sec-Fetch-Site': 'cross-site',
      },
    });
    const res = await handleActionRequest(req, defaultOptions);

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('CSRF_BLOCKED');
  });

  it('rejects prototype pollution payload with 400 Bad Request', async () => {
    const payload = '{"tag":"counter-element","attrs":{},"state":{"__proto__":{"admin":true}},"sig":"","args":[1],"seq":1}';

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('PROTOTYPE_POLLUTION');
  });

  it('rejects tampered state snapshot with 403 Forbidden', async () => {
    const state = { count: 0 };
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret);

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: {},
      state: { count: 100 }, // Tampered
      sig,
      args: [1],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('STATE_TAMPERED');
  });

  it('returns 404 for unknown custom element tag', async () => {
    const state = { count: 0 };
    const { sig } = await createSignedStateSnapshot('unknown-element', state, secret);

    const body: ActionRequestBody = {
      tag: 'unknown-element',
      attrs: {},
      state,
      sig,
      args: [1],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe('ELEMENT_NOT_FOUND');
  });

  it('returns 404 for unknown action hash on valid component', async () => {
    const state = { count: 0 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });
    const unknownHash = 'fedcba9876543210';

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [1],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + unknownHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': 'token123' },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.code).toBe('ACTION_NOT_FOUND');
  });

  it('runs schema validation and rejects invalid argument types with 400', async () => {
    const state = { count: 0 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: ['invalid-not-a-number'], // Should be number
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': 'token123' },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('VALIDATION_ERROR');
    expect(data.error).toContain('First argument must be a number');
  });

  it('executes action and streams patch frames over application/x-ndjson', async () => {
    const state = { count: 5 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [3],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        'X-Lit-Action-Token': 'token123',
      },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');

    const text = await res.text();
    const lines = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // Should contain scalar patch for count = 8
    const scalarFrame = lines.find((f: any) => 'v' in f);
    expect(scalarFrame).toBeDefined();
    expect(scalarFrame.v).toBe(8);

    // Should contain return value { r: { newCount: 8 } }
    const returnFrame = lines.find((f: any) => 'r' in f);
    expect(returnFrame).toBeDefined();
    expect(returnFrame.r).toEqual({ newCount: 8 });

    // Should contain signed state snapshot { s, sig }
    const stateFrame = lines.find((f: any) => 's' in f);
    expect(stateFrame).toBeDefined();
    expect(stateFrame.s.count).toBe(8);
    expect(stateFrame.sig).toContain('.');
  });

  it('executes action and returns batch JSON array when Accept is application/json', async () => {
    const state = { count: 10 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [2],
      seq: 2,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Lit-Action-Token': 'token123',
      },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, defaultOptions);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const frames = await res.json();
    expect(Array.isArray(frames)).toBe(true);

    const scalarFrame = frames.find((f: any) => 'v' in f);
    expect(scalarFrame.v).toBe(12);

    const returnFrame = frames.find((f: any) => 'r' in f);
    expect(returnFrame.r).toEqual({ newCount: 12 });
  });

  it('supports setting cookies and custom headers via ActionContext', async () => {
    class CookieElement extends ServerElement {
      static tagName = 'cookie-element';
      static __lit_actions = {
        [actionHash]: {
          name: 'login',
          writes: [],
          validate: (a: any) => a,
        },
      };

      async login() {
        const ctx: any = (this as any)._context || (this as any)[Object.getOwnPropertySymbols(this)[0]];
        if (ctx) {
          ctx.setCookie('session', 'abc-123', { httpOnly: true, secure: true, maxAge: 3600 });
          ctx.setHeader('X-Custom-Auth', 'verified');
        }
        return { success: true };
      }
    }

    const customRegistry: ServerElementRegistry = {
      get(name: string) {
        if (name === 'cookie-element') return CookieElement;
        return undefined;
      },
    };

    const state = {};
    const { sig } = await createSignedStateSnapshot('cookie-element', state, secret, { token: 'token123' });

    const body: ActionRequestBody = {
      tag: 'cookie-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [],
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Lit-Action-Token': 'token123',
      },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, {
      ...defaultOptions,
      registry: customRegistry,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Custom-Auth')).toBe('verified');
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('session=abc-123');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
  });

  it('streams error patch frame when action method throws in streaming mode', async () => {
    const state = { count: 0 };
    const { sig } = await createSignedStateSnapshot('counter-element', state, secret, { token: 'token123' });

    const body: ActionRequestBody = {
      tag: 'counter-element',
      attrs: { 'data-lit-token': 'token123' },
      state,
      sig,
      args: [-5], // Will throw inside increment()
      seq: 1,
    };

    const req = new Request('http://localhost/_lit/a/' + actionHash, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
        'X-Lit-Action-Token': 'token123',
      },
      body: JSON.stringify(body),
    });

    const res = await handleActionRequest(req, { ...defaultOptions, devMode: true });
    expect(res.status).toBe(200);

    const text = await res.text();
    const frames = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    const errFrame = frames.find((f: any) => 'e' in f);
    expect(errFrame).toBeDefined();
    expect(errFrame.e).toContain('Amount cannot be negative');
  });
});
