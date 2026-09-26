import { webAwesomeSuite } from './webawesome.js';
import { materialSuite } from './material.js';
import { carbonSuite } from './carbon.js';
import { spectrumSuite } from './spectrum.js';
import { createCustomSuite } from './custom.js';

/**
 * All production library benchmark suites.
 * @type {import('../types.js').BenchmarkSuite[]}
 */
export const registeredSuites = [
  webAwesomeSuite,
  materialSuite,
  carbonSuite,
  spectrumSuite,
];

/**
 * Get benchmark suites to run based on filter argument or custom options.
 * @param {string} [suiteFilter] 'all', 'webawesome', 'material', 'carbon', 'spectrum', or comma-separated list
 * @param {Object} [customOptions]
 * @param {string} [customOptions.entry]
 * @param {string} [customOptions.include]
 * @param {string} [customOptions.name]
 * @returns {import('../types.js').BenchmarkSuite[]}
 */
export function getSuites(suiteFilter, customOptions = {}) {
  if (customOptions && customOptions.entry) {
    const custom = createCustomSuite({
      entry: customOptions.entry,
      include: customOptions.include,
      name: customOptions.name,
    });
    if (custom.isAvailable()) {
      return [custom];
    }
  }

  if (!suiteFilter || suiteFilter === 'all') {
    return registeredSuites.filter((s) => s.isAvailable());
  }

  const ids = suiteFilter.split(',').map((s) => s.trim().toLowerCase());
  return registeredSuites.filter((s) => ids.includes(s.id.toLowerCase()));
}
