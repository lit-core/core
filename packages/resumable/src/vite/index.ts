import type { Plugin, ResolvedConfig } from 'vite';
import { compileResumableLoader, transformResumableComponent } from '../compiler/index.js';
import { RESUMABLE_ADAPTER_SOURCE } from '../virtual.js';
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

const VIRTUAL_ADAPTER_ID = 'virtual:lit-core/resumable-adapter';
const RESOLVED_VIRTUAL_ADAPTER_ID = '\0virtual:lit-core/resumable-adapter';

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

    resolveId(id) {
      if (id === VIRTUAL_ADAPTER_ID || id === `${VIRTUAL_ADAPTER_ID}.js` || id === '@lit-core/resumable/client' || id === '@lit-core/resumable/client.js') {
        return RESOLVED_VIRTUAL_ADAPTER_ID;
      }
      return undefined;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ADAPTER_ID) {
        return {
          code: RESUMABLE_ADAPTER_SOURCE,
          map: null,
        };
      }
      return undefined;
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
        const result = transformResumableComponent(code, {
          filename: cleanId,
          virtualModule: VIRTUAL_ADAPTER_ID,
        });

        if (result.transformed) {
          return {
            code: result.code,
            map: result.map ? JSON.parse(result.map) : null,
          };
        }
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

      const loaderScript = compileResumableLoader({ manifest, preloadOnHover });
      const injection = `<script>${loaderScript}</script>`;

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

export { buildManifest, extractCustomElementTags } from './manifest.js';
export const litResumable = resumable;
export default resumable;
