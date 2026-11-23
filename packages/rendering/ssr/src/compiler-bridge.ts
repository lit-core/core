/**
 * Compiler integration bridge for @lit-core/ssr.
 * Bridges @lit-core/html-aot, @lit-core/css-fuse, @lit-core/directives,
 * and @lit-core/resumable. This module is part of the runtime entry and must stay
 * free of Node-only imports (node:*, native addons) so it loads on any JS runtime.
 */

import { extractComponentState as resumableExtractComponentState, serializeStateToJson as resumableSerializeStateToJson } from '@lit-core/resumable/server';
import { type CompiledTemplateResult, isCompiledTemplateResult, type SsrRenderContext } from './plan-types.js';
import { StyleDeduplicator } from './style-deduplicator.js';

export * from './boundary-descriptors.js';
export * from './directives.js';
export * from './escape.js';
export * from './plan-types.js';
export * from './sentinels.js';
export * from './style-deduplicator.js';
export * from './trusted-html.js';

export class CompilerBridge {
  readonly styleDeduplicator = new StyleDeduplicator();

  public isCompiled(value: unknown): value is CompiledTemplateResult {
    return isCompiledTemplateResult(value);
  }

  public extractComponentStyles(ctor: any): { shared: string[]; local: string[]; sharedEntries: Array<{ key: string; css: string }> } {
    const res = this.styleDeduplicator.processComponentStyles(ctor);
    return { shared: res.sharedSheets, local: res.localStyles, sharedEntries: res.sharedEntries ?? [] };
  }

  /**
   * Extracts component state as a serialized JSON string for the `data-lit-state` host attribute.
   */
  public serializeComponentState(component: any, context: SsrRenderContext): string {
    if (!context.resumable) return '';
    try {
      const stateObj = resumableExtractComponentState(component);
      if (stateObj && Object.keys(stateObj).length > 0) {
        return resumableSerializeStateToJson(stateObj);
      }
    } catch {}
    if (context.state && Object.keys(context.state).length > 0) {
      try {
        return resumableSerializeStateToJson(context.state);
      } catch {
        return '';
      }
    }
    return '';
  }
}
