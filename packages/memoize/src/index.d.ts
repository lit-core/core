export interface MemoizeOptions {
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
   * Source filename for parser and sourcemap generation.
   * @default 'file.ts'
   */
  filename?: string;
}

export interface MemoizeResult {
  code: string;
  map?: string | null;
  memoizedCount: number;
  componentsCount: number;
}

export declare function transformMemoize(
  source: string,
  options?: MemoizeOptions
): MemoizeResult;
