/// <reference types="node" />

export {
  default as litWebpackLoader,
  getPluginState,
  registerPluginState,
  unregisterPluginState,
} from './loader.js';
export type {
  CssFuseOptions,
  CssMinifierOptions,
  HtmlFuseOptions,
  HtmlMinifierOptions,
  LitCorePluginOptions,
  LitCssFuseOptions,
  LitCssMinifierOptions,
  LitHtmlFuseOptions,
  LitHtmlMinifierOptions,
  LitPluginOptions,
  LitPropsLowerOptions,
  LitWebpackPluginOptions,
  PropsLowerOptions,
} from './options.js';
export {
  CssFuseWebpackPlugin,
  CssMinifierWebpackPlugin,
  cssFuse,
  cssMinifier,
  HtmlFuseWebpackPlugin,
  htmlFuse,
  HtmlMinifierWebpackPlugin,
  htmlMinifier,
  LitWebpackPlugin,
  lit,
  lit as default,
  litCore,
  litCssFuse,
  litCssMinifier,
  litHtmlFuse,
  litHtmlMinifier,
  litPropsLower,
  PropsLowerWebpackPlugin,
  propsLower,
} from './plugin.js';
