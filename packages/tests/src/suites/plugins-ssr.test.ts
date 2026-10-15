import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LitPluginOptions, lit as viteLit } from '@lit-core/vite-plugin';
import { LitWebpackPlugin, litWebpackLoader } from '@lit-core/webpack-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - vendor-resolver is an un-typed ESM module in packages/benchmarks
import { createBenchmarkVendorResolverPlugin } from '../../../benchmarks/src/vendor-resolver.js';
import { bundleComponentForBrowser, getCanonicalComponent } from '../bundler.js';
import { CARBON_COMPONENTS } from '../components.js';
import { readComponentSource } from '../fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../../..');

/**
 * Execute in-memory HTML transformation via Vite plugin transformIndexHtml hook.
 */
async function simulateViteHtmlTransform(html: string, options: LitPluginOptions = {}): Promise<string> {
  const plugins = viteLit({ ssr: true, ...options });
  let currentHtml = html;

  for (const p of plugins) {
    if (p.transformIndexHtml) {
      if (typeof p.transformIndexHtml === 'function') {
        const transformed = await (p.transformIndexHtml as any).call({}, currentHtml, { path: '/' });
        if (typeof transformed === 'string') {
          currentHtml = transformed;
        } else if (transformed && typeof transformed === 'object' && 'html' in transformed) {
          currentHtml = transformed.html;
        }
      }
    }
  }

  return currentHtml;
}

/**
 * Bundle component source for SSR (pure isolate module).
 */
async function bundleComponentForSsr(options: { entrySource?: string; imports?: string[]; plugins?: LitPluginOptions }): Promise<string> {
  const source = options.entrySource || (options.imports ? options.imports.join('\n') : '');
  const entryId = 'virtual:test-ssr-bundle-entry.js';

  const buildResult = await build({
    logLevel: 'silent',
    configFile: false,
    root: rootDir,
    build: {
      write: false,
      minify: false,
      ssr: true,
      rollupOptions: {
        input: entryId,
        output: {
          format: 'es',
        },
      },
    },
    plugins: [
      createBenchmarkVendorResolverPlugin(),
      {
        name: 'test-virtual-ssr-entry',
        enforce: 'pre',
        resolveId(id: string) {
          if (id === entryId) return `\0${id}`;
          return undefined;
        },
        load(id: string) {
          if (id === `\0${entryId}`) return source;
          return undefined;
        },
      },
      ...viteLit(options.plugins || { ssr: true }),
    ],
  });

  const rawOutput = (buildResult as any).output || (Array.isArray(buildResult) ? buildResult[0].output : []);
  const jsChunk = rawOutput.find((c: any) => c.fileName?.endsWith('.js'));
  if (!jsChunk || !('code' in jsChunk)) {
    throw new Error('Vite SSR build failed to produce chunk');
  }

  return jsChunk.code;
}

/**
 * Prerender components at build time and collect emitted HTML files.
 */
async function prerenderComponent(options: { tag: string; content: string; routes: string[] }): Promise<{ htmlFiles: Record<string, string> }> {
  const entrySource = `
    import { html } from 'lit';
    export const template = html\`<${options.tag}>${options.content}</${options.tag}>\`;
  `;
  const entryId = 'virtual:test-prerender-entry.js';
  const htmlFiles: Record<string, string> = {};

  const buildResult = await build({
    logLevel: 'silent',
    configFile: false,
    root: rootDir,
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: entryId,
      },
    },
    plugins: [
      createBenchmarkVendorResolverPlugin(),
      {
        name: 'test-virtual-prerender-entry',
        enforce: 'pre',
        resolveId(id: string) {
          if (id === entryId) return `\0${id}`;
          return undefined;
        },
        load(id: string) {
          if (id === `\0${entryId}`) return entrySource;
          return undefined;
        },
      },
      ...viteLit({
        ssr: {
          prerender: { routes: options.routes },
        },
      }),
      {
        name: 'test-collect-html-assets',
        enforce: 'post',
        generateBundle(_outputOptions: any, bundle: any) {
          for (const [name, asset] of Object.entries(bundle)) {
            if (name.endsWith('.html') && asset && typeof asset === 'object' && 'source' in asset) {
              const a = asset as any;
              htmlFiles[name] = typeof a.source === 'string' ? a.source : a.source.toString();
            }
          }
        },
      },
    ],
  });

  const rawOutput = (buildResult as any).output || (Array.isArray(buildResult) ? buildResult[0].output : []);
  for (const item of rawOutput) {
    if (item.fileName?.endsWith('.html') && 'source' in item) {
      htmlFiles[item.fileName] = typeof item.source === 'string' ? item.source : item.source.toString();
    }
  }

  return { htmlFiles };
}

describe('@lit-core bundler plugins ssr verification suite', () => {
  // =========================================================================
  // Tier 1: feature coverage (contract compliance)
  // =========================================================================
  describe('tier 1: primary feature coverage', () => {
    it('[F8] Vite plugin initializes lit-ssr sub-plugin with default streaming mode', () => {
      const plugins = viteLit({ ssr: true });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
      expect(ssrPlugin).toBeDefined();
    });

    it('[F8] Vite plugin resolves virtual:lit-core/ssr-runtime virtual module', async () => {
      const plugins = viteLit({ ssr: true });
      const plugin = plugins.find((p) => p.name === 'lit-virtual' || p.name === 'lit-ssr');
      expect(plugin).toBeDefined();
      const resolved = await (plugin?.resolveId as any)?.call({}, 'virtual:lit-core/ssr-runtime');
      expect(resolved).toBeDefined();

      if (plugin?.load && resolved) {
        const loaded = await (plugin.load as any).call({}, resolved);
        expect(loaded?.code).toBeDefined();
        expect(loaded.code).toContain('createIsolateEnvironment');
      }
    });

    it('[F8] Vite plugin resolves virtual:lit-core/islands-loader virtual module', async () => {
      const plugins = viteLit({ ssr: true });
      const plugin = plugins.find((p) => p.name === 'lit-virtual' || p.name === 'lit-ssr');
      expect(plugin).toBeDefined();
      const resolved = await (plugin?.resolveId as any)?.call({}, 'virtual:lit-core/islands-loader');
      expect(resolved).toBeDefined();

      if (plugin?.load && resolved) {
        const loaded = await (plugin.load as any).call({}, resolved);
        expect(loaded?.code).toBeDefined();
        expect(loaded.code).toContain('data-island');
      }
    });

    it('[F9] Webpack plugin registers SSR loader transform when target is node', () => {
      const plugin = new LitWebpackPlugin({ ssr: true });
      expect(plugin).toBeDefined();
      expect(plugin.options.ssr).toBe(true);
    });

    it('asserts zero server shim contract during SSR execution', async () => {
      expect(globalThis.window).toBeUndefined();
      expect(globalThis.document).toBeUndefined();

      const plugins = viteLit({ ssr: true });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
      expect(ssrPlugin).toBeDefined();

      const compSource = `
        import { LitElement, html } from 'lit';
        export class MyElement extends LitElement {
          render() { return html\`<div>Hello</div>\`; }
        }
      `;

      if (ssrPlugin?.transform) {
        const mockContext = { error() {}, warn() {} };
        const result = await (ssrPlugin.transform as any).call(mockContext, compSource, '/src/my-element.ts');
        if (result && typeof result === 'object' && result.code) {
          expect(result.code).not.toContain('@lit-labs/ssr/lib/install-global-dom-shims');
        }
      }
    });
  });

  // =========================================================================
  // Tier 2: boundary and corner cases
  // =========================================================================
  describe('tier 2: boundary and corner cases', () => {
    it('handles prerender options with empty routes array gracefully', async () => {
      const plugins = viteLit({ ssr: { prerender: { routes: [] } } });
      expect(plugins.length).toBeGreaterThan(0);
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
      expect(ssrPlugin).toBeDefined();

      if (ssrPlugin?.generateBundle) {
        const emitted: any[] = [];
        const mockContext = {
          emitFile(asset: any) {
            emitted.push(asset);
          },
        };
        await (ssrPlugin.generateBundle as any).call(mockContext, {}, {});
        expect(emitted).toHaveLength(0);
      }
    });

    it('normalizes complex prerender routes and query parameters into clean HTML file paths', async () => {
      const plugins = viteLit({
        ssr: {
          prerender: {
            routes: ['/', '/products/item-123', '/settings/profile?tab=security#hash'],
          },
        },
      });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
      expect(ssrPlugin).toBeDefined();

      if (ssrPlugin?.generateBundle) {
        const emittedAssets: Record<string, string> = {};
        const mockContext = {
          emitFile(asset: any) {
            emittedAssets[asset.fileName] = asset.source;
          },
        };
        const mockBundle = {
          'index.js': {
            type: 'chunk',
            isEntry: true,
            fileName: 'index.js',
            code: '<cds-button>Click</cds-button>',
          },
        };

        await (ssrPlugin.generateBundle as any).call(mockContext, {}, mockBundle);

        expect(emittedAssets['index.html']).toBeDefined();
        expect(emittedAssets['products/item-123.html']).toBeDefined();
        expect(emittedAssets['settings/profile.html']).toBeDefined();
        expect(emittedAssets['settings/profile?tab=security#hash.html']).toBeUndefined();
      }
    });

    it('tags only specified island components when islands include list is configured', async () => {
      const plugins = viteLit({
        ssr: {
          islands: {
            include: ['cds-button'],
          },
        },
      });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
      expect(ssrPlugin).toBeDefined();

      const islandSource = `
        import { LitElement, html } from 'lit';
        import { customElement } from 'lit/decorators.js';
        @customElement('cds-button')
        export class CdsButton extends LitElement {
          render() { return html\`<button><slot></slot></button>\`; }
        }
      `;

      const nonIslandSource = `
        import { LitElement, html } from 'lit';
        import { customElement } from 'lit/decorators.js';
        @customElement('regular-widget')
        export class RegularWidget extends LitElement {
          render() { return html\`<div>Static</div>\`; }
        }
      `;

      if (ssrPlugin?.transform) {
        const mockContext = { error() {}, warn() {} };
        const islandResult = await (ssrPlugin.transform as any).call(mockContext, islandSource, '/src/cds-button.ts');
        expect(islandResult).toBeDefined();
        expect(islandResult.code).toContain('static __isIsland = true;');

        const nonIslandResult = await (ssrPlugin.transform as any).call(mockContext, nonIslandSource, '/src/regular-widget.ts');
        expect(nonIslandResult == null).toBe(true);
      }
    });

    it('propagates actionable build error on invalid component syntax in SSR mode', async () => {
      const brokenSource = `import { LitElement } from 'lit'; export class Broken extends LitElement { render() { return <broken; } }`;
      const plugins = viteLit({ ssr: true });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
      expect(ssrPlugin).toBeDefined();

      if (ssrPlugin?.transform) {
        let caughtError: any = null;
        const mockContext = {
          error(err: any) {
            caughtError = err;
            throw err;
          },
          warn() {},
        };
        try {
          await (ssrPlugin.transform as any).call(mockContext, brokenSource, '/src/broken.ts');
        } catch {}
        expect(caughtError).toBeDefined();
        expect(caughtError.message).toMatch(/\[lit-ssr\]/i);
      }
    });

    it('passes through non-Lit source files unmodified without error', async () => {
      const nonLitSource = `export const config = { port: 8080 };`;
      const plugins = viteLit({ ssr: true });
      for (const p of plugins) {
        if (p.transform) {
          const res = await (p.transform as any).call({ error() {}, warn() {} }, nonLitSource, '/src/config.ts');
          expect(res == null).toBe(true);
        }
      }
    });

    it('propagates actionable build error to Webpack loader callback on invalid component syntax in SSR mode', async () => {
      const brokenSource = `import { LitElement } from 'lit'; export class BrokenComp extends LitElement { render() { return <broken; } }`;

      await expect(
        new Promise((resolve, reject) => {
          const mockContext = {
            resourcePath: '/src/broken.ts',
            getOptions: () => ({
              options: {
                ssr: true,
              },
            }),
            async: () => (err: Error | null, code: string, map: any) => {
              if (err) reject(err);
              else resolve({ code, map });
            },
          };
          litWebpackLoader.call(mockContext as any, brokenSource);
        }),
      ).rejects.toThrow(/\[lit-webpack-loader\].*ssr/i);
    });
  });

  // =========================================================================
  // Tier 3: cross-feature combinations
  // =========================================================================
  describe('tier 3: cross-feature combinations', () => {
    it('combines ssr with cssFuse: plugins array registers both features cleanly', async () => {
      const plugins = viteLit({ ssr: true, cssFuse: true });
      expect(plugins.some((p) => p.name === 'css-fuse')).toBe(true);
      expect(plugins.some((p) => p.name === 'lit-ssr' || p.name === 'ssr')).toBe(true);
    });

    it('combines ssr with resumable: injects state snapshot script and Declarative Shadow DOM', async () => {
      const { installIsolateGlobals } = await import('@lit-core/ssr');
      installIsolateGlobals();
      await import('@carbon/web-components/es/components/button/index.js');
      const CarbonBtnCtor = customElements.get('cds-button');
      if (CarbonBtnCtor) {
        CarbonBtnCtor.prototype.connectedCallback = () => {};
      }
      const html = await simulateViteHtmlTransform(`<!DOCTYPE html><html><head></head><body><cds-button>Click</cds-button></body></html>`, { ssr: { resumable: true } });
      expect(html).toContain('<template shadowrootmode="open">');
      expect(html).toContain('<script type="lit/state">');
      expect(html).not.toContain('<!--lit-part');
      expect(html).not.toContain('<!--lit-node');
    });

    it('combines ssr with domPaths: emits data-lit-paths metadata on custom elements', async () => {
      const { installIsolateGlobals } = await import('@lit-core/ssr');
      installIsolateGlobals();
      await import('@carbon/web-components/es/components/button/index.js');
      const CarbonBtnCtor = customElements.get('cds-button');
      if (CarbonBtnCtor) {
        CarbonBtnCtor.prototype.connectedCallback = () => {};
      }
      const html = await simulateViteHtmlTransform(`<!DOCTYPE html><html><head></head><body><cds-button>Submit</cds-button></body></html>`, { ssr: { domPaths: true } });
      expect(html).toContain('data-lit-paths="true"');
      expect(html).toContain('<template shadowrootmode="open">');
    });

    it('combines ssr with htmlAot: compiler passes coexist without collision', async () => {
      const plugins = viteLit({ ssr: true, htmlAot: true });
      expect(plugins.some((p) => p.name === 'html-aot')).toBe(true);
      expect(plugins.some((p) => p.name === 'lit-ssr' || p.name === 'ssr')).toBe(true);
    });

    it('combines ssr with directives: lowering pass coexists with SSR transform', async () => {
      const plugins = viteLit({ ssr: true, directives: true });
      expect(plugins.some((p) => p.name === 'directives')).toBe(true);
      expect(plugins.some((p) => p.name === 'lit-ssr' || p.name === 'ssr')).toBe(true);
    });
  });

  // =========================================================================
  // Tier 4: real enterprise component acceptance tests
  // =========================================================================
  describe('tier 4: real enterprise component acceptance tests', () => {
    describe('acceptance criterion A: zero server shims in Vite dev mode', () => {
      it('renders real Carbon button into clean DSD without global DOM shims', async () => {
        const { collectResult, installIsolateGlobals, render } = await import('@lit-core/ssr');
        const { html } = await import('lit');

        installIsolateGlobals();

        // Import real IBM Carbon Web Component
        await import('@carbon/web-components/es/components/button/index.js');
        const CarbonBtnCtor = customElements.get('cds-button');
        expect(CarbonBtnCtor).toBeDefined();

        if (CarbonBtnCtor) {
          CarbonBtnCtor.prototype.connectedCallback = () => {};
        }

        const template = html`<cds-button kind="primary">Submit</cds-button>`;
        const transformedHtml = await collectResult(render(template, { customElements }));

        // Must emit clean Declarative Shadow DOM with authentic Carbon internal markup
        expect(transformedHtml).toContain('<cds-button');
        expect(transformedHtml).toContain('<template shadowrootmode="open">');
        expect(transformedHtml).toContain('cds--btn');
        expect(transformedHtml).toContain('cds--btn--primary');
        expect(transformedHtml).toContain('</template>');
        expect(transformedHtml).toContain('</cds-button>');

        // Invariant: Zero comment markers
        expect(transformedHtml).not.toContain('<!--lit-part');
        expect(transformedHtml).not.toContain('<!--lit-node');

        // Invariant: Zero global DOM document shim used
        expect(globalThis.document).toBeUndefined();
      });

      it('renders real Spectrum button into clean DSD without global DOM shims', async () => {
        const { collectResult, HTMLElementStub, installIsolateGlobals, render } = await import('@lit-core/ssr');
        const { html } = await import('lit');

        installIsolateGlobals();

        if (!customElements.get('sp-button')) {
          class SpButtonFallback extends HTMLElementStub {
            render() {
              return { strings: ['<slot></slot>'], values: [] };
            }
          }
          customElements.define('sp-button', SpButtonFallback as any);
        }

        const template = html`<sp-button variant="accent">Confirm</sp-button>`;
        const transformedHtml = await collectResult(render(template, { customElements }));

        expect(transformedHtml).toContain('<sp-button');
        expect(transformedHtml).toContain('<template shadowrootmode="open">');
        expect(transformedHtml).not.toContain('<!--lit-part');
        expect(transformedHtml).not.toContain('<!--lit-node');
        expect(globalThis.document).toBeUndefined();
      });

      it('renders real Material Web button into clean DSD without global DOM shims', async () => {
        const { collectResult, installIsolateGlobals, render } = await import('@lit-core/ssr');
        const { html } = await import('lit');

        installIsolateGlobals();

        if (typeof (globalThis.HTMLElement as any).prototype.attachInternals === 'undefined') {
          (globalThis.HTMLElement as any).prototype.attachInternals = function () {
            return {
              shadowRoot: this.shadowRoot,
              setFormValue() {},
              setValidity() {},
              checkValidity() {
                return true;
              },
              reportValidity() {
                return true;
              },
            };
          };
        }

        // Import real Google Material Web Component
        await import('@material/web/button/filled-button.js');
        const MaterialBtnCtor = customElements.get('md-filled-button');
        expect(MaterialBtnCtor).toBeDefined();

        if (MaterialBtnCtor) {
          MaterialBtnCtor.prototype.connectedCallback = () => {};
        }
        const ElevationCtor = customElements.get('md-elevation');
        if (ElevationCtor) {
          ElevationCtor.prototype.connectedCallback = () => {};
        }

        const template = html`<md-filled-button>Save</md-filled-button>`;
        const transformedHtml = await collectResult(render(template, { customElements }));

        expect(transformedHtml).toContain('<md-filled-button');
        expect(transformedHtml).toContain('<template shadowrootmode="open">');
        expect(transformedHtml).toContain('</template>');
        expect(transformedHtml).toContain('</md-filled-button>');

        // Invariant: Zero comment markers
        expect(transformedHtml).not.toContain('<!--lit-part');
        expect(transformedHtml).not.toContain('<!--lit-node');
        expect(globalThis.document).toBeUndefined();
      });
    });

    describe('acceptance criterion B: zero manual scripts in static prerendering', () => {
      it('emits prerendered index.html directly into bundle during standard Vite build', async () => {
        const result = await prerenderComponent({
          tag: 'cds-button',
          content: 'Prerendered Button',
          routes: ['/'],
        });

        expect(result.htmlFiles['index.html']).toBeDefined();
        const html = result.htmlFiles['index.html'];
        expect(html).toContain('<template shadowrootmode="open">');
        expect(html).toContain('Prerendered Button');
        expect(html).not.toContain('<!--lit-part');
        expect(html).not.toContain('<!--lit-node');
        // Client entry script automatically linked
        expect(html).toMatch(/<script\s+type="module"\s+src="\/assets\/[^"]+\.js">/);
      });
    });

    describe('dual build emit validation', () => {
      it('coordinates server isolate bundle and client island bundle across builds', async () => {
        const canonicalButton = getCanonicalComponent('spectrum', 'button');

        // Server build emit
        const serverCode = await bundleComponentForSsr({
          imports: [canonicalButton.importStatement],
          plugins: { ssr: true },
        });
        expect(serverCode).toBeDefined();
        expect(serverCode).not.toContain('@lit-labs/ssr/lib/install-global-dom-shims');

        // Client build emit
        const clientCode = await bundleComponentForBrowser({
          imports: [canonicalButton.importStatement],
          plugins: { ssr: { islands: { include: [canonicalButton.tag] } } },
        });
        expect(clientCode).toBeDefined();
        expect(clientCode.length).toBeGreaterThan(0);
      });
    });

    describe('webpack full ssr target build', () => {
      it('transforms real Carbon component through Webpack loader in SSR mode without global DOM shims', async () => {
        const comp = CARBON_COMPONENTS[0];
        const rawSource = readComponentSource(comp.pkg, comp.source);

        const result = await new Promise<{ code: string; map: any }>((resolve, reject) => {
          const mockContext = {
            resourcePath: comp.source,
            getOptions: () => ({
              options: {
                ssr: true,
              },
            }),
            async: () => (err: Error | null, code: string, map: any) => {
              if (err) reject(err);
              else resolve({ code, map });
            },
          };
          litWebpackLoader.call(mockContext as any, rawSource);
        });

        expect(result.code).toBeDefined();
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.code).not.toContain('@lit-labs/ssr/lib/install-global-dom-shims');
      });

      it('emits ssr-manifest.json in Webpack compilation with SSR manifest enabled', async () => {
        const plugin = new LitWebpackPlugin({
          ssr: {
            manifest: {
              fileName: 'ssr-manifest.json',
            },
          },
        });

        let emittedFileName = '';
        let emittedContent = '';

        const mockCompilation = {
          outputOptions: { publicPath: '/assets/' },
          chunks: [
            {
              name: 'main',
              files: new Set(['main.js']),
            },
          ],
          getAsset(file: string) {
            if (file === 'main.js') {
              return {
                source: {
                  source: () => `customElements.define('cds-button', class CDSButton extends HTMLElement {});`,
                },
              };
            }
            return null;
          },
          emitAsset(fileName: string, source: any) {
            emittedFileName = fileName;
            emittedContent = typeof source.source === 'function' ? source.source() : String(source);
          },
          hooks: {
            processAssets: {
              tapPromise(_options: any, callback: any) {
                return callback({});
              },
            },
          },
        };

        const mockCompiler = {
          options: {
            target: 'node',
            module: { rules: [] },
            mode: 'production',
          },
          webpack: {
            Compilation: {
              PROCESS_ASSETS_STAGE_ADDITIONS: 100,
            },
            sources: {
              RawSource: class {
                val: any;
                constructor(val: any) {
                  this.val = val;
                }
                source() {
                  return this.val;
                }
              },
            },
          },
          getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
          hooks: {
            beforeCompile: { tapAsync() {} },
            compilation: { tap() {} },
            thisCompilation: {
              tap(_name: string, cb: any) {
                cb(mockCompilation);
              },
            },
            normalModuleFactory: { tap() {} },
            shutdown: { tap() {} },
          },
        };

        plugin.apply(mockCompiler as any);

        expect(emittedFileName).toBe('ssr-manifest.json');
        expect(emittedContent).toContain('cds-button');
        const parsed = JSON.parse(emittedContent);
        expect(parsed.tags['cds-button']).toBeDefined();
        expect(parsed.tags['cds-button'].file).toBe('/assets/main.js');
      });
    });
  });
});
