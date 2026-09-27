import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatKb } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const benchmarksDir = path.resolve(__dirname, '..');
const docsDir = path.join(benchmarksDir, 'docs');

/**
 * Suite ordering canonical list for consistent column alignment.
 */
export const CANONICAL_SUITE_ORDER = [
  { id: 'carbon', label: 'Carbon Web Components (99 elements)', shortLabel: 'Carbon Web Components', count: 99 },
  { id: 'spectrum', label: 'Spectrum Web Components (52 elements)', shortLabel: 'Spectrum Web Components', count: 52 },
  { id: 'webawesome', label: 'Web Awesome (73 elements)', shortLabel: 'Web Awesome', count: 73 },
  { id: 'momentum', label: 'Momentum Design (97 elements)', shortLabel: 'Momentum Design', count: 97 },
  { id: 'material', label: 'Material Web (28 elements)', shortLabel: 'Material Web', count: 28 },
];

/**
 * Normalizes strings by lowercasing and stripping non-alphanumeric characters for fuzzy matching.
 * E.g., 'Web Awesome (73 elements)' -> 'webawesome73elements', matching 'webawesome'.
 * @param {string | undefined} s
 * @returns {string}
 */
export const normalizeStr = (s) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';

/**
 * Extract a markdown table under a specific section heading.
 * @param {string} content
 * @param {RegExp} headingRegex
 * @returns {string | null}
 */
export function extractTableUnderHeading(content, headingRegex) {
  const match = content.match(headingRegex);
  if (!match || match.index === undefined) return null;

  const headingIndex = match.index;
  const afterHeading = content.slice(headingIndex);

  const tableStartRelative = afterHeading.search(/\n\|/);
  if (tableStartRelative === -1) return null;

  const tableStartIndex = headingIndex + tableStartRelative + 1;
  const fromTable = content.slice(tableStartIndex);

  const lines = fromTable.split('\n');
  let tableEndLineIndex = 0;
  while (tableEndLineIndex < lines.length && lines[tableEndLineIndex].trim().startsWith('|')) {
    tableEndLineIndex++;
  }

  return lines.slice(0, tableEndLineIndex).join('\n');
}

/**
 * Replace a markdown table under a specific section heading.
 * @param {string} content - Full file content
 * @param {RegExp} headingRegex - Heading to look for
 * @param {string} newTable - New table markdown string
 * @returns {string} Updated content
 */
export function replaceTableUnderHeading(content, headingRegex, newTable) {
  const match = content.match(headingRegex);
  if (!match || match.index === undefined) return content;

  const headingIndex = match.index;
  const afterHeading = content.slice(headingIndex);

  // Find first table line starting with |
  const tableStartRelative = afterHeading.search(/\n\|/);
  if (tableStartRelative === -1) return content;

  const tableStartIndex = headingIndex + tableStartRelative + 1;
  const fromTable = content.slice(tableStartIndex);

  const lines = fromTable.split('\n');
  let tableEndLineIndex = 0;
  while (tableEndLineIndex < lines.length && lines[tableEndLineIndex].trim().startsWith('|')) {
    tableEndLineIndex++;
  }

  const tableEndIndex = tableStartIndex + lines.slice(0, tableEndLineIndex).join('\n').length;
  return content.slice(0, tableStartIndex) + newTable + content.slice(tableEndIndex);
}

/**
 * Parse a markdown table into an array of row cells.
 * @param {string} tableStr
 * @returns {string[][]}
 */
export function parseTableCells(tableStr) {
  if (!tableStr) return [];
  const lines = tableStr
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  return lines.map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim()),
  );
}

/**
 * Generate Root README.md Benchmark Summary Table.
 * Merges fresh results into any existing table on disk to preserve un-run suites.
 * @param {Array<any>} allResults
 * @param {string | null} [existingTableStr]
 * @returns {string}
 */
export function formatRootSummaryTable(allResults, existingTableStr) {
  const existingCells = parseTableCells(existingTableStr || '');
  const headers = ['Design system or library', 'Elements', 'Baseline size', 'Optimized size', 'Net savings', 'First render speedup'];
  const alignments = [':---', '---:', '---:', '---:', '---:', '---:'];

  const rows = [];
  let totalElements = 0;
  let totalBaselineKb = 0;
  let totalOptimizedKb = 0;
  let speedupSum = 0;
  let speedupCount = 0;

  for (const item of CANONICAL_SUITE_ORDER) {
    const res = allResults.find((r) => r.suiteId === item.id);
    const existingRow = existingCells.find((r) => normalizeStr(r[0]).includes(normalizeStr(item.id)));

    if (!res) {
      if (existingRow && existingRow.length >= 6) {
        rows.push(`| ${existingRow.slice(0, 6).join(' | ')} |`);
        const elMatch = parseInt(existingRow[1].replace(/,/g, ''), 10);
        if (!Number.isNaN(elMatch)) totalElements += elMatch;
        const baseKb = parseFloat(existingRow[2].replace(/,/g, '').replace(/KB/g, ''));
        if (!Number.isNaN(baseKb)) totalBaselineKb += baseKb;
        const optKb = parseFloat(existingRow[3].replace(/,/g, '').replace(/KB/g, ''));
        if (!Number.isNaN(optKb)) totalOptimizedKb += optKb;
        const speedupMatch = existingRow[5].match(/([0-9.]+)%/);
        if (speedupMatch) {
          speedupSum += parseFloat(speedupMatch[1]);
          speedupCount++;
        }
      }
      continue;
    }

    const baseRow = res.rows.find((/** @type {any} */ r) => r.isBaseline);
    const totalRow = res.rows.find((/** @type {any} */ r) => r.isTotal);
    const runtimeRows = res.rows?.runtimeRows || res.runtimeRows;
    const totalRt = runtimeRows?.find((/** @type {any} */ r) => r.isTotal);

    if (!baseRow || !totalRow) {
      if (existingRow && existingRow.length >= 6) {
        rows.push(`| ${existingRow.slice(0, 6).join(' | ')} |`);
      }
      continue;
    }

    const elCount = res.componentCount || item.count;
    const baseKb = baseRow.metrics.rawBytes / 1024;
    const optKb = totalRow.metrics.rawBytes / 1024;

    totalElements += elCount;
    totalBaselineKb += baseKb;
    totalOptimizedKb += optKb;

    const diff = totalRow.impact ? totalRow.impact.rawDiff : totalRow.metrics.rawBytes - baseRow.metrics.rawBytes;
    const pct = totalRow.impact ? totalRow.impact.rawPercent : (diff / baseRow.metrics.rawBytes) * 100;
    const speedupPct = totalRt && totalRt.speedupPercent !== undefined ? totalRt.speedupPercent : 0;

    if (speedupPct > 0) {
      speedupSum += speedupPct;
      speedupCount++;
    }

    const sign = diff <= 0 ? '-' : '+';
    const absDiff = Math.abs(diff);
    const netSavingsStr = `**${sign}${formatKb(absDiff)} (${pct <= 0 ? '-' : '+'}${Math.abs(pct).toFixed(2)}%)**`;
    const speedupStr = speedupPct > 0 ? `**+${speedupPct.toFixed(1)}%**` : 'n/a';

    rows.push(`| ${item.shortLabel} | ${elCount} | ${formatKb(baseRow.metrics.rawBytes)} | ${formatKb(totalRow.metrics.rawBytes)} | ${netSavingsStr} | ${speedupStr} |`);
  }

  const totalDiffKb = totalOptimizedKb - totalBaselineKb;
  const totalPct = totalBaselineKb > 0 ? (totalDiffKb / totalBaselineKb) * 100 : 0;
  const totalSign = totalDiffKb <= 0 ? '-' : '+';
  const totalSavingsStr = `**${totalSign}${totalDiffKb !== 0 ? Math.abs(totalDiffKb).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'} KB (${totalPct <= 0 ? '-' : '+'}${Math.abs(totalPct).toFixed(2)}%)**`;
  const avgSpeedup = speedupCount > 0 ? `**+${(speedupSum / speedupCount).toFixed(1)}%**` : 'n/a';

  rows.push(
    `| **Total** | **${totalElements}** | **${totalBaselineKb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KB** | **${totalOptimizedKb.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KB** | ${totalSavingsStr} | ${avgSpeedup} |`,
  );

  return `| ${headers.join(' | ')} |\n| ${alignments.join(' | ')} |\n${rows.join('\n')}`;
}

/**
 * Generate Executive Overview Table for packages/benchmarks/README.md.
 * Merges fresh results into any existing table on disk to preserve un-run suites.
 * @param {Array<any>} allResults
 * @param {string | null} [existingTableStr]
 * @returns {string}
 */
export function formatExecutiveOverviewTable(allResults, existingTableStr) {
  const existingCells = parseTableCells(existingTableStr || '');
  const existingHeaders = existingCells[0] || [];

  /** @type {Record<string, number>} */
  const suiteColIndices = {};
  for (const item of CANONICAL_SUITE_ORDER) {
    const colIdx = existingHeaders.findIndex((h, idx) => idx > 0 && normalizeStr(h).includes(normalizeStr(item.id)));
    if (colIdx > 0) {
      suiteColIndices[item.id] = colIdx;
    }
  }

  const getExistingVal = (/** @type {string} */ rowKey, /** @type {string} */ suiteId) => {
    const colIdx = suiteColIndices[suiteId];
    if (!colIdx) return 'n/a';
    const row = existingCells.find((r) => normalizeStr(r[0]).includes(normalizeStr(rowKey)));
    return row?.[colIdx] ? row[colIdx] : 'n/a';
  };

  const headers = ['Metric', ...CANONICAL_SUITE_ORDER.map((s) => s.label)];
  const alignments = [':---', ...CANONICAL_SUITE_ORDER.map(() => ':---')];

  const baselineSizes = [];
  const optimizedSizes = [];
  const netSavings = [];
  const baselineBuilds = [];
  const optimizedBuilds = [];
  const buildOverheads = [];
  const firstRenderSpeedups = [];

  for (const item of CANONICAL_SUITE_ORDER) {
    const res = allResults.find((r) => r.suiteId === item.id);
    if (!res) {
      baselineSizes.push(getExistingVal('baseline bundle size', item.id));
      optimizedSizes.push(getExistingVal('optimized bundle size', item.id));
      netSavings.push(getExistingVal('net bundle savings', item.id));
      baselineBuilds.push(getExistingVal('baseline build time', item.id));
      optimizedBuilds.push(getExistingVal('optimized build time', item.id));
      buildOverheads.push(getExistingVal('build overhead', item.id));
      firstRenderSpeedups.push(getExistingVal('first render speedup', item.id));
      continue;
    }

    const baseRow = res.rows.find((/** @type {any} */ r) => r.isBaseline);
    const totalRow = res.rows.find((/** @type {any} */ r) => r.isTotal);
    const runtimeRows = res.rows?.runtimeRows || res.runtimeRows;
    const totalRt = runtimeRows?.find((/** @type {any} */ r) => r.isTotal);

    baselineSizes.push(baseRow ? formatKb(baseRow.metrics.rawBytes) : getExistingVal('baseline bundle size', item.id));
    optimizedSizes.push(totalRow ? formatKb(totalRow.metrics.rawBytes) : getExistingVal('optimized bundle size', item.id));

    if (baseRow && totalRow) {
      const diff = totalRow.impact ? totalRow.impact.rawDiff : totalRow.metrics.rawBytes - baseRow.metrics.rawBytes;
      const pct = totalRow.impact ? totalRow.impact.rawPercent : (diff / baseRow.metrics.rawBytes) * 100;
      const sign = diff <= 0 ? '-' : '+';
      netSavings.push(`**${sign}${formatKb(Math.abs(diff))} (${pct <= 0 ? '-' : '+'}${Math.abs(pct).toFixed(2)}%)**`);
    } else {
      netSavings.push(getExistingVal('net bundle savings', item.id));
    }

    const baseBuildMs = baseRow?.metrics?.buildTimeMs !== undefined ? Math.round(baseRow.metrics.buildTimeMs) : 0;
    const optBuildMs = totalRow?.metrics?.buildTimeMs !== undefined ? Math.round(totalRow.metrics.buildTimeMs) : 0;
    baselineBuilds.push(baseBuildMs ? `${baseBuildMs} ms` : getExistingVal('baseline build time', item.id));
    optimizedBuilds.push(optBuildMs ? `${optBuildMs} ms` : getExistingVal('optimized build time', item.id));

    if (baseBuildMs && optBuildMs) {
      const overhead = optBuildMs - baseBuildMs;
      buildOverheads.push(overhead >= 0 ? `+${overhead} ms` : `${overhead} ms`);
    } else {
      buildOverheads.push(getExistingVal('build overhead', item.id));
    }

    if (totalRt?.speedupPercent !== undefined && totalRt.speedupPercent > 0) {
      firstRenderSpeedups.push(`**+${totalRt.speedupPercent.toFixed(1)}% faster**`);
    } else {
      firstRenderSpeedups.push(getExistingVal('first render speedup', item.id));
    }
  }

  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${alignments.join(' | ')} |`,
    `| **Baseline bundle size** | ${baselineSizes.join(' | ')} |`,
    `| **Optimized bundle size** | ${optimizedSizes.join(' | ')} |`,
    `| **Net bundle savings** | ${netSavings.join(' | ')} |`,
    `| **Baseline build time** | ${baselineBuilds.join(' | ')} |`,
    `| **Optimized build time** | ${optimizedBuilds.join(' | ')} |`,
    `| **Build overhead** | ${buildOverheads.join(' | ')} |`,
    `| **First render speedup** | ${firstRenderSpeedups.join(' | ')} |`,
  ];

  return lines.join('\n');
}

/**
 * Format dedicated comparison table for packages/benchmarks/docs/${toolId}.md.
 * Merges fresh results into any existing table on disk to preserve un-run suites.
 * @param {string} toolId
 * @param {Array<any>} allResults
 * @param {string | null} [existingTableStr]
 * @returns {string | null}
 */
export function formatDedicatedToolTable(toolId, allResults, existingTableStr) {
  const existingCells = parseTableCells(existingTableStr || '');
  const existingHeaders = existingCells[0] || [];

  /** @type {Record<string, number>} */
  const suiteColIndices = {};
  for (const item of CANONICAL_SUITE_ORDER) {
    const colIdx = existingHeaders.findIndex((h, idx) => idx > 0 && normalizeStr(h).includes(normalizeStr(item.id)));
    if (colIdx > 0) {
      suiteColIndices[item.id] = colIdx;
    }
  }

  const getExistingVal = (/** @type {string} */ rowKey, /** @type {string} */ suiteId) => {
    const colIdx = suiteColIndices[suiteId];
    if (!colIdx) return 'n/a';
    const row = existingCells.find((r) => normalizeStr(r[0]).includes(normalizeStr(rowKey)));
    return row?.[colIdx] ? row[colIdx] : 'n/a';
  };

  const headers = ['Metric', ...CANONICAL_SUITE_ORDER.map((s) => s.label)];
  const alignments = [':---', ...CANONICAL_SUITE_ORDER.map(() => ':---')];

  const baselineSizes = [];
  const optimizedSizes = [];
  const netSavings = [];
  const baselineMounts = [];
  const optimizedMounts = [];
  const mountSpeedups = [];
  const baselineUpdates = [];
  const optimizedUpdates = [];
  const updateSpeedups = [];

  let foundAny = false;

  for (const item of CANONICAL_SUITE_ORDER) {
    const res = allResults.find((r) => r.suiteId === item.id);
    const toolRow = res?.rows?.find((/** @type {any} */ r) => !r.isBaseline && !r.isTotal && r.name.toLowerCase().includes(toolId));

    if (!res || !toolRow) {
      baselineSizes.push(getExistingVal('baseline bundle size', item.id));
      optimizedSizes.push(getExistingVal('optimized bundle size', item.id));
      netSavings.push(getExistingVal('net bundle savings', item.id));
      baselineMounts.push(getExistingVal('baseline mount latency', item.id));
      optimizedMounts.push(getExistingVal('optimized mount latency', item.id));
      mountSpeedups.push(getExistingVal('mount speedup', item.id));
      baselineUpdates.push(getExistingVal('baseline update latency', item.id));
      optimizedUpdates.push(getExistingVal('optimized update latency', item.id));
      updateSpeedups.push(getExistingVal('update speedup', item.id));
      continue;
    }

    foundAny = true;
    const baseRow = res.rows.find((/** @type {any} */ r) => r.isBaseline);
    const runtimeRows = res.rows?.runtimeRows || res.runtimeRows;
    const baseRt = runtimeRows?.find((/** @type {any} */ r) => r.isBaseline);
    const toolRt = runtimeRows?.find((/** @type {any} */ r) => !r.isBaseline && !r.isTotal && r.name.toLowerCase().includes(toolId));

    baselineSizes.push(baseRow ? formatKb(baseRow.metrics.rawBytes) : getExistingVal('baseline bundle size', item.id));
    optimizedSizes.push(toolRow ? formatKb(toolRow.metrics.rawBytes) : getExistingVal('optimized bundle size', item.id));

    if (baseRow && toolRow) {
      const diff = toolRow.impact ? toolRow.impact.rawDiff : toolRow.metrics.rawBytes - baseRow.metrics.rawBytes;
      const pct = toolRow.impact ? toolRow.impact.rawPercent : (diff / baseRow.metrics.rawBytes) * 100;
      const sign = diff <= 0 ? '-' : '+';
      netSavings.push(`**${sign}${formatKb(Math.abs(diff))} (${pct <= 0 ? '-' : '+'}${Math.abs(pct).toFixed(2)}%)**`);
    } else {
      netSavings.push(getExistingVal('net bundle savings', item.id));
    }

    const baseMount = baseRt ? `${baseRt.firstRenderMs.toFixed(2)} ms` : getExistingVal('baseline mount latency', item.id);
    const optMount = toolRt ? `${toolRt.firstRenderMs.toFixed(2)} ms` : getExistingVal('optimized mount latency', item.id);
    baselineMounts.push(baseMount);
    optimizedMounts.push(optMount);

    if (baseRt && toolRt) {
      const speedup = toolRt.speedupPercent ?? (baseRt.firstRenderMs > 0 ? ((baseRt.firstRenderMs - toolRt.firstRenderMs) / baseRt.firstRenderMs) * 100 : 0);
      const isNeutral = Math.abs(speedup) < 2.0;
      const formattedSpeedup = isNeutral ? `**${speedup >= 0 ? '+' : ''}${speedup.toFixed(1)}% (neutral)**` : `**${speedup > 0 ? '+' : ''}${speedup.toFixed(1)}% faster**`;
      mountSpeedups.push(formattedSpeedup);
    } else {
      mountSpeedups.push(getExistingVal('mount speedup', item.id));
    }

    const baseUpdate = baseRt ? `${baseRt.updateMs.toFixed(2)} ms` : getExistingVal('baseline update latency', item.id);
    const optUpdate = toolRt ? `${toolRt.updateMs.toFixed(2)} ms` : getExistingVal('optimized update latency', item.id);
    baselineUpdates.push(baseUpdate);
    optimizedUpdates.push(optUpdate);

    if (baseRt && toolRt) {
      const updateSpeedup = baseRt.updateMs > 0 ? ((baseRt.updateMs - toolRt.updateMs) / baseRt.updateMs) * 100 : 0;
      const isNeutral = Math.abs(updateSpeedup) < 2.0;
      const formattedUpdate = isNeutral ? `**${updateSpeedup >= 0 ? '+' : ''}${updateSpeedup.toFixed(1)}% (neutral)**` : `**${updateSpeedup > 0 ? '+' : ''}${updateSpeedup.toFixed(1)}% faster**`;
      updateSpeedups.push(formattedUpdate);
    } else {
      updateSpeedups.push(getExistingVal('update speedup', item.id));
    }
  }

  if (!foundAny) return null;

  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${alignments.join(' | ')} |`,
    `| **Baseline bundle size** | ${baselineSizes.join(' | ')} |`,
    `| **Optimized bundle size** | ${optimizedSizes.join(' | ')} |`,
    `| **Net bundle savings** | ${netSavings.join(' | ')} |`,
    `| **Baseline mount latency** | ${baselineMounts.join(' | ')} |`,
    `| **Optimized mount latency** | ${optimizedMounts.join(' | ')} |`,
    `| **Mount speedup** | ${mountSpeedups.join(' | ')} |`,
    `| **Baseline update latency** | ${baselineUpdates.join(' | ')} |`,
    `| **Optimized update latency** | ${optimizedUpdates.join(' | ')} |`,
    `| **Update speedup** | ${updateSpeedups.join(' | ')} |`,
  ];

  return lines.join('\n');
}

/**
 * Synchronize benchmark results into documentation files on disk.
 * @param {Array<any>} allResults
 * @param {Object} [options]
 * @param {boolean} [options.verbose]
 * @param {Array<any>} [options.activeTools]
 */
export function syncAllBenchmarkDocs(allResults, options = {}) {
  const activeTools = options.activeTools || [];
  const isMultiTool = activeTools.length === 0 || activeTools.length >= 3;

  const updatedFiles = [];

  // 1. Update Root README.md (only when multi-tool/combined optimizations are evaluated)
  if (isMultiTool) {
    const rootReadmePath = path.resolve(rootDir, 'README.md');
    if (fs.existsSync(rootReadmePath)) {
      const content = fs.readFileSync(rootReadmePath, 'utf8');
      const existingTable = extractTableUnderHeading(content, /## Benchmark summary/);
      const table = formatRootSummaryTable(allResults, existingTable);
      const updated = replaceTableUnderHeading(content, /## Benchmark summary/, table);
      if (updated !== content) {
        fs.writeFileSync(rootReadmePath, updated, 'utf8');
        updatedFiles.push('README.md');
      }
    }
  }

  // 2. Update packages/benchmarks/README.md (only when multi-tool/combined optimizations are evaluated)
  if (isMultiTool) {
    const benchReadmePath = path.resolve(benchmarksDir, 'README.md');
    if (fs.existsSync(benchReadmePath)) {
      const content = fs.readFileSync(benchReadmePath, 'utf8');
      const existingTable = extractTableUnderHeading(content, /## Executive overview \(all optimizations combined\)/);
      const table = formatExecutiveOverviewTable(allResults, existingTable);
      const updated = replaceTableUnderHeading(content, /## Executive overview \(all optimizations combined\)/, table);
      if (updated !== content) {
        fs.writeFileSync(benchReadmePath, updated, 'utf8');
        updatedFiles.push('packages/benchmarks/README.md');
      }
    }
  }

  // 3. Update dedicated tool reports in packages/benchmarks/docs/
  const toolsToSync = ['css-fuse', 'html-fuse', 'props-lower', 'elem-proxy', 'event-hoist', 'html-aot', 'css-minifier', 'html-minifier'];

  for (const toolId of toolsToSync) {
    if (activeTools.length > 0 && !activeTools.some((t) => t.id === toolId)) {
      continue;
    }

    const docPath = path.join(docsDir, `${toolId}.md`);
    if (!fs.existsSync(docPath)) continue;

    const content = fs.readFileSync(docPath, 'utf8');
    const existingTable = extractTableUnderHeading(content, /## Bundle size and runtime performance comparison/);
    const table = formatDedicatedToolTable(toolId, allResults, existingTable);
    if (table) {
      const updated = replaceTableUnderHeading(content, /## Bundle size and runtime performance comparison/, table);
      if (updated !== content) {
        fs.writeFileSync(docPath, updated, 'utf8');
        updatedFiles.push(`packages/benchmarks/docs/${toolId}.md`);
      }
    }
  }

  if (updatedFiles.length > 0) {
    console.log(`\n📝 Automatically synchronized benchmark tables across ${updatedFiles.length} markdown files:`);
    for (const file of updatedFiles) {
      console.log(`   ✓ ${file}`);
    }
  }
}
