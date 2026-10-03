import fs from 'node:fs';
import path from 'node:path';
import type { LoaderContext } from 'webpack';
import type {
  CssMinifierOptions,
  DirectivesOptions,
  DirtyMaskOptions,
  DomPathsOptions,
  ElemProxyOptions,
  EventHoistOptions,
  HtmlAotOptions,
  HtmlMinifierOptions,
  LitPluginOptions,
  MemoizeOptions,
  NativeOptions,
  PropsLowerOptions,
  ResumableOptions,
  TagShakeOptions,
} from './options.js';
import {
  scanAppTags,
  transformCssMinifier,
  transformDirectivesPlugin,
  transformDirtyMaskPlugin,
  transformDomPathsPlugin,
  transformElemProxy,
  transformEventHoistPlugin,
  transformHtmlAot,
  transformHtmlMinifier,
  transformMemoizePlugin,
  transformNativePlugin,
  transformPropsLower,
  transformResumable,
  transformTagShakePlugin,
} from './transforms.js';

export interface PluginState {
  transformedFiles: Map<string, string>;
  virtualSheets: Map<string, string>;
  virtualTemplates?: Map<string, string>;
  usedTags?: Set<string>;
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

export default function litWebpackLoader(this: LoaderContext<LitLoaderOptions>, source: string, inputSourceMap?: any) {
  const callback = this.async();
  const loaderOptions = this.getOptions() || {};
  const pluginId = loaderOptions.pluginId;
  const pluginState = pluginId ? getPluginState(pluginId) : undefined;
  const options = pluginState?.options || loaderOptions.options || {};

  const resourcePath = this.resourcePath;
  let currentSource = source;
  let currentMap = inputSourceMap;

  if (pluginState) {
    if (!pluginState.usedTags) {
      pluginState.usedTags = new Set();
    }
    scanAppTags(source, resourcePath, pluginState.usedTags);
  }

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

  // 3.5. Apply native AOT vanilla / micro-runtime compiler if enabled
  const nativeOpt = options.native ?? options['native-compile'];
  if (nativeOpt) {
    const nativeOpts: NativeOptions = typeof nativeOpt === 'object' ? nativeOpt : {};
    const result = transformNativePlugin(currentSource, resourcePath, nativeOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 4. Apply event-hoist AOT ShadowRoot event delegation if enabled
  const eventHoistOpt = options.eventHoist ?? options['event-hoist'];
  if (eventHoistOpt) {
    const hoistOpts: EventHoistOptions = typeof eventHoistOpt === 'object' ? eventHoistOpt : {};
    const result = transformEventHoistPlugin(currentSource, resourcePath, hoistOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 5. Apply dirty-mask AOT bitmasking if enabled
  const dirtyMaskOpt = options.dirtyMask ?? options['dirty-mask'];
  if (dirtyMaskOpt) {
    const maskOpts: DirtyMaskOptions = typeof dirtyMaskOpt === 'object' ? dirtyMaskOpt : {};
    const result = transformDirtyMaskPlugin(currentSource, resourcePath, maskOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 6. Apply dom-paths AOT structural DOM path compilation if enabled
  const domPathsOpt = options.domPaths ?? options['dom-paths'];
  if (domPathsOpt) {
    const domOpts: DomPathsOptions = typeof domPathsOpt === 'object' ? domPathsOpt : {};
    const result = transformDomPathsPlugin(currentSource, resourcePath, domOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 7. Apply memoize auto-memoization if enabled
  const memoizeOpt = options.memoize;
  if (memoizeOpt) {
    const memoizeOpts: MemoizeOptions = typeof memoizeOpt === 'object' ? memoizeOpt : {};
    const result = transformMemoizePlugin(currentSource, resourcePath, memoizeOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 8. Apply directives AOT lowering if enabled
  const directivesOpt = options.directives;
  if (directivesOpt) {
    const directivesOpts: DirectivesOptions = typeof directivesOpt === 'object' ? directivesOpt : {};
    const result = transformDirectivesPlugin(currentSource, resourcePath, directivesOpts);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  // 7. Apply css-minifier embedded CSS minification if enabled
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

  // 6. Apply resumable client adapter injection if enabled
  const resumableOpt = options.resumable;
  if (resumableOpt) {
    const resumableOpts: ResumableOptions = typeof resumableOpt === 'object' ? resumableOpt : {};
    const result = transformResumable(currentSource, resourcePath, resumableOpts);
    if (result) {
      currentSource = result.code;
    }
  }

  // 7. Apply tag-shake AOT dead code elimination if enabled
  const tagShakeOpt = options.tagShake ?? options['tag-shake'];
  if (tagShakeOpt) {
    const shakeOpts: TagShakeOptions = typeof tagShakeOpt === 'object' ? tagShakeOpt : {};
    const usedSet = pluginState?.usedTags || new Set(shakeOpts.keepTags || []);
    if (shakeOpts.keepTags) {
      for (const t of shakeOpts.keepTags) {
        usedSet.add(t);
      }
    }
    const result = transformTagShakePlugin(currentSource, resourcePath, shakeOpts, usedSet);
    if (result) {
      currentSource = result.code;
      if (result.map) {
        currentMap = result.map;
      }
    }
  }

  callback(null, currentSource, currentMap);
}
