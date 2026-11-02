import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { litServerElements, serverElements } from '../dist/index.js';

describe('@lit-core/vite-plugin server elements integration', () => {
  const sampleServerElement = `
    import { LitElement, html } from 'lit';
    import { customElement } from 'lit/decorators.js';
    import { loader, action } from '@lit-core/server-elements';

    @customElement('stock-counter')
    export class StockCounter extends LitElement {
      static properties = {
        sku: { type: String },
        stock: { type: Number },
      };

      @loader()
      async loadStock(env: any) {
        this.stock = 42;
      }

      @action()
      async reserve(quantity: number) {
        this.stock -= quantity;
      }

      render() {
        return html\`<div>Stock: \${this.stock}</div>\`;
      }
    }
  `;

  it('differentiates client vs worker targets via isSsr flag', () => {
    const plugin = serverElements({ target: 'auto' })[0];

    // Client transform (ssr: false)
    const clientResult = plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: false }) as { code: string };

    expect(clientResult).not.toBeNull();
    expect(clientResult.code).toContain('extends HTMLElement');
    expect(clientResult.code).toContain('__litActionRpc');
    expect(clientResult.code).not.toContain('@loader');
    expect(clientResult.code).not.toContain('loadStock');

    // Worker transform (ssr: true)
    const workerResult = plugin.transform!.call({ environment: { name: 'worker' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: true }) as { code: string };

    expect(workerResult).not.toBeNull();
    expect(workerResult.code).toContain('__lit_actions');
    expect(workerResult.code).toContain('__lit_loaders');
    expect(workerResult.code).toContain('__lit_validate_reserve');
    expect(workerResult.code).toContain('this.stock -= quantity');
  });

  it('respects query parameter overrides (?lit-client and ?lit-worker)', () => {
    const plugin = serverElements()[0];

    // In SSR mode, but ?lit-client query parameter provided -> yields client stub
    const clientOverride = plugin.transform!.call({ environment: { name: 'ssr' } } as any, sampleServerElement, '/src/components/stock-counter.ts?lit-client', { ssr: true }) as { code: string };

    expect(clientOverride).not.toBeNull();
    expect(clientOverride.code).toContain('extends HTMLElement');
    expect(clientOverride.code).toContain('__litActionRpc');

    // In client mode, but ?lit-worker query parameter provided -> yields worker code
    const workerOverride = plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts?lit-worker', { ssr: false }) as { code: string };

    expect(workerOverride).not.toBeNull();
    expect(workerOverride.code).toContain('__lit_actions');
  });

  it('reports compile-time isolation diagnostics when server imports leak to client', () => {
    const leakyComponent = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';
      import { action } from '@lit-core/server-elements';
      import { readFileSync } from 'node:fs';

      @customElement('leaky-element')
      export class LeakyElement extends LitElement {
        @action()
        async doSomething() {}

        render() {
          const data = readFileSync('secret.txt');
          return html\`<div>\${data}</div>\`;
        }
      }
    `;

    const plugin = serverElements()[0];
    let errorCaught: any = null;
    const mockContext = {
      error(payload: any) {
        errorCaught = payload;
        throw new Error(payload.message);
      },
    };

    expect(() => {
      plugin.transform!.call(mockContext as any, leakyComponent, '/src/components/leaky-element.ts', { ssr: false });
    }).toThrow();

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.message).toMatch(/SE101/);
  });

  it('auto-injects executor script tag into HTML (Invariant 8)', () => {
    const plugin = serverElements()[0];

    // First transform a server element to register its presence
    plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: false });

    const inputHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page</title>
        </head>
        <body>
          <stock-counter></stock-counter>
        </body>
      </html>
    `;

    const transformedHtml = plugin.transformIndexHtml!.call({} as any, inputHtml) as string;
    expect(transformedHtml).toContain('/@id/__x00__virtual:lit-core/executor.js');
    expect(transformedHtml).toContain('</head>');
  });

  it('resolves and loads virtual:lit-core/executor and virtual:lit-core/manifest', () => {
    const plugin = serverElements()[0];

    // Register an element
    plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: false });

    // Resolve executor
    const resolvedExecutor = plugin.resolveId!.call({} as any, 'virtual:lit-core/executor', undefined, {} as any);
    expect(resolvedExecutor).toBe('\0virtual:lit-core/executor.js');

    const executorSource = plugin.load!.call({} as any, '\0virtual:lit-core/executor.js');
    expect(executorSource).toContain("export * from '@lit-core/server-elements/executor';");

    // Resolve manifest
    const resolvedManifest = plugin.resolveId!.call({} as any, 'virtual:lit-core/manifest', undefined, {} as any);
    expect(resolvedManifest).toBe('\0virtual:lit-core/manifest.js');

    const manifestSource = plugin.load!.call({} as any, '\0virtual:lit-core/manifest.js') as string;
    expect(manifestSource).toContain('export default');
    expect(manifestSource).toContain('stock-counter');
  });

  it('emits lit-manifest.json build asset in generateBundle', () => {
    const plugin = serverElements()[0];

    plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: false });

    const emittedFiles: any[] = [];
    const mockContext = {
      emitFile(file: any) {
        emittedFiles.push(file);
      },
    };

    const generateBundleFn = typeof plugin.generateBundle === 'function' ? plugin.generateBundle : plugin.generateBundle!.handler;
    generateBundleFn.call(mockContext as any, {} as any, {
      'stock-counter.js': {
        modules: {
          '/src/components/stock-counter.ts': {},
        },
      },
    });

    const emittedFile = emittedFiles.find((f: any) => f.fileName === 'lit-manifest.json');
    expect(emittedFile).toBeDefined();
    expect(emittedFile.fileName).toBe('lit-manifest.json');
    const parsed = JSON.parse(emittedFile.source);
    expect(parsed.elements['stock-counter']).toBeDefined();
    expect(parsed.elements['stock-counter'].zeroLit).toBe(true);
  });

  it('handles action routing and rejects invalid hash in dev server middleware', async () => {
    const plugin = serverElements({ actionRoutePrefix: '/_lit/a/' })[0];
    let middlewareFn: any = null;

    const mockServer = {
      middlewares: {
        use(fn: any) {
          middlewareFn = fn;
        },
      },
      config: {},
    };

    plugin.configureServer!.call({} as any, mockServer as any);
    expect(typeof middlewareFn).toBe('function');

    // 1. Invalid action hash format
    const reqInvalid = new EventEmitter() as any;
    reqInvalid.method = 'POST';
    reqInvalid.url = '/_lit/a/invalid-hash-xyz';
    reqInvalid.headers = { host: 'localhost:5173' };

    let status = 0;
    let responseData = '';
    const resInvalid = {
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

    let nextCalled = false;
    await middlewareFn(reqInvalid, resInvalid, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(status).toBe(400);
    const parsed = JSON.parse(responseData);
    expect(parsed.code).toBe('INVALID_HASH');

    // 2. Non-action route calls next()
    nextCalled = false;
    const reqOther = { method: 'GET', url: '/index.html' };
    await middlewareFn(reqOther, resInvalid, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('supports hybrid client elements retaining LitElement when client decorators exist', () => {
    const hybridComponent = `
      import { LitElement, html } from 'lit';
      import { customElement, property, state } from 'lit/decorators.js';
      import { loader, action } from '@lit-core/server-elements';

      @customElement('hybrid-counter')
      export class HybridCounter extends LitElement {
        @property({ type: String }) sku = '';
        @state() clientCount = 0;

        @action()
        async reserve(qty: number) {}

        firstUpdated() {
          console.log('client hook');
        }

        render() {
          return html\`<div>\${this.clientCount}</div>\`;
        }
      }
    `;

    const plugin = serverElements({ target: 'client' })[0];
    const result = plugin.transform!.call({ environment: { name: 'client' } } as any, hybridComponent, '/src/components/hybrid-counter.ts', { ssr: false }) as { code: string };

    expect(result).not.toBeNull();
    expect(result.code).toContain('extends LitElement');
    expect(result.code).toContain('__litActionRpc');
    expect(result.code).toContain('firstUpdated');
  });

  it('normalizes actionRoutePrefix without trailing slash in DevServer middleware', async () => {
    const plugin = serverElements({ actionRoutePrefix: '/_lit/custom_action' })[0];
    let middlewareFn: any = null;
    const mockServer = {
      middlewares: {
        use(fn: any) {
          middlewareFn = fn;
        },
      },
    };

    plugin.configureServer!(mockServer as any);
    expect(typeof middlewareFn).toBe('function');

    // Test with valid 16-hex hash on prefix without trailing slash
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

    const reqValid = new EventEmitter() as any;
    reqValid.method = 'POST';
    reqValid.url = '/_lit/custom_action/0123456789abcdef';
    reqValid.headers = { host: 'localhost:5173' };

    let nextCalled = false;
    const promise = middlewareFn(reqValid, res, () => {
      nextCalled = true;
    });

    reqValid.emit('data', Buffer.from(JSON.stringify({ tag: 'unknown-tag', args: [] })));
    reqValid.emit('end');
    await promise;

    // Should NOT fail with 400 INVALID_HASH because hash was properly extracted
    expect(status).not.toBe(400);
  });

  it('injects executor script case-insensitively with uppercase HEAD tag', () => {
    const plugin = serverElements({ autoInjectExecutor: true })[0];
    // Transform a component first to set hasServerElements = true
    plugin.transform!.call({ environment: { name: 'client' } } as any, sampleServerElement, '/src/components/stock-counter.ts', { ssr: false });

    const htmlWithUpperHead = '<!DOCTYPE html><html><HEAD><title>Test</title></HEAD><body></body></html>';
    const transformed = (plugin.transformIndexHtml as any).call(null, htmlWithUpperHead);

    expect(transformed).toContain('virtual:lit-core/executor.js');
    expect(transformed).toContain('</head>');
  });
});
