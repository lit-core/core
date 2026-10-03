import { lit } from '@lit-core/vite-plugin';
import { normalizeInclude } from './base.js';
import { cssFuseTool } from './css-fuse.js';
import { cssMinifierTool } from './css-minifier.js';
import { directivesTool } from './directives.js';
import { dirtyMaskTool } from './dirty-mask.js';
import { domPathsTool } from './dom-paths.js';
import { elemProxyTool } from './elem-proxy.js';
import { eventHoistTool } from './event-hoist.js';
import { htmlAotTool } from './html-aot.js';
import { htmlFuseTool } from './html-fuse.js';
import { htmlMinifierTool } from './html-minifier.js';
import { memoizeTool } from './memoize.js';
import { nativeTool } from './native.js';
import { propsLowerTool } from './props-lower.js';
import { resumableTool } from './resumable.js';
import { tagShakeTool } from './tag-shake.js';

/**
 * Array of all registered Vite bundler optimization tools.
 * @type {import('../types.js').BenchmarkTool[]}
 */
export const registeredTools = [
  cssFuseTool,
  htmlFuseTool,
  propsLowerTool,
  elemProxyTool,
  nativeTool,
  eventHoistTool,
  htmlAotTool,
  cssMinifierTool,
  htmlMinifierTool,
  dirtyMaskTool,
  domPathsTool,
  memoizeTool,
  directivesTool,
  resumableTool,
  tagShakeTool,
];

/**
 * Get active tools (optionally filtered by IDs).
 * @param {string[]} [filterIds]
 * @returns {import('../types.js').BenchmarkTool[]}
 */
export function getActiveTools(filterIds) {
  if (filterIds && filterIds.length > 0) {
    return registeredTools.filter((t) => filterIds.includes(t.id));
  }
  return registeredTools.filter((t) => t.enabled);
}

/**
 * Combine plugins from all active tools to produce the "TOTAL" bundle.
 * @param {import('../types.js').BenchmarkTool[]} tools
 * @param {import('../types.js').SuiteContext} suite
 * @returns {Promise<import('vite').Plugin[]>}
 */
export async function getCombinedPlugins(tools, suite) {
  /** @param {string} id */
  const hasTool = (id) => tools.some((t) => t.id === id);
  const include = normalizeInclude(suite.includePattern);

  const isAll = tools.length > 3;

  return lit({
    cssFuse: hasTool('css-fuse')
      ? {
          include,
          exclude: [],
          threshold: 2,
          applyInDev: true,
        }
      : false,
    htmlFuse: hasTool('html-fuse')
      ? {
          include,
          exclude: [],
          threshold: 2,
          minFragmentLength: 15,
        }
      : false,
    propsLower: hasTool('props-lower')
      ? {
          include,
          exclude: [],
        }
      : false,
    elemProxy:
      hasTool('elem-proxy') && !isAll
        ? {
            include,
            exclude: [],
          }
        : false,
    native:
      hasTool('native') && !isAll
        ? {
            include,
            exclude: [],
          }
        : false,
    eventHoist: hasTool('event-hoist')
      ? {
          include,
          exclude: [],
        }
      : false,
    htmlAot: hasTool('html-aot')
      ? {
          include,
          exclude: [],
        }
      : false,
    cssMinifier: hasTool('css-minifier')
      ? {
          include,
          exclude: [],
        }
      : false,
    htmlMinifier: hasTool('html-minifier')
      ? {
          include,
          exclude: [],
        }
      : false,
    dirtyMask: hasTool('dirty-mask')
      ? {
          include,
          exclude: [],
        }
      : false,
    domPaths: hasTool('dom-paths')
      ? {
          include,
          exclude: [],
          normalizeWhitespace: true,
        }
      : false,
    memoize: hasTool('memoize')
      ? {
          include,
          exclude: [],
        }
      : false,
    directives: hasTool('directives')
      ? {
          include,
          exclude: [],
        }
      : false,
    resumable: hasTool('resumable')
      ? {
          include,
          exclude: [],
          preloadOnHover: true,
          injectAdapter: !isAll,
        }
      : false,
    tagShake: hasTool('tag-shake')
      ? {
          include,
          exclude: [],
        }
      : false,
  });
}

export {
  cssFuseTool,
  cssMinifierTool,
  directivesTool,
  dirtyMaskTool,
  domPathsTool,
  elemProxyTool,
  eventHoistTool,
  htmlAotTool,
  htmlFuseTool,
  htmlMinifierTool,
  memoizeTool,
  nativeTool,
  propsLowerTool,
  resumableTool,
  tagShakeTool,
};
