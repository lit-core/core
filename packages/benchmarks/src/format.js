/**
 * Standardized numerical and metric formatting utility using Intl.NumberFormat.
 * Provides consistent digit grouping, precision, and unit display across locales.
 */

// Cached Intl.NumberFormat instances configured for 'en-US' for deterministic CI output
const numberFormatters = new Map();

/**
 * Get or create a cached Intl.NumberFormat instance.
 * @param {string} locale
 * @param {Intl.NumberFormatOptions} options
 * @returns {Intl.NumberFormat}
 */
function getNumberFormatter(locale = 'en-US', options = {}) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Format a number with consistent digit grouping and decimal precision.
 * @param {number} value
 * @param {Object} [options]
 * @param {number} [options.decimals=0]
 * @param {number} [options.minDecimals]
 * @param {boolean} [options.useGrouping=true]
 * @param {string} [options.locale='en-US']
 * @returns {string}
 */
export function formatNumber(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0';
  }
  const { decimals = 0, minDecimals, useGrouping = true, locale = 'en-US' } = options;
  const formatter = getNumberFormatter(locale, {
    useGrouping,
    minimumFractionDigits: minDecimals !== undefined ? minDecimals : decimals,
    maximumFractionDigits: decimals,
  });
  return formatter.format(value);
}

/**
 * Format a percentage value (e.g. -83.3% or +35.8%).
 * @param {number} value - Percentage value (e.g. -83.3) or fraction (e.g. -0.833) if isFraction is true
 * @param {Object} [options]
 * @param {number} [options.decimals=1]
 * @param {boolean} [options.showSign=true]
 * @param {boolean} [options.isFraction=false]
 * @param {string} [options.locale='en-US']
 * @returns {string}
 */
export function formatPercent(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '0.0%';
  }
  const { decimals = 1, showSign = true, isFraction = false, locale = 'en-US' } = options;
  const numValue = isFraction ? value * 100 : value;

  const sign = showSign && numValue > 0 ? '+' : '';
  const formatted = formatNumber(numValue, { decimals, minDecimals: decimals, locale });
  return `${sign}${formatted}%`;
}

/**
 * Format bytes into human-readable kilobytes (KB) with digit grouping.
 * @param {number} bytes
 * @param {Object} [options]
 * @param {number} [options.decimals=2]
 * @param {boolean} [options.unit=true]
 * @param {string} [options.locale='en-US']
 * @returns {string}
 */
export function formatKb(bytes, options = {}) {
  const decimals = typeof options === 'number' ? options : (options.decimals ?? 2);
  const showUnit = typeof options === 'object' && options.unit !== undefined ? options.unit : true;
  const locale = typeof options === 'object' && options.locale ? options.locale : 'en-US';

  const kb = bytes / 1024;
  const formatted = formatNumber(kb, { decimals, minDecimals: decimals, locale });
  return showUnit ? `${formatted} KB` : formatted;
}

/**
 * Format milliseconds duration into human-readable string.
 * @param {number} ms
 * @param {Object} [options]
 * @param {number} [options.decimals=2]
 * @param {boolean} [options.unit=true]
 * @param {string} [options.locale='en-US']
 * @returns {string}
 */
export function formatDuration(ms, options = {}) {
  const { decimals = 2, unit = true, locale = 'en-US' } = options;
  const formatted = formatNumber(ms, { decimals, minDecimals: decimals, locale });
  return unit ? `${formatted} ms` : formatted;
}

/**
 * Calculate numerical delta and percent difference between baseline and candidate.
 * @param {number} baseline
 * @param {number} candidate
 * @param {Object} [options]
 * @param {number} [options.decimals=1]
 * @returns {{ diff: number, percent: number, formattedDiff: string, formattedPercent: string, isReduction: boolean }}
 */
export function calculateDelta(baseline, candidate, options = {}) {
  const diff = candidate - baseline;
  const percent = baseline !== 0 ? (diff / baseline) * 100 : 0;
  const { decimals = 1 } = options;

  return {
    diff,
    percent,
    formattedDiff: formatNumber(diff, { decimals }),
    formattedPercent: formatPercent(percent, { decimals, showSign: true }),
    isReduction: diff < 0,
  };
}

/**
 * Format impact string (e.g. "-71.99 KB (-8.96%)" or "+0.00 KB (+0.00%)").
 * Preserves compatibility with existing metrics reporting.
 * @param {number} diffBytes
 * @param {number} percent
 * @returns {string}
 */
export function formatImpact(diffBytes, percent) {
  if (Math.abs(diffBytes) === 0) {
    return 'n/a';
  }
  const sign = diffBytes < 0 ? '-' : '+';
  const absBytes = Math.abs(diffBytes);
  const formattedBytes = `${sign}${formatKb(absBytes)}`;
  const formattedPct = formatPercent(percent, { decimals: 2, showSign: percent > 0 });
  return `${formattedBytes} (${formattedPct})`;
}
