import type { Plugin, ResolvedConfig } from 'vite';
import { generateInlineLoader } from '../client/loader.js';
import { buildManifest, extractCustomElementTags } from './manifest.js';

export interface ResumableOptions {
  /**
   * Include glob patterns for resumable components.
   */
  include?: string[];

  /**
   * Exclude glob patterns.
   */
  exclude?: string[];

  /**
   * Preload component chunks on idle or hover.
   * @default true
   */
  preloadOnHover?: boolean;

  /**
   * Custom chunk URL resolver.
   */
  chunkResolver?: (tagName: string) => string;

  /**
   * Automatically inject the client adapter into component modules.
   * @default true
   */
  injectAdapter?: boolean;
}

export function resumable(options: ResumableOptions = {}): Plugin {
  let config: ResolvedConfig;
  const chunkToTags = new Map<string, string[]>();
  let manifest: Record<string, string> = {};

  const { preloadOnHover = true, chunkResolver, injectAdapter = true } = options;

  return {
    name: 'lit-resumable',
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0];
      if (!/\.[jt]sx?$/.test(cleanId) || cleanId.includes('/node_modules/')) {
        return null;
      }

      // Check if file defines custom elements
      const tags = extractCustomElementTags(code);
      if (tags.length === 0) {
        return null;
      }

      // Store in chunk mapping for dev / single file resolution
      const relativeId = cleanId.replace(config?.root || '', '');
      chunkToTags.set(relativeId, tags);

      if (injectAdapter) {
        // Ensure installResumableAdapter is initialized when the component chunk loads
        const adapterImport = `import { installResumableAdapter } from '@lit-core/resumable/client';\ninstallResumableAdapter();\n`;
        return {
          code: `${adapterImport}${code}`,
          map: null,
        };
      }

      return null;
    },

    generateBundle(_outputOptions, bundle) {
      chunkToTags.clear();

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && chunk.code) {
          const tags = extractCustomElementTags(chunk.code);
          if (tags.length > 0) {
            chunkToTags.set(fileName, tags);
          }
        }
      }

      manifest = buildManifest(chunkToTags, {
        chunkResolver,
        basePath: config?.base || '/',
      });
    },

    transformIndexHtml(html: string) {
      // Re-build manifest if empty (e.g. In dev mode)
      if (Object.keys(manifest).length === 0 && chunkToTags.size > 0) {
        manifest = buildManifest(chunkToTags, {
          chunkResolver,
          basePath: config?.base || '/',
        });
      }

      const loaderScript = generateInlineLoader(manifest, { preloadOnHover });
      const manifestScript = `<script>window.__LIT_RESUMABLE_MANIFEST__=${JSON.stringify(manifest)};</script>`;
      const injection = `${manifestScript}\n<script>${loaderScript}</script>`;

      if (html.includes('</head>')) {
        return html.replace('</head>', `${injection}\n</head>`);
      }
      if (html.includes('<body')) {
        return html.replace('<body', `${injection}\n<body`);
      }
      return `${injection}\n${html}`;
    },
  };
}

export const litResumable = resumable;
export default resumable;
