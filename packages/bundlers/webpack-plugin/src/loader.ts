import fs from 'node:fs';
import path from 'node:path';
import { splitServerElement } from '@lit-core/server-split';
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
  SsrOptions,
  TagShakeOptions,
} from './options.js';
import { isSsrTarget } from './plugin.js';
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
  transformSsr,
  transformTagShakePlugin,
} from './transforms.js';

export const LIT_SERVER_ELEMENTS_FAST_CHECK = /@(?:loader|action)\b|\bfrom\s*['"]@lit-core\/server-elements(?:['"]|\/)/;

export interface DiscoveredServerElement {
  tagName?: string;
  className?: string;
  filePath: string;
  clientChunk?: string;
  serverChunk?: string;
  zeroLit: boolean;
  actions: any[];
  loaders: any[];
}

export interface PluginState {
  transformedFiles: Map<string, string>;
  virtualSheets: Map<string, string>;
  virtualTemplates?: Map<string, string>;
  usedTags?: Set<string>;
  isSsr?: boolean;
  options: LitPluginOptions;
  serverElements?: Map<string, DiscoveredServerElement>;
  actionIndex?: Map<string, { tag: string; filePath: string }>;
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

  try {
    if (pluginState) {
      if (!pluginState.usedTags) {
        pluginState.usedTags = new Set();
      }
      scanAppTags(source, resourcePath, pluginState.usedTags);
    }

    // 1. Apply css-fuse rewritten code if available for this component
    if (pluginState && (options.cssFuse !== false || Boolean(options.htmlFuse || options['html-fuse']))) {
      const cleanId = resourcePath.split('?')[0];
      let transformed = pluginState.transformedFiles.get(cleanId);
      if (!transformed) {
        const abs = path.resolve(cleanId);
        transformed = pluginState.transformedFiles.get(abs);
        if (!transformed) {
          if (fs.existsSync(abs)) {
            try {
              const real = fs.realpathSync(abs);
              transformed = pluginState.transformedFiles.get(real);
            } catch {}
          }
        }
      }
      if (transformed) {
        currentSource = transformed;
        currentMap = null;
      }
    }

    // Stage 0.5: Lit server elements splitting and schema validation
    const serverElementsOpt = options.serverElements ?? options['server-elements'];
    if (serverElementsOpt !== false && LIT_SERVER_ELEMENTS_FAST_CHECK.test(currentSource)) {
      const isTargetServer = pluginState ? Boolean(pluginState.isSsr) : isSsrTarget(this.target);
      const isServer =
        typeof serverElementsOpt === 'object' && serverElementsOpt.target && serverElementsOpt.target !== 'auto'
          ? serverElementsOpt.target === 'server' || serverElementsOpt.target === 'worker'
          : isTargetServer;

      const actionRoutePrefix = typeof serverElementsOpt === 'object' && serverElementsOpt.actionRoutePrefix ? serverElementsOpt.actionRoutePrefix : '/_lit/a/';

      const splitResult = splitServerElement(currentSource, {
        filename: resourcePath,
        sourcemap: Boolean((options as any).sourcemap),
        actionRoutePrefix,
      });

      if (splitResult.hasErrors) {
        const errorDiag = splitResult.diagnostics.find((d) => d.severity === 'error') || splitResult.diagnostics[0];
        const msg = errorDiag ? `[${errorDiag.code}] ${errorDiag.message}` : 'Server element validation failed';
        return callback(new Error(`[@lit-core/webpack-plugin] ${msg}`));
      }

      if (splitResult.isServerElement) {
        if (pluginState) {
          if (!pluginState.serverElements) {
            pluginState.serverElements = new Map();
          }
          if (!pluginState.actionIndex) {
            pluginState.actionIndex = new Map();
          }
          const cleanId = resourcePath.split('?')[0];
          const isZeroLit = Boolean(splitResult.zeroLit);
          pluginState.serverElements.set(cleanId, {
            tagName: splitResult.tagName,
            className: splitResult.className,
            filePath: cleanId,
            zeroLit: isZeroLit,
            actions: splitResult.actions,
            loaders: splitResult.loaders,
          });
          if (splitResult.tagName) {
            for (const act of splitResult.actions) {
              pluginState.actionIndex.set(act.hash, { tag: splitResult.tagName, filePath: cleanId });
            }
          }
        }

        if (isServer) {
          currentSource = splitResult.workerCode;
          currentMap = splitResult.workerMap ? (typeof splitResult.workerMap === 'string' ? JSON.parse(splitResult.workerMap) : splitResult.workerMap) : currentMap;
        } else {
          currentSource = splitResult.clientCode;
          currentMap = splitResult.clientMap ? (typeof splitResult.clientMap === 'string' ? JSON.parse(splitResult.clientMap) : splitResult.clientMap) : currentMap;
        }
      }
    }

    // Stage 1: Primitives and syntax normalization
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

    // 4. Apply directives AOT lowering if enabled
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

    // Stage 3: Reactive template AST optimizations
    // Stage 3: Reactive template AST optimizations
    // 5. Apply dom-paths AOT structural DOM path compilation if enabled
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

    // 6. Apply dirty-mask AOT bitmasking if enabled
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

    // 8. Apply event-hoist AOT ShadowRoot event delegation if enabled
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

    // Stage 4: Minification and AOT compilation
    // 9. Apply css-minifier embedded CSS minification if enabled
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

    // 10. Apply html-minifier template minification if enabled
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

    // 11. Apply html-aot template compilation if enabled (or auto-enabled on client resumable builds)
    const isServerForAot = Boolean(pluginState ? pluginState.isSsr : isSsrTarget(this.target));
    const ssrOptForAot = options.ssr ?? options['lit-ssr'];
    const ssrResumableForAot = typeof ssrOptForAot === 'object' && ssrOptForAot !== null && Boolean(ssrOptForAot.resumable);
    const resumableActiveForAot = Boolean(options.resumable ?? (ssrResumableForAot && !isServerForAot ? true : undefined));
    const htmlAotOpt = options.htmlAot ?? options['html-aot'];
    if (htmlAotOpt || (resumableActiveForAot && !isServerForAot && htmlAotOpt !== false)) {
      const rawAotOpts: HtmlAotOptions = typeof htmlAotOpt === 'object' ? htmlAotOpt : {};
      const effectiveAotSsr = rawAotOpts.ssr ?? isServerForAot;
      const aotOpts: HtmlAotOptions = {
        ...rawAotOpts,
        ssr: effectiveAotSsr,
        strictSsr: rawAotOpts.strictSsr ?? effectiveAotSsr,
      };
      const result = transformHtmlAot(currentSource, resourcePath, aotOpts);
      if (result) {
        currentSource = result.code;
        if (result.map) {
          currentMap = result.map;
        }
      }
    }

    // 12. Apply native AOT vanilla / micro-runtime compiler if enabled
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

    // Stage 5: Post-bundle pruning and rendering
    // 13. Apply tag-shake AOT dead code elimination if enabled
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

    // 14. Apply SSR ahead-of-time transform if enabled
    const ssrOpt = options.ssr ?? options['lit-ssr'];
    const isSsr = Boolean(pluginState?.isSsr);
    if (ssrOpt) {
      const ssrOpts: SsrOptions = typeof ssrOpt === 'object' ? ssrOpt : {};
      const result = transformSsr(currentSource, resourcePath, { ...ssrOpts, ssrMode: isSsr });
      if (result) {
        currentSource = result.code;
        if (result.map) {
          currentMap = result.map;
        }
      }
    }

    callback(null, currentSource, currentMap);
  } catch (err: any) {
    const origMessage = err instanceof Error ? err.message : String(err);
    const error = new Error(`[lit-webpack-loader] Failed processing ${resourcePath}: ${origMessage}`);
    if (err instanceof Error && err.stack) {
      error.stack = err.stack;
    }
    if (err && typeof err === 'object') {
      Object.assign(error, err);
    }
    callback(error);
  }
}
