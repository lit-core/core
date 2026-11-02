import { EventEmitter } from 'node:events';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { canonicalizeJson, createSignedStateSnapshot, hasPrototypePollution, verifyStateSignature, verifyStateSnapshot } from '@lit-core/server-elements/crypto';
import { serverElements as viteServerElements } from '@lit-core/vite-plugin';
import { LitWebpackPlugin } from '@lit-core/webpack-plugin';
import { describe, expect, it } from 'vitest';

describe('milestone 4 challenger: server elements adversarial stress suite', () => {
  const testSecret = 'challenger-audit-secret-key-32bytes!';
  const altSecret = 'attacker-forged-secret-key-32bytes!';

  // =========================================================================
  // Section 1: Cryptographic State Signing, HMAC-SHA256 & Expiry Stress
  // =========================================================================
  describe('HMAC-SHA256 signature verification and tamper resilience', () => {
    it('verifies untampered state snapshots successfully', async () => {
      const state = { count: 42, role: 'member', tags: ['a', 'b'] };
      const snapshot = await createSignedStateSnapshot('user-profile', state, testSecret);
      const verifyOpts = { token: snapshot.token };

      expect(snapshot.sig).toContain('.');
      const isValid = await verifyStateSignature('user-profile', state, snapshot.sig, testSecret, verifyOpts);
      expect(isValid).toBe(true);

      const verified = await verifyStateSnapshot('user-profile', state, snapshot.sig, testSecret, verifyOpts);
      expect(verified.valid).toBe(true);
      expect(verified.state).toEqual(state);
    });

    it('rejects single-bit / single-character tampering in signature hex', async () => {
      const state = { count: 10 };
      const snapshot = await createSignedStateSnapshot('counter-el', state, testSecret);
      const verifyOpts = { token: snapshot.token };
      const [expStr, sigHex] = snapshot.sig.split('.');

      // Flip first character of hex signature
      const flippedFirst = (sigHex[0] === 'a' ? 'b' : 'a') + sigHex.slice(1);
      const tamperedSig1 = `${expStr}.${flippedFirst}`;
      expect(await verifyStateSignature('counter-el', state, tamperedSig1, testSecret, verifyOpts)).toBe(false);

      // Flip last character of hex signature
      const flippedLast = sigHex.slice(0, -1) + (sigHex.slice(-1) === 'f' ? 'e' : 'f');
      const tamperedSig2 = `${expStr}.${flippedLast}`;
      expect(await verifyStateSignature('counter-el', state, tamperedSig2, testSecret, verifyOpts)).toBe(false);

      const res = await verifyStateSnapshot('counter-el', state, tamperedSig1, testSecret, verifyOpts);
      expect(res.valid).toBe(false);
      expect(res.error).toBe('INVALID_SIGNATURE');
    });

    it('rejects state property mutations without signature update (state tampering)', async () => {
      const state = { userId: 'usr_1', role: 'viewer', balance: 100 };
      const snapshot = await createSignedStateSnapshot('account-view', state, testSecret);
      const verifyOpts = { token: snapshot.token };

      // Mutate scalar value
      const mutatedValue = { ...state, balance: 1000000 };
      expect(await verifyStateSignature('account-view', mutatedValue, snapshot.sig, testSecret, verifyOpts)).toBe(false);

      // Inject privilege escalation property
      const injectedProp = { ...state, isAdmin: true };
      expect(await verifyStateSignature('account-view', injectedProp, snapshot.sig, testSecret, verifyOpts)).toBe(false);

      // Delete property
      const { balance: _omitted, ...deletedProp } = state;
      expect(await verifyStateSignature('account-view', deletedProp, snapshot.sig, testSecret, verifyOpts)).toBe(false);
    });

    it('rejects cross-element state replay attacks', async () => {
      const state = { balance: 500 };
      const snapshot = await createSignedStateSnapshot('safe-card', state, testSecret);
      const verifyOpts = { token: snapshot.token };

      // Attempt replay against a different element tag
      const replayed = await verifyStateSignature('admin-card', state, snapshot.sig, testSecret, verifyOpts);
      expect(replayed).toBe(false);

      const replayResult = await verifyStateSnapshot('admin-card', state, snapshot.sig, testSecret, verifyOpts);
      expect(replayResult.valid).toBe(false);
      expect(replayResult.error).toBe('INVALID_SIGNATURE');

      // Tag case normalization: should succeed for equivalent case-insensitive tag names
      const caseNormalized = await verifyStateSignature('SAFE-CARD', state, snapshot.sig, testSecret, verifyOpts);
      expect(caseNormalized).toBe(true);
    });

    it('rejects snapshots signed with a different or attacker-controlled secret', async () => {
      const state = { verified: true };
      const attackerSnapshot = await createSignedStateSnapshot('auth-card', state, altSecret);
      const verifyOpts = { token: attackerSnapshot.token };

      const isValid = await verifyStateSignature('auth-card', state, attackerSnapshot.sig, testSecret, verifyOpts);
      expect(isValid).toBe(false);

      const result = await verifyStateSnapshot('auth-card', state, attackerSnapshot.sig, testSecret, verifyOpts);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('INVALID_SIGNATURE');
    });

    it('rejects expired snapshots and detects timestamp tampering', async () => {
      const state = { token: 't123' };

      // Snapshot with negative TTL (already expired)
      const expiredSnapshot = await createSignedStateSnapshot('session-el', state, testSecret, -10_000);
      const verifyOpts = { token: expiredSnapshot.token };
      expect(await verifyStateSignature('session-el', state, expiredSnapshot.sig, testSecret, verifyOpts)).toBe(false);

      const expRes = await verifyStateSnapshot('session-el', state, expiredSnapshot.sig, testSecret, verifyOpts);
      expect(expRes.valid).toBe(false);
      expect(expRes.error).toBe('EXPIRED_SNAPSHOT');

      // Tampered timestamp: change expired timestamp to year 2099
      const [_oldExp, sigHex] = expiredSnapshot.sig.split('.');
      const futureExp = String(Date.now() + 100_000_000);
      const tamperedSig = `${futureExp}.${sigHex}`;

      // Changing timestamp must invalidate HMAC verification because expiresAt is bound into the signed payload
      expect(await verifyStateSignature('session-el', state, tamperedSig, testSecret, verifyOpts)).toBe(false);
      const tamperedRes = await verifyStateSnapshot('session-el', state, tamperedSig, testSecret, verifyOpts);
      expect(tamperedRes.valid).toBe(false);
      expect(tamperedRes.error).toBe('INVALID_SIGNATURE');
    });

    it('rejects malformed signature formats and non-hex characters', async () => {
      const state = { a: 1 };
      const snapshot = await createSignedStateSnapshot('test-el', state, testSecret);
      const verifyOpts = { token: snapshot.token };
      const [expStr, sigHex] = snapshot.sig.split('.');

      // Truncated signature (less than 64 hex characters)
      expect(await verifyStateSignature('test-el', state, `${expStr}.${sigHex.slice(0, 32)}`, testSecret, verifyOpts)).toBe(false);

      // Overlong signature (more than 64 hex characters)
      expect(await verifyStateSignature('test-el', state, `${expStr}.${sigHex}00`, testSecret, verifyOpts)).toBe(false);

      // Non-hex characters
      expect(await verifyStateSignature('test-el', state, `${expStr}.${sigHex.slice(0, -1)}z`, testSecret, verifyOpts)).toBe(false);

      // Missing dot separator or extra dots
      expect(await verifyStateSignature('test-el', state, `${expStr}${sigHex}`, testSecret, verifyOpts)).toBe(false);
      expect(await verifyStateSignature('test-el', state, `${expStr}.${sigHex}.extra`, testSecret, verifyOpts)).toBe(false);

      // Non-finite expiry strings
      expect(await verifyStateSignature('test-el', state, `NaN.${sigHex}`, testSecret, verifyOpts)).toBe(false);
      expect(await verifyStateSignature('test-el', state, `Infinity.${sigHex}`, testSecret, verifyOpts)).toBe(false);
    });

    it('enforces canonical JSON sorting determinism across key variations', () => {
      const obj1 = { z: 1, a: 2, m: { y: 3, x: 4 } };
      const obj2 = { m: { x: 4, y: 3 }, a: 2, z: 1 };

      expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
      expect(canonicalizeJson(obj1)).toBe('{"a":2,"m":{"x":4,"y":3},"z":1}');
    });

    it('detects and strips prototype pollution attempts in state objects', async () => {
      expect(hasPrototypePollution(JSON.parse('{"__proto__": {"polluted": true}}'))).toBe(true);
      expect(hasPrototypePollution(JSON.parse('{"constructor": {"prototype": {"admin": true}}}'))).toBe(true);
      expect(hasPrototypePollution(JSON.parse('{"prototype": {"injected": 1}}'))).toBe(true);
      expect(hasPrototypePollution(JSON.parse('{"nested": [{"__proto__": 1}]}'))).toBe(true);

      // Clean objects
      expect(hasPrototypePollution({ safe: true, items: [1, 2, 3] })).toBe(false);

      // createSignedStateSnapshot throws on prototype pollution
      await expect(createSignedStateSnapshot('polluted-el', JSON.parse('{"__proto__": true}'), testSecret)).rejects.toThrow(/Prototype pollution/);

      // verifyStateSnapshot rejects prototype pollution string or object
      const res = await verifyStateSnapshot('polluted-el', '{"__proto__": true}', '1234.abcd', testSecret, { token: 'test-token' });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('PROTOTYPE_POLLUTION_DETECTED');
    });
  });

  // =========================================================================
  // Section 2: Action Token and Endpoint Security Stress
  // =========================================================================
  describe('Action endpoint CSRF, token verification, and payload defense', () => {
    class MockCounterElement {
      static properties = { count: { type: Number, state: true } };
      static observedAttributes = ['count'];
      static __lit_actions = {
        '0123456789abcdef': {
          name: 'increment',
          writes: ['count'],
          validate: (args: unknown[]) => args,
        },
      };
      count = 0;
      increment() {
        this.count++;
      }
      render() {
        return { values: [this.count] };
      }
    }

    const registry = {
      get(tag: string) {
        return tag === 'mock-counter' ? MockCounterElement : undefined;
      },
    };

    it('rejects cross-origin requests when Origin does not match', async () => {
      const req = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          Origin: 'https://evil-attacker.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tag: 'mock-counter', args: [] }),
      });

      const res = await handleActionRequest(req, {
        env: {},
        secret: testSecret,
        registry,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('CSRF_BLOCKED');
    });

    it('allows cross-origin requests from explicitly allowed origins', async () => {
      const snapshot = await createSignedStateSnapshot('mock-counter', { count: 0 }, testSecret);
      const req = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          Origin: 'https://trusted-partner.com',
          'Content-Type': 'application/json',
          'X-Lit-Action-Token': snapshot.token,
        },
        body: JSON.stringify({
          tag: 'mock-counter',
          state: snapshot.state,
          sig: snapshot.sig,
          attrs: { 'data-lit-token': snapshot.token },
          args: [],
        }),
      });

      const res = await handleActionRequest(req, {
        env: {},
        secret: testSecret,
        registry,
        allowedOrigins: ['https://trusted-partner.com'],
      });

      expect(res.status).toBe(200);
    });

    it('rejects cross-site Sec-Fetch-Site requests', async () => {
      const req = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          'Sec-Fetch-Site': 'cross-site',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tag: 'mock-counter', args: [] }),
      });

      const res = await handleActionRequest(req, {
        env: {},
        secret: testSecret,
        registry,
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('CSRF_BLOCKED');
    });

    it('enforces action token verification when data-lit-token is present on element', async () => {
      const validToken = 'valid-csrf-token-123';
      const snapshot = await createSignedStateSnapshot('mock-counter', { count: 0 }, testSecret, {
        token: validToken,
      });

      // 1. Missing header when token is expected
      const reqNoHeader = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: 'mock-counter',
          state: snapshot.state,
          sig: snapshot.sig,
          attrs: { 'data-lit-token': validToken },
          args: [],
        }),
      });

      const res1 = await handleActionRequest(reqNoHeader, { env: {}, secret: testSecret, registry });
      expect(res1.status).toBe(403);
      const json1 = await res1.json();
      expect(json1.code).toBe('TOKEN_MISMATCH');

      // 2. Mismatched header token
      const reqMismatch = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lit-Action-Token': 'wrong-spoofed-token',
        },
        body: JSON.stringify({
          tag: 'mock-counter',
          state: snapshot.state,
          sig: snapshot.sig,
          attrs: { 'data-lit-token': validToken },
          args: [],
        }),
      });

      const res2 = await handleActionRequest(reqMismatch, { env: {}, secret: testSecret, registry });
      expect(res2.status).toBe(403);
      const json2 = await res2.json();
      expect(json2.code).toBe('TOKEN_MISMATCH');

      // 3. Matching header token -> proceeds
      const reqValid = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lit-Action-Token': validToken,
        },
        body: JSON.stringify({
          tag: 'mock-counter',
          state: snapshot.state,
          sig: snapshot.sig,
          attrs: { 'data-lit-token': validToken },
          args: [],
        }),
      });

      const res3 = await handleActionRequest(reqValid, { env: {}, secret: testSecret, registry });
      expect(res3.status).toBe(200);
    });

    it('rejects tampered state signatures in action requests with 403 STATE_TAMPERED', async () => {
      const state = { count: 5 };
      const snapshot = await createSignedStateSnapshot('mock-counter', state, testSecret);

      // Tamper state count: from 5 to 50
      const tamperedReq = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lit-Action-Token': snapshot.token,
        },
        body: JSON.stringify({
          tag: 'mock-counter',
          state: { count: 50 },
          sig: snapshot.sig,
          attrs: { 'data-lit-token': snapshot.token },
          args: [],
        }),
      });

      const res = await handleActionRequest(tamperedReq, { env: {}, secret: testSecret, registry });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('STATE_TAMPERED');
    });

    it('rejects prototype pollution payloads in action request body', async () => {
      const pollutedReq = new Request('http://localhost:5173/_lit/a/0123456789abcdef', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"tag":"mock-counter","args":[],"__proto__":{"polluted":true}}',
      });

      const res = await handleActionRequest(pollutedReq, { env: {}, secret: testSecret, registry });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('PROTOTYPE_POLLUTION');
    });
  });

  // =========================================================================
  // Section 3: DevServer Route Prefix Normalization and Hash Validation (Vite)
  // =========================================================================
  describe('Vite DevServer route prefix normalization and hash validation', () => {
    async function testViteMiddleware(actionRoutePrefix: string | undefined, requestUrl: string, method = 'POST') {
      const rawPlugin = viteServerElements({ actionRoutePrefix });
      const plugins = Array.isArray(rawPlugin) ? rawPlugin : [rawPlugin];
      const plugin = plugins.find((p: any) => p?.configureServer) ?? plugins[0];
      let middlewareFn: any = null;

      const mockServer = {
        middlewares: {
          use(fn: any) {
            middlewareFn = fn;
          },
        },
        config: {},
      };

      if (typeof plugin.configureServer === 'function') {
        (plugin.configureServer as any)(mockServer);
      } else if (plugin.configureServer && typeof (plugin.configureServer as any).handler === 'function') {
        (plugin.configureServer as any).handler(mockServer);
      }

      let status = 0;
      let responseData = '';
      const res = {
        setHeader() {},
        end(chunk?: any) {
          if (chunk) responseData += chunk;
        },
        set statusCode(val: number) {
          status = val;
        },
        get statusCode() {
          return status;
        },
      };

      const req = new EventEmitter() as any;
      req.method = method;
      req.url = requestUrl;
      req.headers = { host: 'localhost:5173' };

      let nextCalled = false;
      const promise = middlewareFn(req, res, () => {
        nextCalled = true;
      });

      req.emit('data', Buffer.from(JSON.stringify({ tag: 'unknown-tag', args: [] })));
      req.emit('end');
      await promise;

      return { status, responseData, nextCalled };
    }

    it('normalizes route prefixes with or without trailing slash in Vite', async () => {
      // 1. Prefix with trailing slash: /_lit/a/
      const res1 = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef');
      expect(res1.nextCalled).toBe(false);
      expect(res1.status).not.toBe(400); // Hash extracted successfully, not INVALID_HASH

      // 2. Prefix without trailing slash: /_lit/a
      const res2 = await testViteMiddleware('/_lit/a', '/_lit/a/0123456789abcdef');
      expect(res2.nextCalled).toBe(false);
      expect(res2.status).not.toBe(400);

      // 3. Custom prefix without trailing slash: /api/actions
      const res3 = await testViteMiddleware('/api/actions', '/api/actions/0123456789abcdef');
      expect(res3.nextCalled).toBe(false);
      expect(res3.status).not.toBe(400);
    });

    it('accepts exact 16-hex characters in uppercase or lowercase in Vite', async () => {
      const resLower = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef');
      expect(resLower.status).not.toBe(400);

      const resUpper = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789ABCDEF');
      expect(resUpper.status).not.toBe(400);
    });

    it('handles query parameters and trailing slashes gracefully in Vite', async () => {
      const resQuery = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef?foo=bar&mode=dev');
      expect(resQuery.status).not.toBe(400);

      const resSlash = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef/');
      expect(resSlash.status).not.toBe(400);
    });

    it('rejects invalid action hash formats in Vite with 400 INVALID_HASH', async () => {
      // 15 hex chars
      const r1 = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcde');
      expect(r1.status).toBe(400);
      expect(JSON.parse(r1.responseData).code).toBe('INVALID_HASH');

      // 17 hex chars
      const r2 = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef0');
      expect(r2.status).toBe(400);
      expect(JSON.parse(r2.responseData).code).toBe('INVALID_HASH');

      // Non-hex chars
      const r3 = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdeg');
      expect(r3.status).toBe(400);
      expect(JSON.parse(r3.responseData).code).toBe('INVALID_HASH');

      // Path traversal
      const r4 = await testViteMiddleware('/_lit/a/', '/_lit/a/../../etc/passwd');
      expect(r4.status).toBe(400);
      expect(JSON.parse(r4.responseData).code).toBe('INVALID_HASH');
    });

    it('ignores non-POST requests or non-matching paths in Vite', async () => {
      const resGet = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef', 'GET');
      expect(resGet.nextCalled).toBe(true);
      expect(resGet.status).toBe(0);

      const resPut = await testViteMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef', 'PUT');
      expect(resPut.nextCalled).toBe(true);

      const resOtherPath = await testViteMiddleware('/_lit/a/', '/api/items', 'POST');
      expect(resOtherPath.nextCalled).toBe(true);
    });
  });

  // =========================================================================
  // Section 4: DevServer Route Prefix Normalization and Hash Validation (Webpack)
  // =========================================================================
  describe('Webpack DevServer route prefix normalization and hash validation', () => {
    async function testWebpackMiddleware(actionRoutePrefix: string | undefined, requestUrl: string, method = 'POST') {
      const plugin = new LitWebpackPlugin({
        serverElements: { actionRoutePrefix },
      });

      const mockCompiler: any = {
        name: 'test-compiler',
        options: {
          target: 'web',
          entry: './src/index.js',
          module: { rules: [] },
          devServer: {},
        },
        getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
        hooks: {
          thisCompilation: { tap() {} },
          beforeCompile: { tapAsync() {} },
          compilation: { tap() {} },
          normalModuleFactory: { tap() {} },
          shutdown: { tap() {} },
        },
      };

      plugin.apply(mockCompiler);
      const setupMiddlewares = mockCompiler.options.devServer.setupMiddlewares;
      const middlewares = setupMiddlewares([], {});
      const actionMiddleware = middlewares.find((m: any) => m.name === 'lit-server-elements-action')?.middleware;

      let status = 0;
      let responseData = '';
      const res = {
        setHeader() {},
        end(chunk?: any) {
          if (chunk) responseData += chunk;
        },
        set statusCode(val: number) {
          status = val;
        },
        get statusCode() {
          return status;
        },
      };

      const req = new EventEmitter() as any;
      req.method = method;
      req.url = requestUrl;
      req.headers = { host: 'localhost:8080' };

      let nextCalled = false;
      const promise = actionMiddleware(req, res, () => {
        nextCalled = true;
      });

      req.emit('data', Buffer.from(JSON.stringify({ tag: 'unknown-tag', args: [] })));
      req.emit('end');
      await promise;

      return { status, responseData, nextCalled };
    }

    it('normalizes route prefixes with or without trailing slash in Webpack', async () => {
      // 1. Prefix with trailing slash: /_lit/a/
      const res1 = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef');
      expect(res1.nextCalled).toBe(false);
      expect(res1.status).not.toBe(400);

      // 2. Prefix without trailing slash: /_lit/a
      const res2 = await testWebpackMiddleware('/_lit/a', '/_lit/a/0123456789abcdef');
      expect(res2.nextCalled).toBe(false);
      expect(res2.status).not.toBe(400);

      // 3. Custom prefix without trailing slash: /edge/actions
      const res3 = await testWebpackMiddleware('/edge/actions', '/edge/actions/0123456789abcdef');
      expect(res3.nextCalled).toBe(false);
      expect(res3.status).not.toBe(400);
    });

    it('accepts exact 16-hex characters in uppercase or lowercase in Webpack', async () => {
      const resLower = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef');
      expect(resLower.status).not.toBe(400);

      const resUpper = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789ABCDEF');
      expect(resUpper.status).not.toBe(400);
    });

    it('handles query parameters and trailing slashes in Webpack DevServer', async () => {
      const resQuery = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef?env=dev');
      expect(resQuery.status).not.toBe(400);

      const resSlash = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef/');
      expect(resSlash.status).not.toBe(400);
    });

    it('rejects invalid action hash formats in Webpack with 400 INVALID_HASH', async () => {
      // 15 hex chars
      const r1 = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcde');
      expect(r1.status).toBe(400);
      expect(JSON.parse(r1.responseData).code).toBe('INVALID_HASH');

      // 17 hex chars
      const r2 = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef0');
      expect(r2.status).toBe(400);
      expect(JSON.parse(r2.responseData).code).toBe('INVALID_HASH');

      // Non-hex chars
      const r3 = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdeg');
      expect(r3.status).toBe(400);
      expect(JSON.parse(r3.responseData).code).toBe('INVALID_HASH');

      // Path traversal
      const r4 = await testWebpackMiddleware('/_lit/a/', '/_lit/a/../../secret');
      expect(r4.status).toBe(400);
      expect(JSON.parse(r4.responseData).code).toBe('INVALID_HASH');
    });

    it('ignores non-POST requests or non-matching paths in Webpack', async () => {
      const resGet = await testWebpackMiddleware('/_lit/a/', '/_lit/a/0123456789abcdef', 'GET');
      expect(resGet.nextCalled).toBe(true);

      const resOtherPath = await testWebpackMiddleware('/_lit/a/', '/static/bundle.js', 'POST');
      expect(resOtherPath.nextCalled).toBe(true);
    });
  });
});
