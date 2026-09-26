export interface CssFuseOptions {
  /**
   * Glob patterns for component source files to scan.
   * @default ['packages/components/** /src/** /*.ts', 'src/** /*.ts']
   */
  include?: string[];

  /**
   * Glob patterns to exclude.
   * @default ['**\/*.test.ts', '**\/*.spec.ts', '**\/node_modules/**', '**\/dist/**']
   */
  exclude?: string[];

  /**
   * Minimum number of components sharing a CSS rule to trigger deduplication.
   * @default 2
   */
  threshold?: number;

  /**
   * Directory for generated fused sheet files, relative to project root.
   * @default '.fused'
   */
  outputDir?: string;

  /**
   * Enable Shadow DOM scoping and contract audit diagnostics in console.
   * @default true
   */
  scopingAudit?: boolean;

  /**
   * Apply deduplication and AST transformations during Vite dev server mode.
   * When false (default), dev server only performs the fast scoping audit.
   * @default false
   */
  applyInDev?: boolean;
}

export type LitCssFuseOptions = CssFuseOptions;

export interface PropsLowerOptions {
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
}

export type LitPropsLowerOptions = PropsLowerOptions;

export interface HtmlMinifierOptions {
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
   * @default false
   */
  sourcemap?: boolean;
}

export type LitHtmlMinifierOptions = HtmlMinifierOptions;
export type TemplateWhitespaceCollapserOptions = HtmlMinifierOptions;
export type LitTemplateWhitespaceCollapserOptions = HtmlMinifierOptions;

export interface CssMinifierOptions {
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
}

export type LitCssMinifierOptions = CssMinifierOptions;

export interface LitPluginOptions {
  /**
   * Cross-component CSS AST deduplication and constructable stylesheet sharing.
   * Pass `false` to disable, `true` (default) for default settings, or a `CssFuseOptions` object.
   * @default true
   */
  cssFuse?: boolean | CssFuseOptions;

  /**
   * Native Rust AOT AST lowering for Lit decorators and properties via OXC.
   * Pass `true` or a `PropsLowerOptions` object to enable.
   * @default false
   */
  propsLower?: boolean | PropsLowerOptions;

  /**
   * Kebab-case alias for `propsLower`.
   */
  'props-lower'?: boolean | PropsLowerOptions;

  /**
   * Embedded CSS template minification via Lightning CSS.
   * Pass `true` or a `CssMinifierOptions` object to enable.
   * @default false
   */
  cssMinifier?: boolean | CssMinifierOptions;

  /**
   * Kebab-case alias for `cssMinifier`.
   */
  'css-minifier'?: boolean | CssMinifierOptions;

  /**
   * Native Rust AOT HTML & SVG template minification for Lit via OXC.
   * Pass `true` or an `HtmlMinifierOptions` object to enable.
   * @default false
   */
  htmlMinifier?: boolean | HtmlMinifierOptions;

  /**
   * Kebab-case alias for `htmlMinifier`.
   */
  'html-minifier'?: boolean | HtmlMinifierOptions;

  /**
   * Alias for `htmlMinifier`.
   */
  templateWhitespaceCollapser?: boolean | HtmlMinifierOptions;

  /**
   * Alias for `htmlMinifier`.
   */
  'template-whitespace-collapser'?: boolean | HtmlMinifierOptions;
}

export type LitCorePluginOptions = LitPluginOptions;
