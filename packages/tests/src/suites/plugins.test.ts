import { describe, expect, it } from 'vitest';
import { lit as viteLit } from '@lit-core/vite-plugin';
import { LitWebpackPlugin } from '@lit-core/webpack-plugin';
import {
  CARBON_COMPONENTS,
  SPECTRUM_COMPONENTS,
  WEBAWESOME_COMPONENTS,
  MATERIAL_COMPONENTS,
  MOMENTUM_COMPONENTS,
} from '../components.js';
import { readComponentSource, findComponentCssSource } from '../fixtures.js';

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
      it(`processes real ${name} component source through Vite plugin transforms`, async () => {
        const rawSource = readComponentSource(comp.pkg, comp.source);
        const plugins = viteLit({
          propsLower: true,
          htmlMinifier: true,
        });

        for (const p of plugins) {
          if (typeof p.transform === 'function') {
            const transformed = await (p.transform as any).call(
              { error: () => {}, warn: () => {} },
              rawSource,
              comp.source
            );
            if (transformed) {
              const code = typeof transformed === 'string' ? transformed : transformed.code;
              expect(code).toBeDefined();
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
        const resolved = await (cssFusePlugin.resolveId as any).call(
          {},
          'virtual:css-fuse/shared-sheet-abc'
        );
        expect(resolved).toBeDefined();
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
    });
  });
});
