import { transformSsrComponent } from '@lit-core/ssr';
import type { SsrOptions } from '../options.js';
import { shouldProcessFile, TransformError, type TransformResult } from './common.js';

export const LIT_SSR_FAST_CHECK = /(?:@customElement|customElements\.define|LitElement|ReactiveElement|HTMLElement|html`|css`)/;

/**
 * Ahead-of-time SSR transform preparing Web Component modules for pure V8 isolate execution.
 * Enforces Declarative Shadow DOM compatibility, island tagging, and clean DSD emission
 * using the native Rust oxc compiler in @lit-core/ssr.
 */
export function transformSsr(code: string, id: string, options: SsrOptions & { ssrMode?: boolean } = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_SSR_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const islandsConfig = typeof options.islands === 'object' ? options.islands : null;
    const isSsrMode = Boolean(options.ssrMode);
    const result = transformSsrComponent(code, {
      filename: cleanId,
      sourcemap: Boolean(sourcemap),
      ssrMode: isSsrMode,
      islands: Boolean(options.islands) && !isSsrMode,
      islandsInclude: islandsConfig?.include,
      islandsExclude: islandsConfig?.exclude,
    });

    if (result.syntaxError) {
      throw new Error(`Malformed component template syntax: ${result.syntaxError}`);
    }

    if (result.modified) {
      return {
        code: result.code,
        map: sourcemap ? (result.map ?? null) : null,
      };
    }

    if (options.islands) {
      return null;
    }

    return {
      code,
      map: sourcemap ? null : null,
    };
  } catch (err) {
    throw new TransformError('ssr', cleanId, err);
  }
}
