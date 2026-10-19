import { carbonSuite } from './carbon.js';
import { createCustomSuite } from './custom.js';
import { materialSuite } from './material.js';
import { momentumSuite } from './momentum.js';
import { spectrumSuite } from './spectrum.js';
import { webAwesomeSuite } from './webawesome.js';

/**
 * All production library benchmark suites.
 * @type {import('../types.js').BenchmarkSuite[]}
 */
export const registeredSuites = [webAwesomeSuite, materialSuite, carbonSuite, spectrumSuite, momentumSuite];

/**
 * Get benchmark suites to run based on filter argument or custom options.
 * @param {string} [suiteFilter] 'all', 'webawesome', 'material', 'carbon', 'spectrum', 'momentum', or comma-separated list
 * @param {Object} [customOptions]
 * @param {string} [customOptions.entry]
 * @param {string} [customOptions.include]
 * @param {string} [customOptions.name]
 * @returns {import('../types.js').BenchmarkSuite[]}
 */
export function getSuites(suiteFilter, customOptions = {}) {
  if (customOptions?.entry) {
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

export { carbonSuite, createCustomSuite, materialSuite, momentumSuite, spectrumSuite, webAwesomeSuite };
