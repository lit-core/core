/**
 * @typedef {Object} SuiteContext
 * @property {string} id
 * @property {string} name
 * @property {string} entryPath
 * @property {string | string[]} [includePattern]
 * @property {number} componentCount
 * @property {Record<string, any>} [metadata]
 */

/**
 * @typedef {Object} BenchmarkTool
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {boolean} enabled
 * @property {(suite: SuiteContext) => import('vite').Plugin[] | Promise<import('vite').Plugin[]>} getPlugins
 * @property {(suite: SuiteContext) => Promise<Record<string, any> | null>} [getDiagnostics]
 */

/**
 * @typedef {Object} BenchmarkSuite
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {() => boolean} isAvailable
 * @property {() => Promise<SuiteContext>} setup
 * @property {() => Promise<void>} cleanup
 */

/**
 * @typedef {Object} RuntimeRow
 * @property {string} name
 * @property {number} firstRenderMs
 * @property {number} updateMs
 * @property {number} [speedupPercent]
 * @property {boolean} [isBaseline]
 * @property {boolean} [isTotal]
 */

/**
 * @typedef {import('./table.js').TableRow[] & {
 *   diagnostics?: Record<string, any>;
 *   suiteContext: SuiteContext;
 *   runtimeRows?: RuntimeRow[];
 * }} SuiteBenchmarkResult
 */

export {};
