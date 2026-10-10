import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

/**
 * Creates a Vite plugin that resolves scoped subpackages
 * (such as @spectrum-web-components/*) that are installed as transitive
 * dependencies under bundle meta-packages in strict pnpm environments.
 * @returns {import('vite').Plugin}
 */
export function createBenchmarkVendorResolverPlugin() {
  let bundleRequire = null;
  try {
    const bundlePkg = req.resolve('@spectrum-web-components/bundle/package.json');
    bundleRequire = createRequire(bundlePkg);
  } catch {}

  return {
    name: 'benchmark-vendor-resolver',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('@spectrum-web-components/') && bundleRequire) {
        try {
          return bundleRequire.resolve(id);
        } catch {}
      }
      return null;
    },
  };
}
