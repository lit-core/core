import { formatImpact, formatKb } from './metrics.js';

/**
 * @typedef {Object} TableRow
 * @property {string} name
 * @property {string} [description]
 * @property {import('./metrics.js').SizeMetrics} metrics
 * @property {import('./metrics.js').DiffMetrics} [impact]
 * @property {boolean} [isBaseline]
 * @property {boolean} [isTotal]
 */

/**
 * Format a list of benchmark rows as a Unicode terminal box table.
 * @param {string} title
 * @param {TableRow[]} rows
 * @returns {string}
 */
export function renderAsciiTable(title, rows) {
  const headers = ['Optimization tool or mode', 'Minified JS', 'Gzip', 'Brotli', 'Raw impact (Δ)', 'Gzip impact (Δ)'];

  const formattedRows = rows.map((r) => {
    const rawSize = formatKb(r.metrics.rawBytes);
    const gzipSize = formatKb(r.metrics.gzipBytes);
    const brotliSize = formatKb(r.metrics.brotliBytes);
    const rawImpact = r.isBaseline ? 'n/a' : formatImpact(r.impact?.rawDiff ?? 0, r.impact?.rawPercent ?? 0);
    const gzipImpact = r.isBaseline ? 'n/a' : formatImpact(r.impact?.gzipDiff ?? 0, r.impact?.gzipPercent ?? 0);

    return {
      cells: [r.name, rawSize, gzipSize, brotliSize, rawImpact, gzipImpact],
      isBaseline: !!r.isBaseline,
      isTotal: !!r.isTotal,
    };
  });

  // Calculate column widths
  const colWidths = headers.map((header, i) => {
    const maxDataWidth = Math.max(...formattedRows.map((r) => r.cells[i].length));
    return Math.max(header.length, maxDataWidth);
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (colWidths.length - 1) * 3 + 4;

  const topBorder = `┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const midBorder = `├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const doubleMidBorder = `╞${colWidths.map((w) => '═'.repeat(w + 2)).join('╪')}╡`;
  const botBorder = `└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const headerLine = `│ ${headers.map((h, i) => (i === 0 ? h.padEnd(colWidths[i]) : h.padStart(colWidths[i]))).join(' │ ')} │`;

  const output = [];
  output.push(`\n${'═'.repeat(totalWidth)}`);
  output.push(`📊 ${title}`);
  output.push(`${'═'.repeat(totalWidth)}`);
  output.push(topBorder);
  output.push(headerLine);
  output.push(midBorder);

  for (let idx = 0; idx < formattedRows.length; idx++) {
    const row = formattedRows[idx];
    const isLast = idx === formattedRows.length - 1;

    if (row.isTotal) {
      output.push(doubleMidBorder);
    }

    const rowLine = `│ ${row.cells.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]) : c.padStart(colWidths[i]))).join(' │ ')} │`;
    output.push(rowLine);

    if (row.isBaseline && !isLast) {
      output.push(midBorder);
    }
  }

  output.push(botBorder);
  return output.join('\n');
}

/**
 * Format runtime performance metrics (First render, Update, Script eval, Heap) as an ASCII table.
 * @param {string} title
 * @param {Array<{ name: string, firstRenderMs: number, updateMs: number, scriptEvalMs?: number, registrationMs?: number, heapUsedBytes?: number, speedupPercent?: number, updateSpeedupPercent?: number, evalSpeedupPercent?: number, memorySavingsPercent?: number, isBaseline?: boolean, isTotal?: boolean }>} rows
 * @returns {string}
 */
export function renderAsciiRuntimeTable(title, rows) {
  if (!rows || rows.length === 0) return '';

  const hasEval = rows.some((r) => (r.scriptEvalMs ?? 0) > 0);
  const hasReg = rows.some((r) => (r.registrationMs ?? 0) > 0);
  const hasHeap = rows.some((r) => (r.heapUsedBytes ?? 0) > 0);

  const headers = ['Optimization tool or mode', 'First render', 'Update complete'];
  if (hasEval) headers.push('Script eval');
  if (hasReg) headers.push('Element registration');
  if (hasHeap) headers.push('Retained heap');
  headers.push('Render speedup');

  const formattedRows = rows.map((r) => {
    const firstRender = r.firstRenderMs > 0 ? `${r.firstRenderMs.toFixed(2)} ms` : 'n/a';
    const update = r.updateMs > 0 ? `${r.updateMs.toFixed(2)} ms` : 'n/a';
    const scriptEval = typeof r.scriptEvalMs === 'number' && r.scriptEvalMs > 0 ? `${r.scriptEvalMs.toFixed(2)} ms` : 'n/a';
    const registration = typeof r.registrationMs === 'number' && r.registrationMs > 0 ? `${r.registrationMs.toFixed(2)} ms` : 'n/a';
    const heap = typeof r.heapUsedBytes === 'number' && r.heapUsedBytes > 0 ? formatKb(r.heapUsedBytes) : 'n/a';
    const speedup = r.isBaseline ? 'n/a' : r.speedupPercent ? `${r.speedupPercent > 0 ? '+' : ''}${r.speedupPercent.toFixed(1)}%` : '0.0%';

    const row = [r.name, firstRender, update];
    if (hasEval) row.push(scriptEval);
    if (hasReg) row.push(registration);
    if (hasHeap) row.push(heap);
    row.push(speedup);
    return row;
  });

  const colWidths = headers.map((header, i) => {
    const maxData = Math.max(...formattedRows.map((r) => r[i].length));
    return Math.max(header.length, maxData);
  });

  const topBorder = `┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const midBorder = `├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const botBorder = `└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const lines = [];
  lines.push(`\n⚡ ${title}`);
  lines.push(topBorder);
  lines.push(`│ ${headers.map((h, i) => (i === 0 ? h.padEnd(colWidths[i]) : h.padStart(colWidths[i]))).join(' │ ')} │`);
  lines.push(midBorder);

  for (const row of formattedRows) {
    lines.push(`│ ${row.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]) : c.padStart(colWidths[i]))).join(' │ ')} │`);
  }

  lines.push(botBorder);
  return lines.join('\n');
}

/**
 * Format a multi-suite overview table in ASCII.
 * @param {Array<{ suiteName: string, componentCount: number, baselineRaw: number, baselineGzip: number, totalRaw: number, totalGzip: number, rawSaved: number, rawPct: number, gzipSaved: number, gzipPct: number }>} summaryRows
 * @returns {string}
 */
export function renderCrossSuiteSummary(summaryRows) {
  const headers = ['Design system or library', 'Elements', 'Baseline (raw / gzip)', 'Optimized (raw / gzip)', 'Net savings (raw / gzip)'];

  const formattedRows = summaryRows.map((s) => {
    const sign = s.rawSaved >= 0 ? '-' : '+';
    const absRaw = Math.abs(s.rawSaved);
    const absGzip = Math.abs(s.gzipSaved);
    const gzSign = s.gzipSaved >= 0 ? '-' : '+';
    return [
      s.suiteName,
      `${s.componentCount} elements`,
      `${formatKb(s.baselineRaw)} / ${formatKb(s.baselineGzip)}`,
      `${formatKb(s.totalRaw)} / ${formatKb(s.totalGzip)}`,
      `${sign}${formatKb(absRaw)} (${s.rawPct >= 0 ? '-' : '+'}${Math.abs(s.rawPct).toFixed(2)}%) [Gzip: ${gzSign}${formatKb(absGzip)}]`,
    ];
  });

  const colWidths = headers.map((header, i) => {
    const maxData = Math.max(...formattedRows.map((r) => r[i].length));
    return Math.max(header.length, maxData);
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (colWidths.length - 1) * 3 + 4;
  const topBorder = `┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const midBorder = `├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const botBorder = `└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const headerLine = `│ ${headers.map((h, i) => (i === 0 ? h.padEnd(colWidths[i]) : h.padStart(colWidths[i]))).join(' │ ')} │`;

  const output = [];
  output.push(`\n${'═'.repeat(totalWidth)}`);
  output.push(`🏆 Cross-library impact overview (all configs enabled)`);
  output.push(`${'═'.repeat(totalWidth)}`);
  output.push(topBorder);
  output.push(headerLine);
  output.push(midBorder);

  for (const row of formattedRows) {
    output.push(`│ ${row.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]) : c.padStart(colWidths[i]))).join(' │ ')} │`);
  }

  output.push(botBorder);
  return output.join('\n');
}

/**
 * Render scenario benchmark results as a clean ASCII table.
 * Strictly adheres to sentence case casing rules.
 * @param {{ name: string, description: string }} scenario - Scenario definition
 * @param {Array<any>} results - Array of scenario run result objects
 * @returns {string}
 */
export function renderAsciiScenarioTable(scenario, results) {
  if (!results || results.length === 0) return '';

  const headers = ['Optimization variant', 'Minified JS', 'Gzip', 'First render', 'Render speedup', 'Update latency', 'Update speedup'];

  const formattedRows = results.map((r) => {
    const rawSize = formatKb(r.metrics?.rawBytes || 0);
    const gzipSize = formatKb(r.metrics?.gzipBytes || 0);
    const firstRender = r.runtime?.firstRenderMs > 0 ? `${r.runtime.firstRenderMs.toFixed(2)} ms` : 'n/a';
    const update = r.runtime?.updateMs > 0 ? `${r.runtime.updateMs.toFixed(2)} ms` : 'n/a';
    const speedup = r.variant?.isBaseline ? 'baseline' : r.deltas?.speedupPercent !== undefined ? `${r.deltas.speedupPercent >= 0 ? '+' : ''}${r.deltas.speedupPercent.toFixed(1)}%` : 'n/a';
    const updateSpeedup = r.variant?.isBaseline
      ? 'baseline'
      : r.deltas?.updateSpeedupPercent !== undefined
        ? `${r.deltas.updateSpeedupPercent >= 0 ? '+' : ''}${r.deltas.updateSpeedupPercent.toFixed(1)}%`
        : 'n/a';

    return {
      cells: [r.variant?.name || r.variant?.id || 'Variant', rawSize, gzipSize, firstRender, speedup, update, updateSpeedup],
      isBaseline: !!r.variant?.isBaseline,
    };
  });

  const colWidths = headers.map((header, i) => {
    const maxDataWidth = Math.max(...formattedRows.map((r) => r.cells[i].length));
    return Math.max(header.length, maxDataWidth);
  });

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (colWidths.length - 1) * 3 + 4;
  const topBorder = `┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`;
  const midBorder = `├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`;
  const botBorder = `└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`;

  const headerLine = `│ ${headers.map((h, i) => (i === 0 ? h.padEnd(colWidths[i]) : h.padStart(colWidths[i]))).join(' │ ')} │`;

  const output = [];
  output.push(`\n${'═'.repeat(totalWidth)}`);
  output.push(`🎭 Scenario: ${scenario.name}`);
  output.push(`ℹ️  ${scenario.description}`);
  output.push(`${'═'.repeat(totalWidth)}`);
  output.push(topBorder);
  output.push(headerLine);
  output.push(midBorder);

  for (let idx = 0; idx < formattedRows.length; idx++) {
    const row = formattedRows[idx];
    const rowLine = `│ ${row.cells.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]) : c.padStart(colWidths[i]))).join(' │ ')} │`;
    output.push(rowLine);
    if (row.isBaseline && idx < formattedRows.length - 1) {
      output.push(midBorder);
    }
  }

  output.push(botBorder);
  return output.join('\n');
}
