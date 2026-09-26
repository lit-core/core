import { webAwesomeSuite } from './webawesome.js';
import { webAwesomeFormsSuite, webAwesomeOverlaysSuite } from './webawesome-subsets.js';
import { litDecoratorsSuite } from './lit-decorators.js';
import { createCustomSuite } from './custom.js';

/**
 * All preconfigured benchmark suites.
 * @type {import('../types.js').BenchmarkSuite[]}
 */
export const registeredSuites = [
  webAwesomeSuite,
  webAwesomeFormsSuite,
  webAwesomeOverlaysSuite,
  litDecoratorsSuite,
];

/**
 * Get benchmark suites to run based on filter argument or custom options.
 * @param {string} [suiteFilter] 'all', 'webawesome', 'forms', 'overlays', or comma-separated list
 * @param {Object} [customOptions]
 * @param {string} [customOptions.entry]
 * @param {string} [customOptions.include]
 * @param {string} [customOptions.name]
 * @returns {import('../types.js').BenchmarkSuite[]}
 */
export function getSuites(suiteFilter, customOptions = {}) {
  if (customOptions.entry) {
    const custom = createCustomSuite(customOptions);
    if (custom.isAvailable()) {
      return [custom];
    }
  }

  if (!suiteFilter || suiteFilter === 'all') {
    return registeredSuites.filter((s) => s.isAvailable());
  }

  const ids = suiteFilter.split(',').map((s) => s.trim().toLowerCase());
  return registeredSuites.filter((s) => {
    const id = s.id.toLowerCase();
    return ids.includes(id) || (ids.includes('forms') && id.includes('forms')) || (ids.includes('overlays') && id.includes('overlays'));
  });
}
