export interface ElemProxyOptions {
  /**
   * Transformation mode:
   * - 'inline': wraps implementation in a deferred factory closure within the module.
   * - 'split': splits implementation into a deferred dynamic import / chunk.
   * @default 'inline'
   */
  mode?: 'inline' | 'split';

  /**
   * File patterns to include.
   * Defaults to [/\.[jt]sx?$/].
   */
  include?: (string | RegExp)[] | string | RegExp;

  /**
   * File patterns to exclude.
   * Defaults to [/node_modules/].
   */
  exclude?: (string | RegExp)[] | string | RegExp;

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;

  /**
   * Filename for source type detection.
   */
  filename?: string;
}

export interface ProxiedElementInfo {
  tagName: string;
  className: string;
  properties: string[];
  observedAttributes: string[];
}

export interface ElemProxyResult {
  code: string;
  map?: string | null;
  proxiedElementsCount: number;
  elements: ProxiedElementInfo[];
}

export function transformElemProxy(source: string, options?: ElemProxyOptions): ElemProxyResult;
