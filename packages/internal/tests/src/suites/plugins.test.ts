import { lit as viteLit } from '@lit-core/vite-plugin';
import { LitWebpackPlugin, litWebpackLoader } from '@lit-core/webpack-plugin';
import { describe, expect, it } from 'vitest';
import { CARBON_COMPONENTS, MATERIAL_COMPONENTS, MOMENTUM_COMPONENTS, SPECTRUM_COMPONENTS, WEBAWESOME_COMPONENTS } from '../components.js';
import { findComponentCssSource, readComponentSource } from '../fixtures.js';

describe('bundler plugins multi-framework integration suite', () => {
  const frameworks = [
    { name: 'Carbon', comp: CARBON_COMPONENTS[0] },
    { name: 'Spectrum', comp: SPECTRUM_COMPONENTS[0] },
    { name: 'Web Awesome', comp: WEBAWESOME_COMPONENTS[0] },
    { name: 'Google Material', comp: MATERIAL_COMPONENTS[0] },
    { name: 'Cisco Momentum', comp: MOMENTUM_COMPONENTS[0] },
  ];

  describe('Vite / Rollup unified bundler plugin', () => {
    it('initializes all compiler passes via unified lit() configuration', () => {
      const plugins = viteLit({
        cssFuse: true,
        propsLower: true,
        htmlMinifier: true,
        cssMinifier: true,
        elemProxy: true,
        eventHoist: true,
        htmlAot: true,
        htmlFuse: true,
        resumable: true,
      });

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBeGreaterThanOrEqual(1);
    });

    frameworks.forEach(({ name, comp }) => {
      it(`processes real ${name} component source through Vite plugin transforms without error`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const plugins = viteLit({
          propsLower: true,
          htmlMinifier: true,
          cssMinifier: true,
          directives: true,
          dirtyMask: true,
          domPaths: true,
        });

        for (const p of plugins) {
          if (typeof p.transform === 'function') {
            const errors: any[] = [];
            const mockContext = {
              error(err: any) {
                errors.push(err);
                throw new Error(err.message || String(err));
              },
              warn() {},
            };

            const transformed = await (p.transform as any).call(mockContext, rawSource, comp.source);
            expect(errors).toHaveLength(0);
            if (transformed) {
              const code = typeof transformed === 'string' ? transformed : transformed.code;
              expect(code).toBeDefined();
              expect(code.length).toBeGreaterThan(0);
            }
          }
        }
      });
    });

    it('resolves virtual:css-fuse module identifiers in Rollup module graph', async () => {
      const plugins = viteLit({ cssFuse: true });
      const cssFusePlugin = plugins.find((p) => p.name === 'css-fuse');
      expect(cssFusePlugin).toBeDefined();

      if (cssFusePlugin && typeof cssFusePlugin.resolveId === 'function') {
        const resolved = await (cssFusePlugin.resolveId as any).call({}, 'virtual:css-fuse/shared-sheet-abc');
        expect(resolved).toBeDefined();
      }
    });

    it('emits actionable build error on transform failure in Vite plugin', async () => {
      const plugins = viteLit({ propsLower: { sourcemap: 'invalid' as any } });
      const propsLowerPlugin = plugins.find((p) => p.name === 'props-lower');
      expect(propsLowerPlugin).toBeDefined();
      if (!propsLowerPlugin) throw new Error('props-lower plugin not found');

      const sampleSource = `
        import { LitElement } from 'lit';
        import { property } from 'lit/decorators.js';
        class SampleComp extends LitElement {
          @property() count = 0;
        }
      `;

      let caughtError: any = null;
      const mockContext = {
        error(err: any) {
          caughtError = err;
          throw new Error(err.message || String(err));
        },
        warn() {},
      };

      await expect(async () => {
        await (propsLowerPlugin.transform as any).call(mockContext, sampleSource, '/src/broken.ts');
      }).rejects.toThrow();

      expect(caughtError).toBeDefined();
      expect(caughtError.message).toMatch(/\[props-lower\]/i);
      expect(caughtError.id).toBe('/src/broken.ts');
    });

    it('safely passes through benign non-matching code returning null', async () => {
      const plugins = viteLit({ propsLower: true, htmlMinifier: true });
      const nonLitSource = `export function calculate(a: number, b: number) { return a + b; }`;

      for (const p of plugins) {
        if (typeof p.transform === 'function') {
          let errorCalled = false;
          const mockContext = {
            error() {
              errorCalled = true;
            },
            warn() {},
          };
          const result = await (p.transform as any).call(mockContext, nonLitSource, '/src/math.ts');
          expect(errorCalled).toBe(false);
          expect(result == null).toBe(true);
        }
      }
    });
  });

  describe('Webpack unified bundler plugin', () => {
    it('instantiates LitWebpackPlugin with unified optimization flags', () => {
      const plugin = new LitWebpackPlugin({
        cssFuse: true,
        propsLower: true,
        htmlMinifier: true,
        cssMinifier: true,
      });
      expect(plugin).toBeDefined();
      expect(typeof plugin.apply).toBe('function');
    });

    frameworks.forEach(({ name, comp }) => {
      it(`verifies real ${name} stylesheet processing compatibility in Webpack loader pipeline`, () => {
        const cssSource = findComponentCssSource(comp.pkg, comp.css, comp.source);
        expect(cssSource).toBeDefined();
        expect(cssSource.length).toBeGreaterThan(0);
      });

      it(`processes real ${name} component source through Webpack loader pipeline`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const result = await new Promise<{ code: string; map: any }>((resolve, reject) => {
          const mockContext = {
            resourcePath: comp.source,
            getOptions: () => ({
              options: {
                propsLower: true,
                htmlMinifier: true,
                cssMinifier: true,
                directives: true,
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
      });
    });

    it('propagates actionable build error to Webpack loader callback on transform failure', async () => {
      const sampleSource = `
        import { LitElement } from 'lit';
        import { property } from 'lit/decorators.js';
        class BrokenComponent extends LitElement {
          @property() count = 0;
        }
      `;

      await expect(
        new Promise((resolve, reject) => {
          const mockContext = {
            resourcePath: '/src/broken.ts',
            getOptions: () => ({
              options: {
                propsLower: { sourcemap: 'invalid' as any },
              },
            }),
            async: () => (err: Error | null, code: string, map: any) => {
              if (err) reject(err);
              else resolve({ code, map });
            },
          };
          litWebpackLoader.call(mockContext as any, sampleSource);
        }),
      ).rejects.toThrow(/\[lit-webpack-loader\].*props-lower/i);
    });

    it('safely passes through benign non-matching code in Webpack loader returning unmodified source', async () => {
      const nonLitSource = `export function add(a: number, b: number) { return a + b; }`;
      const result = await new Promise<{ code: string; map: any }>((resolve, reject) => {
        const mockContext = {
          resourcePath: '/src/math.ts',
          getOptions: () => ({
            options: {
              propsLower: true,
              htmlMinifier: true,
            },
          }),
          async: () => (err: Error | null, code: string, map: any) => {
            if (err) reject(err);
            else resolve({ code, map });
          },
        };
        litWebpackLoader.call(mockContext as any, nonLitSource);
      });

      expect(result.code).toBe(nonLitSource);
    });
  });

  describe('bundler plugins SSR option contracts', () => {
    describe('Vite / Rollup plugin SSR options', () => {
      it('initializes SSR sub-plugin when ssr: true is provided', () => {
        const plugins = viteLit({ ssr: true });
        const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
        expect(ssrPlugin).toBeDefined();
      });

      it('initializes SSR sub-plugin with streaming mode configuration', () => {
        const plugins = viteLit({
          ssr: {
            streaming: true,
            mode: 'stream',
          },
        });
        const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
        expect(ssrPlugin).toBeDefined();
      });

      it('initializes SSR sub-plugin with static prerender configuration', () => {
        const plugins = viteLit({
          ssr: {
            prerender: {
              routes: ['/', '/about', '/contact'],
              concurrency: 4,
            },
          },
        });
        const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
        expect(ssrPlugin).toBeDefined();
      });

      it('initializes SSR sub-plugin with islands mode configuration', () => {
        const plugins = viteLit({
          ssr: {
            islands: {
              include: ['cds-button', 'sp-action-button'],
              strategy: 'visible',
            },
          },
        });
        const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr' || p.name === 'ssr');
        expect(ssrPlugin).toBeDefined();
      });

      it('resolves virtual:lit-core/ssr-runtime module identifier', async () => {
        const plugins = viteLit({ ssr: true });
        const virtualPlugin = plugins.find((p) => p.name === 'lit-virtual' || p.name === 'lit-ssr');
        expect(virtualPlugin).toBeDefined();

        if (virtualPlugin && typeof virtualPlugin.resolveId === 'function') {
          const resolved = await (virtualPlugin.resolveId as any).call({}, 'virtual:lit-core/ssr-runtime');
          expect(resolved).toBeDefined();
        }
      });
    });

    describe('Webpack plugin SSR options', () => {
      it('instantiates LitWebpackPlugin with ssr: true', () => {
        const plugin = new LitWebpackPlugin({ ssr: true });
        expect(plugin.options.ssr).toBe(true);
      });

      it('instantiates LitWebpackPlugin with structured SsrOptions', () => {
        const plugin = new LitWebpackPlugin({
          ssr: {
            streaming: true,
            prerender: { routes: ['/'] },
            islands: true,
          },
        });
        expect(typeof plugin.options.ssr).toBe('object');
        expect((plugin.options.ssr as any).streaming).toBe(true);
      });

      it('auto-activates SSR compilation when compiler target is node', () => {
        const plugin = new LitWebpackPlugin();
        const mockCompiler = {
          options: {
            target: 'node',
            module: { rules: [] },
            mode: 'production',
          },
          getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
          hooks: {
            beforeCompile: { tapAsync() {} },
            compilation: { tap() {} },
            normalModuleFactory: { tap() {} },
            shutdown: { tap() {} },
          },
        };

        plugin.apply(mockCompiler as any);
        expect(mockCompiler.options.module.rules.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
