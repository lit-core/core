import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultResultsDir = path.resolve(__dirname, '../../results');

/**
 * Save benchmark result as structured JSON artifact.
 * @param {import('../types.js').BenchmarkRunResult} result
 * @param {Object} [options]
 * @param {string} [options.outDir] - Directory to save artifact to (default: packages/benchmarks/results)
 * @param {string} [options.filename] - Custom filename (default: <benchmarkId>.json)
 * @param {boolean} [options.updateCombined=true] - Update combined results.json artifact
 * @returns {string} Path to written file
 */
export function saveBenchmarkResult(result, options = {}) {
  const outDir = options.outDir || defaultResultsDir;
  fs.mkdirSync(outDir, { recursive: true });

  const filename = options.filename || `${result.benchmarkId}.json`;
  const filePath = path.join(outDir, filename);

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');

  if (options.updateCombined !== false) {
    const combinedPath = path.join(outDir, 'results.json');
    /** @type {Record<string, any>} */
    let combined = {};
    if (fs.existsSync(combinedPath)) {
      try {
        combined = JSON.parse(fs.readFileSync(combinedPath, 'utf-8'));
      } catch {}
    }
    combined[result.benchmarkId] = result;
    fs.writeFileSync(combinedPath, JSON.stringify(combined, null, 2), 'utf-8');
  }

  return filePath;
}

/**
 * Read a benchmark JSON artifact.
 * @param {string} filePathOrId
 * @param {string} [dir]
 * @returns {import('../types.js').BenchmarkRunResult | null}
 */
export function loadBenchmarkResult(filePathOrId, dir = defaultResultsDir) {
  const targetPath = filePathOrId.endsWith('.json') ? path.resolve(filePathOrId) : path.join(dir, `${filePathOrId}.json`);

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(targetPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to load benchmark result from ${targetPath}:`, err);
    return null;
  }
}
