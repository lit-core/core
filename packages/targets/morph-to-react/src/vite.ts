import { compileModule } from './index.js';

export interface MorphVitePlugin {
  name: string;
  enforce?: 'pre' | 'post';
  transform(code: string, id: string): { code: string; map: null } | null | Promise<{ code: string; map: null } | null>;
  [key: string]: any;
}

export interface MorphLitOptions {
  include?: string | RegExp | (string | RegExp)[];
  exclude?: string | RegExp | (string | RegExp)[];
  emitCss?: boolean;
  emitDts?: boolean;
  tagSuffix?: string;
  stripPrefix?: string;
  targetTier?: 'Tier0Pure' | 'Tier1Hosted' | 'Tier2HostedWithFacade' | 'Bailout';
  noCache?: boolean;
}

const LIT_FAST_CHECK = /\bLitElement\b|@customElement\b|extends\s+(?:LitElement|ReactiveElement)\b|html`/;

function matchesFilter(id: string, filter?: string | RegExp | (string | RegExp)[]): boolean {
  if (!filter) return false;
  const list = Array.isArray(filter) ? filter : [filter];
  return list.some((f) => (typeof f === 'string' ? id.includes(f) : f.test(id)));
}

export function morphLit(options: MorphLitOptions = {}): MorphVitePlugin {
  return {
    name: 'lit-morph-to-react',
    enforce: 'pre',

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.[jt]sx?$/.test(cleanId)) {
        return null;
      }

      if (options.exclude && matchesFilter(cleanId, options.exclude)) {
        return null;
      }

      if (!options.include && cleanId.includes('/node_modules/')) {
        return null;
      }

      if (options.include && !matchesFilter(cleanId, options.include)) {
        return null;
      }

      if (!LIT_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = compileModule(code, {
          filePath: cleanId,
          emitCss: options.emitCss,
          emitDts: options.emitDts,
          tagSuffix: options.tagSuffix,
          stripPrefix: options.stripPrefix,
          targetTier: options.targetTier,
          noCache: options.noCache,
        });

        if (result.tier === 'None' || !result.componentName) {
          return null;
        }

        return {
          code: result.code,
          map: null,
        };
      } catch (err) {
        console.error(`[morph-to-react] Failed to transform ${cleanId}:`, err);
        return null;
      }
    },
  };
}

export const morphToReact = morphLit;
export default morphLit;
