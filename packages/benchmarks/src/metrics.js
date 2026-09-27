import fs from 'node:fs';
import zlib from 'node:zlib';

/**
 * @typedef {Object} SizeMetrics
 * @property {number} rawBytes
 * @property {number} gzipBytes
 * @property {number} brotliBytes
 * @property {number} [buildTimeMs]
 */

/**
 * @typedef {Object} DiffMetrics
 * @property {number} rawDiff
 * @property {number} rawPercent
 * @property {number} gzipDiff
 * @property {number} gzipPercent
 * @property {number} brotliDiff
 * @property {number} brotliPercent
 */

/**
 * Calculate bundle sizes from a file.
 * @param {string} filePath
 * @returns {SizeMetrics}
 */
export function getFileSizes(filePath) {
  const code = fs.readFileSync(filePath);
  const rawBytes = code.length;
  const gzipBytes = zlib.gzipSync(code, { level: 9 }).length;
  const brotliBytes = zlib.brotliCompressSync(code).length;
  return { rawBytes, gzipBytes, brotliBytes };
}

/**
 * Format bytes into human readable KB.
 * @param {number} bytes
 * @param {number} [decimals=2]
 * @returns {string}
 */
export function formatKb(bytes, decimals = 2) {
  return `${(bytes / 1024).toFixed(decimals)} KB`;
}

/**
 * Calculate difference and percent reduction between baseline and candidate.
 * Positive savings means candidate is smaller than baseline (saved bytes).
 * @param {SizeMetrics} baseline
 * @param {SizeMetrics} candidate
 * @returns {DiffMetrics}
 */
export function calculateImpact(baseline, candidate) {
  const rawDiff = candidate.rawBytes - baseline.rawBytes;
  const rawPercent = baseline.rawBytes > 0 ? (rawDiff / baseline.rawBytes) * 100 : 0;

  const gzipDiff = candidate.gzipBytes - baseline.gzipBytes;
  const gzipPercent = baseline.gzipBytes > 0 ? (gzipDiff / baseline.gzipBytes) * 100 : 0;

  const brotliDiff = candidate.brotliBytes - baseline.brotliBytes;
  const brotliPercent = baseline.brotliBytes > 0 ? (brotliDiff / baseline.brotliBytes) * 100 : 0;

  return {
    rawDiff,
    rawPercent,
    gzipDiff,
    gzipPercent,
    brotliDiff,
    brotliPercent,
  };
}

/**
 * Format impact string (e.g. "-71.99 KB (-8.96%)" or "+0.00 KB (0.00%)").
 * @param {number} diffBytes
 * @param {number} percent
 * @returns {string}
 */
export function formatImpact(diffBytes, percent) {
  if (Math.abs(diffBytes) === 0) {
    return '—';
  }
  const sign = diffBytes < 0 ? '-' : '+';
  const absBytes = Math.abs(diffBytes);
  const formattedBytes = `${sign}${formatKb(absBytes)}`;
  const formattedPct = `${percent.toFixed(2)}%`;
  return `${formattedBytes} (${formattedPct})`;
}
