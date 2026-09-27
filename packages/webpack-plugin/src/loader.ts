import fs from 'node:fs';
import path from 'node:path';
import type { LoaderContext } from 'webpack';
import type { CssMinifierOptions, ElemProxyOptions, HtmlAotOptions, HtmlMinifierOptions, LitPluginOptions, PropsLowerOptions } from './options.js';
import { transformCssMinifier, transformElemProxy, transformHtmlAot, transformHtmlMinifier, transformPropsLower } from './transforms.js';

export interface PluginState {
  transformedFiles: Map<string, string>;
  virtualSheets: Map<string, string>;
  virtualTemplates?: Map<string, string>;
  options: LitPluginOptions;
}

const pluginRegistry = new Map<string, PluginState>();

export function registerPluginState(id: string, state: PluginState) {
  pluginRegistry.set(id, state);
}

export function unregisterPluginState(id: string) {
  pluginRegistry.delete(id);
}

export function getPluginState(id: string): PluginState | undefined {
  return pluginRegistry.get(id);
}

export interface LitLoaderOptions {
  pluginId?: string;
  options?: LitPluginOptions;
}

export default function litWebpackLoader(
  this: LoaderContext<LitLoaderOptions>,
  source: string,
  // biome-ignore lint/suspicious/noExplicitAny: Webpack sourcemap object or string
  inputSourceMap?: any,
) {
  const callback = this.async();
  const loaderOptions = this.getOptions() || {};
  const pluginId = loaderOptions.pluginId;
  const pluginState = pluginId ? getPluginState(pluginId) : undefined;
  const options = pluginState?.options || loaderOptions.options || {};

  const resourcePath = this.resourcePath;
  let currentSource = source;
  let currentMap = inputSourceMap;

  // 1. Apply css-fuse rewritten code if available for this component
  if (pluginState && options.cssFuse !== false) {
    const cleanId = resourcePath.split('?')[0];
    let transformed = pluginState.transformedFiles.get(cleanId);
    if (!transformed) {
      const abs = path.resolve(cleanId);
      transformed = pluginState.transformedFiles.get(abs);
      if (!transformed) {
        try {
          const real = fs.realpathSync(abs);
          transformed = pluginState.transformedFiles.get(real);
        } catch {}
      }
    }
    if (transformed) {
      currentSource = transformed;
      currentMap = null;
    }
  }

  // 2. Apply props-lower AOT lowering if enabled
  const propsLowerOpt = options.propsLower ?? options['props-lower'];
  if (propsLowerOpt) {
    const propsOpts: PropsLowerOptions = typeof propsLowerOpt === 'object' ? propsLowerOpt : {};
    const result = transformPropsLower(currentSource, resourcePath, propsOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 3. Apply elem-proxy AOT proxy stub optimization if enabled
  const elemProxyOpt = options.elemProxy ?? options['elem-proxy'];
  if (elemProxyOpt) {
    const proxyOpts: ElemProxyOptions = typeof elemProxyOpt === 'object' ? elemProxyOpt : {};
    const result = transformElemProxy(currentSource, resourcePath, proxyOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 4. Apply css-minifier embedded CSS minification if enabled
  const cssMinifierOpt = options.cssMinifier ?? options['css-minifier'];
  if (cssMinifierOpt) {
    const cssOpts: CssMinifierOptions = typeof cssMinifierOpt === 'object' ? cssMinifierOpt : {};
    const result = transformCssMinifier(currentSource, resourcePath, cssOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 4. Apply html-aot template compilation if enabled
  const htmlAotOpt = options.htmlAot ?? options['html-aot'];
  if (htmlAotOpt) {
    const aotOpts: HtmlAotOptions = typeof htmlAotOpt === 'object' ? htmlAotOpt : {};
    const result = transformHtmlAot(currentSource, resourcePath, aotOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 5. Apply html-minifier template minification if enabled
  const htmlMinifierOpt = options.htmlMinifier ?? options['html-minifier'];
  if (htmlMinifierOpt) {
    const htmlOpts: HtmlMinifierOptions = typeof htmlMinifierOpt === 'object' ? htmlMinifierOpt : {};
    const result = transformHtmlMinifier(currentSource, resourcePath, htmlOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  callback(null, currentSource, currentMap);
}
