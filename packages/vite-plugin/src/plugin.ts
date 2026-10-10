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
  litTagShake,
  litVirtual,
  litVirtualPlugin,
  memoize,
  native,
  propsLower,
  tagShake,
} from './plugins/index.js';

export function litCoreVitePlugin(options: LitPluginOptions = {}): Plugin[] {
  const plugins: Plugin[] = [];

  if (options.virtual) {
    plugins.push(litVirtual());
  }

  const { cssFuse: cssFuseOpt = true } = options;
  if (cssFuseOpt !== false) {
    const fuseOpts = typeof cssFuseOpt === 'object' ? cssFuseOpt : {};
    plugins.push(cssFuse(fuseOpts));
  }

  const htmlFuseOpt = options.htmlFuse ?? options['html-fuse'];
  if (htmlFuseOpt) {
    const fuseOpts = typeof htmlFuseOpt === 'object' ? htmlFuseOpt : {};
    plugins.push(htmlFuse(fuseOpts));
  }

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

  const nativeOpt = options.native;
  if (nativeOpt) {
    const nativeOpts = typeof nativeOpt === 'object' ? nativeOpt : {};
    plugins.push(native(nativeOpts));
  }

  const eventHoistOpt = options.eventHoist ?? options['event-hoist'];
  if (eventHoistOpt) {
    const hoistOpts = typeof eventHoistOpt === 'object' ? eventHoistOpt : {};
    plugins.push(eventHoist(hoistOpts));
  }

  const dirtyMaskOpt = options.dirtyMask ?? options['dirty-mask'];
  if (dirtyMaskOpt) {
    const maskOpts = typeof dirtyMaskOpt === 'object' ? dirtyMaskOpt : {};
    plugins.push(dirtyMask(maskOpts));
  }

  const domPathsOpt = options.domPaths ?? options['dom-paths'];
  if (domPathsOpt) {
    const pathsOpts = typeof domPathsOpt === 'object' ? domPathsOpt : {};
    plugins.push(domPaths(pathsOpts));
  }

  const memoizeOpt = options.memoize;
  if (memoizeOpt) {
    const memoizeOpts = typeof memoizeOpt === 'object' ? memoizeOpt : {};
    plugins.push(memoize(memoizeOpts));
  }

  const directivesOpt = options.directives;
  if (directivesOpt) {
    const directivesOpts = typeof directivesOpt === 'object' ? directivesOpt : {};
    plugins.push(directives(directivesOpts));
  }

  const htmlAotOpt = options.htmlAot ?? options['html-aot'];
  if (htmlAotOpt) {
    const aotOpts = typeof htmlAotOpt === 'object' ? htmlAotOpt : {};
    plugins.push(htmlAot(aotOpts));
  }

  const cssMinifierOpt = options.cssMinifier ?? options['css-minifier'];
  if (cssMinifierOpt) {
    const minifierOpts = typeof cssMinifierOpt === 'object' ? cssMinifierOpt : {};
    plugins.push(cssMinifier(minifierOpts));
  }

  const minifierOpt = options.htmlMinifier ?? options['html-minifier'];
  if (minifierOpt) {
    const minifierOpts = typeof minifierOpt === 'object' ? minifierOpt : {};
    plugins.push(htmlMinifier(minifierOpts));
  }

  const resumableOpt = options.resumable;
  if (resumableOpt) {
    const resumableOpts = typeof resumableOpt === 'object' ? resumableOpt : {};
    plugins.push(litResumablePlugin(resumableOpts));
  }

  const tagShakeOpt = options.tagShake ?? options['tag-shake'];
  if (tagShakeOpt) {
    const shakeOpts = typeof tagShakeOpt === 'object' ? tagShakeOpt : {};
    plugins.push(tagShake(shakeOpts));
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
  litTagShake,
  litVirtual,
  litVirtualPlugin,
  memoize,
  native,
  propsLower,
  tagShake,
};

export default litCoreVitePlugin;
