import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LitCoreVitePlugin } from '@lit-core/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const req = createRequire(import.meta.url);

function getSpectrumPlugin() {
  let bundleRequire: any = null;
  try {
    const bundlePkg = req.resolve('@spectrum-web-components/bundle/package.json');
    bundleRequire = createRequire(bundlePkg);
  } catch {}

  return {
    name: 'spectrum-vendor-resolver',
    enforce: 'pre' as const,
    resolveId(id: string) {
      if (id.startsWith('@spectrum-web-components/') && bundleRequire) {
        try {
          return bundleRequire.resolve(id);
        } catch {}
      }
      return null;
    },
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feature = process.env.FEATURE || 'baseline';
const outDir = process.env.OUT_DIR || path.resolve(__dirname, `dist/${feature}`);

function getPluginOptions(feat: string) {
  const include = [
    'node_modules/@carbon/web-components/es/components/**/*.js',
    'node_modules/@spectrum-web-components/**/sp-*.js',
    'node_modules/@awesome.me/webawesome/dist/components/**/*.js',
    'node_modules/@material/web/**/*.js',
    'node_modules/@momentum-design/components/dist/components/**/*.js',
    'packages/showcase/src/**',
  ];
  const exclude = ['**/node_modules/.pnpm/**', '**/dist/**', '**/*.test.*', '**/*.spec.*'];

  switch (feat) {
    case 'css-fuse':
      return { cssFuse: { include, exclude, threshold: 1, minSavings: 0, applyInDev: true } };
    case 'props-lower':
      return { propsLower: { include } };
    case 'html-aot':
      return { htmlAot: { include } };
    case 'event-hoist':
      return { eventHoist: { include } };
    case 'dom-paths':
      return { domPaths: { include, normalizeWhitespace: true } };
    case 'dirty-mask':
      return { dirtyMask: { include } };
    case 'memoize':
      return { memoize: { include } };
    case 'elem-proxy':
      return { elemProxy: { include } };
    case 'resumable':
      return { resumable: { include, injectAdapter: true } };
    case 'native':
      return { native: { include } };
    case 'css-minifier':
      return { cssMinifier: { include } };
    case 'html-minifier':
      return { htmlMinifier: { include } };
    case 'html-fuse':
      return { htmlFuse: { include } };
    case 'all':
      return {
        cssFuse: { include, exclude, threshold: 1, minSavings: 0, applyInDev: true },
        propsLower: { include },
        htmlAot: { include },
        eventHoist: { include },
        domPaths: { include, normalizeWhitespace: true },
        dirtyMask: { include },
        memoize: { include },
        elemProxy: { include },
        resumable: { include, injectAdapter: true },
        native: { include },
        cssMinifier: { include },
        htmlMinifier: { include },
      };
    default:
      return null;
  }
}

const pluginOpts = getPluginOptions(feature);
const plugins = [tailwindcss(), getSpectrumPlugin(), ...(pluginOpts ? [LitCoreVitePlugin(pluginOpts)] : [])];

export default defineConfig({
  root: __dirname,
  base: './',
  define: {
    __FEATURE__: JSON.stringify(feature),
  },
  plugins,
  build: {
    outDir,
    emptyOutDir: true,
  },
});
