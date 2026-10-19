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

  /**
   * Eagerly load remaining component chunks during browser idle time.
   * Off by default so chunks only load on interaction or hover intent.
   * @default false
   */
  idleHydration?: boolean;

  /**
   * Idle callback deadline in milliseconds when `idleHydration` is enabled.
   * @default 2000
   */
  idleTimeout?: number;

  /**
   * Interaction events intercepted by the micro-loader.
   */
  events?: string[];
}

const VIRTUAL_ADAPTER_ID = 'virtual:lit-core/resumable-adapter';
const RESOLVED_VIRTUAL_ADAPTER_ID = '\0virtual:lit-core/resumable-adapter';

export function resumable(options: ResumableOptions = {}): Plugin {
  let config: ResolvedConfig;
  const chunkToTags = new Map<string, string[]>();
  const moduleTags = new Map<string, string[]>();
  let manifest: Record<string, string> = {};

  // Maps each emitted chunk file to the custom element tags it defines, using both the
  // tags seen per source module and the tags found in the emitted chunk code.
  const tagsByChunk = (bundle: Record<string, { type: string }>): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue;
      const chunk = output as unknown as { code: string; moduleIds?: string[] };
      const tags = new Set<string>(extractCustomElementTags(chunk.code));
      for (const id of chunk.moduleIds ?? []) {
        for (const tag of moduleTags.get(id.split('?')[0]) ?? []) tags.add(tag);
      }
      if (tags.size > 0) result.set(fileName, [...tags]);
    }
    return result;
  };

  const { preloadOnHover = true, chunkResolver, injectAdapter = true, idleHydration, idleTimeout, events } = options;

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
      moduleTags.set(cleanId, tags);

      if (injectAdapter) {
        const result = transformResumableComponent(code, {
          filename: cleanId,
          sourcemap: true,
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
      for (const [fileName, tags] of tagsByChunk(bundle)) {
        chunkToTags.set(fileName, tags);
      }

      manifest = buildManifest(chunkToTags, {
        chunkResolver,
        basePath: config?.base || '/',
      });
    },

    transformIndexHtml: {
      order: 'post',
      handler(html: string, ctx) {
        // In a production build the output bundle already exists when HTML is transformed,
        // and it is the only source of truth for built chunk URLs.
        if (ctx?.bundle) {
          manifest = buildManifest(tagsByChunk(ctx.bundle), {
            chunkResolver,
            basePath: config?.base || '/',
          });
        } else if (Object.keys(manifest).length === 0 && chunkToTags.size > 0) {
          // Dev server: modules are served from their source paths.
          manifest = buildManifest(chunkToTags, {
            chunkResolver,
            basePath: config?.base || '/',
          });
        }

        const loaderScript = compileResumableLoader({ manifest, preloadOnHover, idleHydration, idleTimeout, events });
        const injection = `<script>${loaderScript}</script>`;

        if (html.includes('</head>')) {
          return html.replace('</head>', `${injection}\n</head>`);
        }
        if (html.includes('<body')) {
          return html.replace('<body', `${injection}\n<body`);
        }
        return `${injection}\n${html}`;
      },
    },
  };
}

export { buildManifest, extractCustomElementTags } from './manifest.js';
export const litResumable = resumable;
export default resumable;
