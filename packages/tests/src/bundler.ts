import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LitCorePluginOptions, lit as litPlugin } from '@lit-core/vite-plugin';
import { build } from 'vite';
// @ts-expect-error - canonical-components is an un-typed ESM module in packages/benchmarks
import { CANONICAL_SUITE_DEFINITIONS } from '../../benchmarks/src/suites/canonical-components.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

export interface ComponentBundleOptions {
  imports?: string[];
  entrySource?: string;
  plugins?: LitCorePluginOptions;
}

export interface CanonicalComponentDef {
  tag: string;
  path: string;
  importStatement: string;
}

const bundleCache = new Map<string, string>();

/**
 * Resolve canonical suite key from framework name.
 */
export function getSuiteKey(frameworkName: string): string {
  const lower = frameworkName.toLowerCase();
  if (lower.includes('carbon')) return 'carbon';
  if (lower.includes('spectrum')) return 'spectrum';
  if (lower.includes('awesome')) return 'webawesome';
  if (lower.includes('material')) return 'material';
  if (lower.includes('momentum')) return 'momentum';
  return 'carbon';
}

/**
 * Get canonical component definition for a framework suite.
 */
export function getCanonicalComponent(frameworkName: string, componentId: string = 'button'): CanonicalComponentDef {
  const suiteKey = getSuiteKey(frameworkName);
  const suite = (CANONICAL_SUITE_DEFINITIONS as any)[suiteKey];
  if (!suite) {
    throw new Error(`Unknown canonical suite for framework: ${frameworkName}`);
  }
  const comp = suite.components[componentId];
  if (!comp) {
    throw new Error(`Unknown canonical component '${componentId}' in suite '${suiteKey}'`);
  }
  return comp;
}

/**
 * Bundle real component sources in memory using Vite and @lit-core/vite-plugin.
 */
export async function bundleComponentForBrowser(options: ComponentBundleOptions): Promise<string> {
  const source = options.entrySource || (options.imports ? options.imports.join('\n') : '');
  if (!source.trim()) {
    throw new Error('bundleComponentForBrowser requires either entrySource or non-empty imports array');
  }

  const cacheKey = `${source}:::${JSON.stringify(options.plugins || {})}`;
  const cached = bundleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const entryId = 'virtual:test-bundle-entry.js';
  const buildResult = await build({
    logLevel: 'silent',
    configFile: false,
    root: rootDir,
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        input: entryId,
        output: {
          codeSplitting: false,
          format: 'es',
        },
      },
    },
    plugins: [
      {
        name: 'test-virtual-entry',
        enforce: 'pre',
        resolveId(id) {
          if (id === entryId) return `\0${id}`;
        },
        load(id) {
          if (id === `\0${entryId}`) return source;
        },
      },
      ...litPlugin(options.plugins || {}),
    ],
  });

  const rawOutput = (buildResult as any).output || (Array.isArray(buildResult) ? buildResult[0].output : []);
  const jsChunk = rawOutput.find((c: any) => c.fileName?.endsWith('.js'));
  if (!jsChunk || !('code' in jsChunk)) {
    throw new Error('Vite build failed to produce JavaScript chunk for test bundle');
  }

  bundleCache.set(cacheKey, jsChunk.code);
  return jsChunk.code;
}
