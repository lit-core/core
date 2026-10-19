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

import { formatImpact, formatKb } from './format.js';

export { formatImpact, formatKb };

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
