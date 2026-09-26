import { cssFuseTool } from './css-fuse.js';
import { propsLowerTool } from './props-lower.js';
import { lit } from '@lit-core/vite-plugin';

/**
 * Array of all registered Vite bundler optimization tools.
 * @type {import('../types.js').BenchmarkTool[]}
 */
export const registeredTools = [
  cssFuseTool,
  propsLowerTool,
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
  const hasCssFuse = tools.some((t) => t.id === 'css-fuse');
  const hasPropsLower = tools.some((t) => t.id === 'props-lower');

  const include = Array.isArray(suite.includePattern)
    ? suite.includePattern
    : suite.includePattern
      ? [suite.includePattern]
      : undefined;

  return lit({
    cssFuse: hasCssFuse
      ? {
          include,
          exclude: [],
          threshold: 2,
          applyInDev: true,
        }
      : false,
    propsLower: hasPropsLower,
  });
}
