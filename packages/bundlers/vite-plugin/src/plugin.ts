import { resumable as litResumablePlugin } from '@lit-core/resumable/vite';
import type { Plugin } from 'vite';
import type { LitPluginOptions } from './options.js';
import {
  cssFuse,
  cssMinifier,
  directives,
  dirtyMask,
  domPaths,
  elemProxy,
  eventHoist,
  htmlAot,
  htmlFuse,
  htmlMinifier,
  litCssFuse,
  litCssMinifier,
  litDirectives,
  litDirtyMask,
  litDomPaths,
  litElemProxy,
  litEventHoist,
  litHtmlAot,
  litHtmlFuse,
  litHtmlMinifier,
  litMemoize,
  litNative,
  litPropsLower,
  litSsr,
  litTagShake,
  litVirtual,
  litVirtualPlugin,
  memoize,
  native,
  propsLower,
  ssr,
  tagShake,
} from './plugins/index.js';

export function litCoreVitePlugin(options: LitPluginOptions = {}): Plugin[] {
  const plugins: Plugin[] = [];

  // Stage 0: Universal virtual module resolver
  if (options.virtual) {
    plugins.push(litVirtual());
  }

  // Stage 1: Cross-component styling and template extraction
  const { cssFuse: cssFuseOpt = true } = options;
  if (cssFuseOpt !== false) {
    const fuseOpts = typeof cssFuseOpt === 'object' ? cssFuseOpt : {};
    plugins.push(cssFuse(fuseOpts));
  }

  // html-fuse is strictly opt-in and disabled by default due to negative compression savings
  const htmlFuseOpt = options.htmlFuse ?? options['html-fuse'];
  if (htmlFuseOpt) {
    const fuseOpts = typeof htmlFuseOpt === 'object' ? htmlFuseOpt : {};
    plugins.push(htmlFuse(fuseOpts));
  }

  // Stage 2: Primitives and syntax normalization
  const propsLowerOpt = options.propsLower ?? options['props-lower'];
  if (propsLowerOpt) {
    const lowerOpts = typeof propsLowerOpt === 'object' ? propsLowerOpt : {};
    plugins.push(propsLower(lowerOpts));
  }

  const elemProxyOpt = options.elemProxy ?? options['elem-proxy'];
  if (elemProxyOpt) {
    const proxyOpts = typeof elemProxyOpt === 'object' ? elemProxyOpt : {};
    plugins.push(elemProxy(proxyOpts));
  }

  const directivesOpt = options.directives;
  if (directivesOpt) {
    const directivesOpts = typeof directivesOpt === 'object' ? directivesOpt : {};
    plugins.push(directives(directivesOpts));
  }

  // Stage 3: Reactive template AST optimizations
  const domPathsOpt = options.domPaths ?? options['dom-paths'];
  if (domPathsOpt) {
    const pathsOpts = typeof domPathsOpt === 'object' ? domPathsOpt : {};
    plugins.push(domPaths(pathsOpts));
  }

  const dirtyMaskOpt = options.dirtyMask ?? options['dirty-mask'];
  if (dirtyMaskOpt) {
    const maskOpts = typeof dirtyMaskOpt === 'object' ? dirtyMaskOpt : {};
    plugins.push(dirtyMask(maskOpts));
  }
  const memoizeOpt = options.memoize;
  if (memoizeOpt) {
    const memoizeOpts = typeof memoizeOpt === 'object' ? memoizeOpt : {};
    plugins.push(memoize(memoizeOpts));
  }

  // eventHoist placed at end of Stage 3 to prevent lifecycle collisions with domPaths and dirtyMask
  const eventHoistOpt = options.eventHoist ?? options['event-hoist'];
  if (eventHoistOpt) {
    const hoistOpts = typeof eventHoistOpt === 'object' ? eventHoistOpt : {};
    plugins.push(eventHoist(hoistOpts));
  }

  // Stage 4: Minification and AOT compilation
  const cssMinifierOpt = options.cssMinifier ?? options['css-minifier'];
  if (cssMinifierOpt) {
    const minifierOpts = typeof cssMinifierOpt === 'object' ? cssMinifierOpt : {};
    plugins.push(cssMinifier(minifierOpts));
  }

  // htmlMinifier runs before htmlAot so templates are minified prior to static AST descriptor serialization
  const minifierOpt = options.htmlMinifier ?? options['html-minifier'];
  if (minifierOpt) {
    const minifierOpts = typeof minifierOpt === 'object' ? minifierOpt : {};
    plugins.push(htmlMinifier(minifierOpts));
  }

  const htmlAotOpt = options.htmlAot ?? options['html-aot'];
  if (htmlAotOpt) {
    const aotOpts = typeof htmlAotOpt === 'object' ? htmlAotOpt : {};
    plugins.push(htmlAot(aotOpts));
  }

  const nativeOpt = options.native;
  if (nativeOpt) {
    const nativeOpts = typeof nativeOpt === 'object' ? nativeOpt : {};
    plugins.push(native(nativeOpts));
  }

  // Stage 5: Post-bundle pruning and rendering (all enforce: 'post')
  const tagShakeOpt = options.tagShake ?? options['tag-shake'];
  if (tagShakeOpt) {
    const shakeOpts = typeof tagShakeOpt === 'object' ? tagShakeOpt : {};
    plugins.push(tagShake(shakeOpts));
  }

  const ssrOpt = options.ssr ?? options['lit-ssr'];
  if (ssrOpt) {
    const ssrOpts = typeof ssrOpt === 'object' ? ssrOpt : {};
    plugins.push(ssr(ssrOpts));
  }

  const ssrResumable = typeof ssrOpt === 'object' && ssrOpt !== null && Boolean(ssrOpt.resumable);
  const resumableOpt = options.resumable ?? (ssrResumable ? true : undefined);
  if (resumableOpt) {
    const resumableOpts = typeof resumableOpt === 'object' ? resumableOpt : {};
    plugins.push(litResumablePlugin(resumableOpts));
  }

  return plugins;
}

export const LitCoreVitePlugin = litCoreVitePlugin;
export const lit = litCoreVitePlugin;
export const litCore = litCoreVitePlugin;
export const resumable = litResumablePlugin;
export const litResumable = litResumablePlugin;

export {
  cssFuse,
  cssMinifier,
  directives,
  dirtyMask,
  domPaths,
  elemProxy,
  eventHoist,
  htmlAot,
  htmlFuse,
  htmlMinifier,
  litCssFuse,
  litCssMinifier,
  litDirectives,
  litDirtyMask,
  litDomPaths,
  litElemProxy,
  litEventHoist,
  litHtmlAot,
  litHtmlFuse,
  litHtmlMinifier,
  litMemoize,
  litNative,
  litPropsLower,
  litSsr,
  litTagShake,
  litVirtual,
  litVirtualPlugin,
  memoize,
  native,
  propsLower,
  ssr,
  tagShake,
};

export default litCoreVitePlugin;
