import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import litWebpackLoader, { registerPluginState, unregisterPluginState } from '../dist/loader.js';
import { injectExecutorToEntry, isSsrTarget, LitWebpackPlugin } from '../dist/plugin.js';

describe('@lit-core/webpack-plugin server elements integration', () => {
  const sampleServerElement = `
    import { LitElement, html } from 'lit';
    import { customElement } from 'lit/decorators.js';
    import { loader, action } from '@lit-core/server-elements';

    @customElement('inventory-card')
    export class InventoryCard extends LitElement {
      static properties = {
        sku: { type: String },
        qty: { type: Number },
      };

      @loader()
      async loadInventory(env: any) {
        this.qty = 100;
      }

      @action()
      async adjustStock(amount: number) {
        this.qty += amount;
      }

      render() {
        return html\`<span>Stock: \${this.qty}</span>\`;
      }
    }
  `;

  it('differentiates client vs worker targets in webpack loader', async () => {
    const pluginId = 'test-plugin-split-1';

    // 1. Client target test (target: 'web')
    registerPluginState(pluginId, {
      transformedFiles: new Map(),
      virtualSheets: new Map(),
      isSsr: false,
      options: {
        serverElements: true,
      },
    });

    let clientOutput = '';
    const mockClientContext = {
      resourcePath: '/src/components/inventory-card.ts',
      target: 'web',
      getOptions: () => ({ pluginId }),
      async: () => (err: any, code: string) => {
        if (err) throw err;
        clientOutput = code;
      },
      emitWarning: () => {},
      emitError: (err: any) => {
        throw err;
      },
    };

    litWebpackLoader.call(mockClientContext as any, sampleServerElement);
    unregisterPluginState(pluginId);

    expect(clientOutput).toContain('extends HTMLElement');
    expect(clientOutput).toContain('__litActionRpc');
    expect(clientOutput).not.toContain('@loader');
    expect(clientOutput).not.toContain('loadInventory');

    // 2. Server target test (target: 'node')
    const serverPluginId = 'test-plugin-split-2';
    registerPluginState(serverPluginId, {
      transformedFiles: new Map(),
      virtualSheets: new Map(),
      isSsr: true,
      options: {
        serverElements: true,
      },
    });

    let serverOutput = '';
    const mockServerContext = {
      resourcePath: '/src/components/inventory-card.ts',
      target: 'node',
      getOptions: () => ({ pluginId: serverPluginId }),
      async: () => (err: any, code: string) => {
        if (err) throw err;
        serverOutput = code;
      },
      emitWarning: () => {},
      emitError: (err: any) => {
        throw err;
      },
    };

    litWebpackLoader.call(mockServerContext as any, sampleServerElement);
    unregisterPluginState(serverPluginId);

    expect(serverOutput).toContain('__lit_actions');
    expect(serverOutput).toContain('__lit_loaders');
    expect(serverOutput).toContain('__lit_validate_adjustStock');
    expect(serverOutput).toContain('this.qty += amount');
  });

  it('reports compile-time isolation diagnostics when server imports leak to client', async () => {
    const leakyElement = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';
      import { action } from '@lit-core/server-elements';
      import { readFileSync } from 'node:fs';

      @customElement('leaky-box')
      export class LeakyBox extends LitElement {
        @action()
        async doAction() {}

        render() {
          const secret = readFileSync('secret.key');
          return html\`<div>\${secret}</div>\`;
        }
      }
    `;

    const pluginId = 'test-leaky-plugin';
    registerPluginState(pluginId, {
      transformedFiles: new Map(),
      virtualSheets: new Map(),
      isSsr: false,
      options: { serverElements: true },
    });

    let caughtError: any = null;
    const mockContext = {
      resourcePath: '/src/components/leaky-box.ts',
      target: 'web',
      getOptions: () => ({ pluginId }),
      async: () => (err: any) => {
        caughtError = err;
      },
      emitWarning: () => {},
      emitError: () => {},
    };

    litWebpackLoader.call(mockContext as any, leakyElement);
    unregisterPluginState(pluginId);

    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toMatch(/SE101/);
  });

  it('auto-injects executor module into Webpack entrypoints (Invariant 8)', () => {
    const EXECUTOR = '@lit-core/server-elements/executor';

    // 1. String entry
    expect(injectExecutorToEntry('./src/index.js', EXECUTOR)).toEqual([EXECUTOR, './src/index.js']);

    // 2. Array entry
    expect(injectExecutorToEntry(['./src/a.js', './src/b.js'], EXECUTOR)).toEqual([EXECUTOR, './src/a.js', './src/b.js']);

    // 3. Deduplication check
    expect(injectExecutorToEntry([EXECUTOR, './src/main.js'], EXECUTOR)).toEqual([EXECUTOR, './src/main.js']);

    // 4. Object multi-entry
    const multiEntry = {
      main: './src/main.js',
      admin: ['./src/admin.js'],
      vendor: { import: './src/vendor.js' },
    };
    const augmented = injectExecutorToEntry(multiEntry, EXECUTOR);
    expect(augmented.main).toEqual([EXECUTOR, './src/main.js']);
    expect(augmented.admin).toEqual([EXECUTOR, './src/admin.js']);
    expect(augmented.vendor).toEqual({ import: [EXECUTOR, './src/vendor.js'] });
  });

  it('registers DevServer middleware intercepting POST /_lit/a/*', async () => {
    const plugin = new LitWebpackPlugin({
      serverElements: { actionRoutePrefix: '/_lit/a/' },
    });

    const mockCompiler = {
      name: 'test-compiler',
      options: {
        target: 'web',
        entry: './src/index.js',
        module: { rules: [] },
        devServer: {},
      },
      getInfrastructureLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
      hooks: {
        beforeCompile: { tapAsync: () => {} },
        compilation: { tap: () => {} },
        thisCompilation: { tap: () => {} },
        normalModuleFactory: { tap: () => {} },
        shutdown: { tap: () => {} },
      },
    };

    plugin.apply(mockCompiler as any);

    const setupMiddlewares = (mockCompiler.options.devServer as any).setupMiddlewares;
    expect(typeof setupMiddlewares).toBe('function');

    const middlewares = setupMiddlewares([], {});
    expect(middlewares.length).toBe(1);
    expect(middlewares[0].name).toBe('lit-server-elements-action');

    const actionMiddleware = middlewares[0].middleware;

    // 1. Invalid action hash rejection
    const reqInvalid = new EventEmitter() as any;
    reqInvalid.method = 'POST';
    reqInvalid.url = '/_lit/a/invalid-hash-xyz';
    reqInvalid.headers = { host: 'localhost:8080' };

    let statusCode = 0;
    let responseData = '';
    const resInvalid = {
      setHeader: () => {},
      end: (data?: any) => {
        if (data) responseData += data;
      },
      set statusCode(val: number) {
        statusCode = val;
      },
      get statusCode() {
        return statusCode;
      },
    };

    let nextCalled = false;
    await actionMiddleware(reqInvalid, resInvalid, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
    const parsed = JSON.parse(responseData);
    expect(parsed.code).toBe('INVALID_HASH');

    // 2. Non-action route calls next()
    nextCalled = false;
    const reqOther = { method: 'GET', url: '/index.html' };
    await actionMiddleware(reqOther, resInvalid, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('emits lit-manifest.json asset in processAssets', async () => {
    const plugin = new LitWebpackPlugin({
      serverElements: true,
    });

    let processAssetsTap: any = null;
    const mockCompiler = {
      name: 'test-compiler',
      options: {
        target: 'node',
        entry: './src/index.js',
        module: { rules: [] },
      },
      webpack: {
        Compilation: {
          PROCESS_ASSETS_STAGE_ADDITIONS: 100,
        },
        sources: {
          RawSource: class {
            source: any;
            constructor(str: string) {
              this.source = () => str;
            }
          },
        },
      },
      getInfrastructureLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
      hooks: {
        thisCompilation: {
          tap: (name: string, fn: any) => {
            const compilationMock = {
              chunks: new Set([
                {
                  name: 'server-chunk.js',
                  files: new Set(['server-chunk.js']),
                },
              ]),
              chunkGraph: {
                getChunkModules: () => [{ resource: '/src/components/inventory-card.ts' }],
              },
              hooks: {
                processAssets: {
                  tapPromise: (opts: any, promiseFn: any) => {
                    if (opts.name.includes('lit-manifest')) {
                      processAssetsTap = promiseFn;
                    }
                  },
                },
              },
              emitAsset: (fileName: string, source: any) => {
                emittedAssets[fileName] = source.source();
              },
              getAsset: () => null,
            };
            fn(compilationMock);
          },
        },
        beforeCompile: { tapAsync: () => {} },
        compilation: { tap: () => {} },
        normalModuleFactory: { tap: () => {} },
        shutdown: { tap: () => {} },
      },
    };

    const emittedAssets: Record<string, string> = {};

    // Transform a server element first so plugin state registers it
    plugin.apply(mockCompiler as any);

    // Populate plugin state with an element
    const mockContext = {
      resourcePath: '/src/components/inventory-card.ts',
      target: 'node',
      getOptions: () => ({ pluginId: plugin.id }),
      async: () => () => {},
      emitWarning: () => {},
      emitError: () => {},
    };

    litWebpackLoader.call(mockContext as any, sampleServerElement);

    // Trigger processAssets
    expect(typeof processAssetsTap).toBe('function');
    await processAssetsTap();

    expect(emittedAssets['lit-manifest.json']).toBeDefined();
    const manifest = JSON.parse(emittedAssets['lit-manifest.json']);
    expect(manifest.version).toBe('1.0');
    expect(manifest.elements['inventory-card']).toBeDefined();
    expect(manifest.elements['inventory-card'].zeroLit).toBe(true);
    expect(manifest.elements['inventory-card'].serverChunk).toBe('server-chunk.js');

    expect(emittedAssets['.lit-core/server-manifest.json']).toBeDefined();
    const serverManifest = JSON.parse(emittedAssets['.lit-core/server-manifest.json']);
    expect(serverManifest.version).toBe('1.0');
    expect(serverManifest.elements['inventory-card']).toBeDefined();
    expect(serverManifest.elements['inventory-card'].zeroLit).toBe(true);
    expect(serverManifest.elements['inventory-card'].serverChunk).toBe('server-chunk.js');
  });

  it('resolves and loads virtual:lit-core/executor, manifest, and worker', async () => {
    const plugin = new LitWebpackPlugin({
      serverElements: true,
    });

    let readResourceHook: any = null;
    let resolveHook: any = null;

    const mockCompiler = {
      name: 'test-compiler',
      options: {
        target: 'web',
        entry: './src/index.js',
        module: { rules: [] },
      },
      webpack: {
        NormalModule: {
          getCompilationHooks: () => ({
            readResourceForScheme: {
              for: (scheme: string) => ({
                tapPromise: (name: string, fn: any) => {
                  if (scheme === 'virtual') readResourceHook = fn;
                },
              }),
            },
          }),
        },
      },
      getInfrastructureLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
      hooks: {
        thisCompilation: { tap: () => {} },
        beforeCompile: { tapAsync: () => {} },
        compilation: {
          tap: (name: string, fn: any) => {
            fn({});
          },
        },
        normalModuleFactory: {
          tap: (name: string, fn: any) => {
            fn({
              hooks: {
                resolve: {
                  tap: (n: string, rFn: any) => {
                    resolveHook = rFn;
                  },
                },
              },
            });
          },
        },
        shutdown: { tap: () => {} },
      },
    };

    plugin.apply(mockCompiler as any);

    // 1. Verify normalModuleFactory redirects virtual:lit-core/executor, manifest, and worker
    const resolveDataExecutor = { request: 'virtual:lit-core/executor' };
    resolveHook(resolveDataExecutor);
    expect(resolveDataExecutor.request).toContain('executor.js');

    const resolveDataManifest = { request: 'virtual:lit-core/manifest' };
    resolveHook(resolveDataManifest);
    expect(resolveDataManifest.request).toContain('manifest.js');

    const resolveDataWorker = { request: 'virtual:lit-core/worker' };
    resolveHook(resolveDataWorker);
    expect(resolveDataWorker.request).toContain('worker.js');

    // 2. Verify readResourceHook returns valid buffers for executor, manifest, and worker
    expect(typeof readResourceHook).toBe('function');

    const executorBuffer = await readResourceHook('virtual:lit-core/executor.js');
    expect(executorBuffer).toBeInstanceOf(Buffer);
    const executorCode = executorBuffer.toString('utf-8');
    expect(executorCode).toContain('@lit-core/server-elements/executor');

    const manifestBuffer = await readResourceHook('virtual:lit-core/manifest.js');
    expect(manifestBuffer).toBeInstanceOf(Buffer);
    const manifestCode = manifestBuffer.toString('utf-8');
    expect(manifestCode).toContain('export default');
    expect(manifestCode).toContain('"version":"1.0"');

    const workerBuffer = await readResourceHook('virtual:lit-core/worker.js');
    expect(workerBuffer).toBeInstanceOf(Buffer);
    const workerCode = workerBuffer.toString('utf-8');
    expect(workerCode).toContain('export const buildId');
    expect(workerCode).toContain('export const tagManifest');
    expect(workerCode).toContain('export async function handleAction');
    expect(workerCode).toContain('export default');
  });

  it('normalizes actionRoutePrefix without trailing slash in Webpack devServer middleware', async () => {
    const plugin = new LitWebpackPlugin({
      serverElements: {
        actionRoutePrefix: '/_lit/custom_action',
      },
    });

    const mockCompiler: any = {
      name: 'test-compiler',
      options: {
        target: 'web',
        entry: './src/index.js',
        module: { rules: [] },
        devServer: {},
      },
      getInfrastructureLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
      hooks: {
        thisCompilation: { tap: () => {} },
        beforeCompile: { tapAsync: () => {} },
        compilation: { tap: () => {} },
        normalModuleFactory: { tap: () => {} },
        shutdown: { tap: () => {} },
      },
    };

    plugin.apply(mockCompiler);

    const setupMiddlewares = mockCompiler.options.devServer.setupMiddlewares;
    expect(typeof setupMiddlewares).toBe('function');

    const middlewares = setupMiddlewares([], {});
    const actionMiddleware = middlewares.find((m: any) => m.name === 'lit-server-elements-action')?.middleware;
    expect(typeof actionMiddleware).toBe('function');

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
    reqValid.headers = { host: 'localhost:8080' };

    let nextCalled = false;
    const promise = actionMiddleware(reqValid, res, () => {
      nextCalled = true;
    });

    reqValid.emit('data', Buffer.from(JSON.stringify({ tag: 'unknown-tag', args: [] })));
    reqValid.emit('end');
    await promise;

    // Should NOT fail with 400 INVALID_HASH because hash was properly extracted
    expect(status).not.toBe(400);
  });
});
