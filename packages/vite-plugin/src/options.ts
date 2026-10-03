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

  /**
   * Minimum net byte savings threshold for extracting a shared constructable sheet.
   * Prevents creating micro-sheets where virtual module import overhead exceeds CSS savings.
   * @default 150
   */
  minSavings?: number;
}

export type LitCssFuseOptions = CssFuseOptions;

export interface HtmlFuseOptions {
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
   * Minimum number of components sharing a fragment to trigger clustering.
   * @default 2
   */
  threshold?: number;

  /**
   * Minimum character length of static fragment to qualify for clustering.
   * @default 15
   */
  minFragmentLength?: number;

  /**
   * Directory for generated fused template files, relative to project root.
   * @default '.fused-html'
   */
  outputDir?: string;

  /**
   * Apply deduplication and AST transformations during Vite dev server mode.
   * @default false
   */
  applyInDev?: boolean;
}

export type LitHtmlFuseOptions = HtmlFuseOptions;

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
   * Universal virtual module provider for @lit-core runtime helpers (virtual:lit-core/*).
   * Automatically enabled when needed or can be explicitly declared.
   * @default false
   */
  virtual?: boolean;

  /**
   * Cross-component static template and SVG fragment clustering.
   * Pass `true` or an `HtmlFuseOptions` object to enable.
   * @default false
   */
  htmlFuse?: boolean | HtmlFuseOptions;

  /**
   * Kebab-case alias for `htmlFuse`.
   */
  'html-fuse'?: boolean | HtmlFuseOptions;

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
   * Ahead-of-time template compilation for Lit templates via @lit-core/html-aot.
   * Compiles Lit html template literals into pre-parsed CompiledTemplate objects,
   * skipping Lit's runtime template preparation phase.
   * Pass `true` or an `HtmlAotOptions` object to enable.
   * @default false
   */
  htmlAot?: boolean | HtmlAotOptions;

  /**
   * Kebab-case alias for `htmlAot`.
   */
  'html-aot'?: boolean | HtmlAotOptions;

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
   * AOT custom element proxy stub optimization via @lit-core/elem-proxy.
   * Defers parsing and evaluating heavy LitElement classes until mount or property access.
   * Pass `true` or an `ElemProxyOptions` object to enable.
   * @default false
   */
  elemProxy?: boolean | ElemProxyOptions;

  /**
   * Kebab-case alias for `elemProxy`.
   */
  'elem-proxy'?: boolean | ElemProxyOptions;

  /**
   * Ahead-of-time vanilla Web Component and micro-runtime compiler via @lit-core/native.
   * Compiles leaf components into 100% pure vanilla Web Components with 0 KB Lit runtime
   * imports, and complex dynamic components into a shared 1.5 KB micro-runtime.
   * Pass `true` or a `NativeOptions` object to enable.
   * @default false
   */
  native?: boolean | NativeOptions;

  /**
   * Kebab-case alias for `native`.
   */
  'native-compile'?: boolean | NativeOptions;

  /**
   * Ahead-of-time ShadowRoot event delegation compiler pass via @lit-core/event-hoist.
   * Hoists bubbling child event listeners to a single delegated listener on ShadowRoot.
   * Pass `true` or an `EventHoistOptions` object to enable.
   * @default false
   */
  eventHoist?: boolean | EventHoistOptions;

  /**
   * Kebab-case alias for `eventHoist`.
   */
  'event-hoist'?: boolean | EventHoistOptions;

  /**
   * Ahead-of-time property-to-part dependency bitmasking via @lit-core/dirty-mask.
   * Eliminates redundant template expression evaluations and part diffs.
   * Pass `true` or a `DirtyMaskOptions` object to enable.
   * @default false
   */
  dirtyMask?: boolean | DirtyMaskOptions;

  /**
   * Kebab-case alias for `dirtyMask`.
   */
  'dirty-mask'?: boolean | DirtyMaskOptions;

  /**
   * Ahead-of-time structural DOM path compiler pass via @lit-core/dom-paths.
   * Precomputes child pointer paths to eliminate runtime TreeWalker traversal.
   * Pass `true` or a `DomPathsOptions` object to enable.
   * @default false
   */
  domPaths?: boolean | DomPathsOptions;

  /**
   * Kebab-case alias for `domPaths`.
   */
  'dom-paths'?: boolean | DomPathsOptions;

  /**
   * Ahead-of-time reactive expression auto-memoization compiler pass via @lit-core/memoize.
   * Analyzes JavaScript AST data flow inside Lit render() and wraps pure array pipelines in property-guarded cache slots.
   * Pass `true` or a `MemoizeOptions` object to enable.
   * @default false
   */
  memoize?: boolean | MemoizeOptions;

  /**
   * Ahead-of-time Lit directive lowering compiler pass via @lit-core/directives.
   * Compiles built-in Lit directives ahead of time into primitive JS expressions and prunes runtime directive imports.
   * Pass `true` or a `DirectivesOptions` object to enable.
   * @default false
   */
  directives?: boolean | DirectivesOptions;

  /**
   * Ahead-of-time SSR and runtime resumption architecture for zero component JS on initial boot.
   * Pass `true` or a `ResumableOptions` object to enable.
   * @default false
   */
  resumable?: boolean | ResumableOptions;

  /**
   * Ahead-of-time Web Component dead code elimination via @lit-core/tag-shake.
   * Scans templates for used tags and prunes unreferenced custom element registrations and imports.
   * Pass `true` or a `TagShakeOptions` object to enable.
   * @default false
   */
  tagShake?: boolean | TagShakeOptions;

  /**
   * Kebab-case alias for `tagShake`.
   */
  'tag-shake'?: boolean | TagShakeOptions;
}

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

export type LitResumableOptions = ResumableOptions;

export interface EventHoistOptions {
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
   * Custom list of event names to hoist.
   * Defaults to standard safe bubbling events (click, input, change, etc.).
   */
  events?: string[];

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;
}

export type LitEventHoistOptions = EventHoistOptions;

export interface DirtyMaskOptions {
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

export type LitDirtyMaskOptions = DirtyMaskOptions;

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
}

export type LitElemProxyOptions = ElemProxyOptions;

export interface HtmlAotOptions {
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

export type LitHtmlAotOptions = HtmlAotOptions;

export interface DomPathsOptions {
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
   * Normalize whitespace between HTML tags when computing DOM paths.
   * @default true
   */
  normalizeWhitespace?: boolean;

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;
}

export type LitDomPathsOptions = DomPathsOptions;
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
}

export type LitMemoizeOptions = MemoizeOptions;

export interface NativeOptions {
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
   * Forced compilation mode ('auto' | 'vanilla-only' | 'micro-only').
   * @default 'auto'
   */
  mode?: 'auto' | 'vanilla-only' | 'micro-only';

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;
}

export type LitNativeOptions = NativeOptions;

export interface DirectivesOptions {
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

export type LitDirectivesOptions = DirectivesOptions;

export interface TagShakeOptions {
  /**
   * File patterns for application files to scan for used tags.
   * Defaults to [/\.[jt]sx?$/, /\.html$/].
   */
  include?: (string | RegExp)[] | string | RegExp;

  /**
   * File patterns to exclude from application tag scanning.
   * Defaults to [/node_modules/].
   */
  exclude?: (string | RegExp)[] | string | RegExp;

  /**
   * Explicit list of tags to preserve.
   */
  keepTags?: string[];

  /**
   * Generate sourcemap for transformed files.
   * @default true
   */
  sourcemap?: boolean;
}

export type LitTagShakeOptions = TagShakeOptions;
export type LitCorePluginOptions = LitPluginOptions;
