import { compileModule } from './index.js';

const LIT_FAST_CHECK = /\bLitElement\b|@customElement\b|extends\s+(?:LitElement|ReactiveElement)\b|html`/;

function matchesFilter(id, filter) {
  if (!filter) return false;
  const list = Array.isArray(filter) ? filter : [filter];
  return list.some((f) => (typeof f === 'string' ? id.includes(f) : f.test(id)));
}

export function morphLit(options = {}) {
  return {
    name: 'lit-morph-to-react',
    enforce: 'pre',

    transform(code, id) {
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
