/**
 * @typedef {Object} SuiteContext
 * @property {string} id
 * @property {string} name
 * @property {string} entryPath
 * @property {string | string[]} [includePattern]
 * @property {number} componentCount
 * @property {string} [packageName]
 * @property {string} [version]
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
 * @property {string} [packageName]
 * @property {() => boolean} isAvailable
 * @property {() => Promise<SuiteContext>} setup
 * @property {() => Promise<void>} cleanup
 */

/**
 * @typedef {Object} RuntimeRow
 * @property {string} name
 * @property {number} firstRenderMs
 * @property {number} updateMs
 * @property {number} [scriptEvalMs]
 * @property {number} [registrationMs]
 * @property {number} [heapUsedBytes]
 * @property {number} [speedupPercent]
 * @property {number} [updateSpeedupPercent]
 * @property {number} [evalSpeedupPercent]
 * @property {number} [registrationSpeedupPercent]
 * @property {number} [memorySavingsPercent]
 * @property {boolean} [isBaseline]
 * @property {boolean} [isTotal]
 */

/**
 * @typedef {import('./table.js').TableRow[] & {
 *   diagnostics?: Record<string, any>;
 *   suiteContext: SuiteContext;
 *   runtimeRows?: RuntimeRow[];
 *   artifacts?: string[];
 * }} SuiteBenchmarkResult
 */

/**
 * @template [TMetrics=Record<string, number>]
 * @template [TDiagnostics=Record<string, any>]
 * @typedef {Object} BenchmarkSuiteResult
 * @property {string} id
 * @property {string} name
 * @property {string} [packageName]
 * @property {string} [version]
 * @property {number} [componentCount]
 * @property {TMetrics} baseline
 * @property {TMetrics} optimized
 * @property {Record<string, { diff: number, percent: number, isImprovement?: boolean }>} [deltas]
 * @property {TDiagnostics} [diagnostics]
 */

/**
 * @template [TMetrics=Record<string, number>]
 * @template [TDiagnostics=Record<string, any>]
 * @typedef {Object} BenchmarkRunResult
 * @property {string} schemaVersion
 * @property {string} benchmarkId
 * @property {string} title
 * @property {string} description
 * @property {string} timestamp
 * @property {Record<string, any>} environment
 * @property {Array<BenchmarkSuiteResult<TMetrics, TDiagnostics>>} suites
 * @property {Record<string, any>} [summary]
 */

export {};
