import lit from '@lit-core/vite-plugin';

/**
 * Normalize an includePattern from SuiteContext into an array or undefined.
 * @param {string | string[] | undefined} pattern
 * @returns {string[] | undefined}
 */
export function normalizeInclude(pattern) {
  if (!pattern) return undefined;
  return Array.isArray(pattern) ? pattern : [pattern];
}

/**
 * Helper to create a single-tool Vite plugin runner that disables all other lit-core features.
 * Ensures consistent, clean, and DRY isolation testing across all benchmark tools.
 * @param {string} toolKey Property name on LitCorePluginOptions (e.g. 'cssFuse', 'htmlAot')
 * @param {any} toolOptions Options to pass to that tool feature
 * @returns {import('vite').Plugin[]}
 */
export function createIsolatedToolPlugin(toolKey, toolOptions) {
  const allFeatures = ['cssFuse', 'htmlFuse', 'propsLower', 'elemProxy', 'native', 'eventHoist', 'htmlAot', 'cssMinifier', 'htmlMinifier'];

  /** @type {Record<string, any>} */
  const config = {};
  for (const feature of allFeatures) {
    config[feature] = feature === toolKey ? toolOptions : false;
  }

  return lit(config);
}
