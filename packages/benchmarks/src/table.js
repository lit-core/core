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
  const headers = ['Optimization Tool / Mode', 'Minified JS', 'Gzip', 'Brotli', 'Raw Impact (Δ)', 'Gzip Impact (Δ)'];

  const formattedRows = rows.map((r) => {
    const rawSize = formatKb(r.metrics.rawBytes);
    const gzipSize = formatKb(r.metrics.gzipBytes);
    const brotliSize = formatKb(r.metrics.brotliBytes);
    const rawImpact = r.isBaseline ? '—' : formatImpact(r.impact?.rawDiff ?? 0, r.impact?.rawPercent ?? 0);
    const gzipImpact = r.isBaseline ? '—' : formatImpact(r.impact?.gzipDiff ?? 0, r.impact?.gzipPercent ?? 0);

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
    if (row.isTotal) {
      output.push(doubleMidBorder);
    }
    const line = `│ ${row.cells.map((c, i) => (i === 0 ? c.padEnd(colWidths[i]) : c.padStart(colWidths[i]))).join(' │ ')} │`;
    output.push(line);
  }

  output.push(botBorder);
  return output.join('\n');
}

/**
 * Format benchmark rows as a Markdown table (e.g. for GitHub PRs, READMEs, CI).
 * @param {string} title
 * @param {TableRow[]} rows
 * @returns {string}
 */
export function renderMarkdownTable(title, rows) {
  const headers = ['Optimization tool or mode', 'Size', 'Savings'];
  const alignments = [':---', '---:', '---:'];

  const lines = [];
  lines.push(`### 📊 ${title}`);
  lines.push('');
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${alignments.join(' | ')} |`);

  for (const r of rows) {
    const rawSize = formatKb(r.metrics.rawBytes);
    const rawImpact = r.isBaseline ? '—' : formatImpact(r.impact?.rawDiff ?? 0, r.impact?.rawPercent ?? 0);
    const namePrefix = r.isTotal ? '**TOTAL** ' : r.isBaseline ? '*Baseline* ' : '';
    lines.push(`| ${namePrefix}${r.name} | ${rawSize} | ${rawImpact} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format a multi-suite overview table in ASCII.
 * @param {Array<{ suiteName: string, componentCount: number, baselineRaw: number, baselineGzip: number, totalRaw: number, totalGzip: number, rawSaved: number, rawPct: number, gzipSaved: number, gzipPct: number }>} summaryRows
 * @returns {string}
 */
export function renderCrossSuiteSummary(summaryRows) {
  const headers = ['Design System / Library', 'Elements', 'Baseline (Raw / Gzip)', 'Optimized (Raw / Gzip)', 'Net Savings (Raw / Gzip)'];

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
  output.push(`🏆 CROSS-LIBRARY IMPACT OVERVIEW (ALL CONFIGS ENABLED)`);
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
 * Format overview table of all libraries with all configs enabled in Markdown.
 * @param {Array<{ suiteName: string, componentCount: number, baselineRaw: number, baselineGzip: number, totalRaw: number, totalGzip: number, rawSaved: number, rawPct: number, gzipSaved: number, gzipPct: number }>} summaryRows
 * @returns {string}
 */
export function renderMarkdownOverviewTable(summaryRows) {
  const headers = ['Design system or library', 'Elements', 'Baseline size', 'Optimized size', 'Net savings'];
  const alignments = [':---', '---:', '---:', '---:', '---:'];

  const lines = [];
  lines.push('### 📊 Results summary');
  lines.push('');
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${alignments.join(' | ')} |`);

  for (const s of summaryRows) {
    const rawDiffStr = formatImpact(-s.rawSaved, -s.rawPct);
    const isOverall = s.suiteName.includes('TOTAL');
    const name = isOverall ? 'Total' : s.suiteName;
    const prefix = isOverall ? '**' : '';
    const suffix = isOverall ? '**' : '';

    lines.push(`| ${prefix}${name}${suffix} | ${s.componentCount} | ${formatKb(s.baselineRaw)} | ${formatKb(s.totalRaw)} | ${prefix}${rawDiffStr}${suffix} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format an accordion containing one table per tool across all libraries tested (no gzip, regular sizes only).
 * @param {Array<{ suiteName: string, componentCount: number, rows: TableRow[] }>} allResults
 * @returns {string}
 */
export function renderMarkdownPerToolAccordion(allResults) {
  // Find all distinct tools (excluding baseline and total)
  /** @type {string[]} */
  const toolNames = [];
  for (const res of allResults) {
    for (const r of res.rows) {
      if (!r.isBaseline && !r.isTotal && !toolNames.includes(r.name)) {
        toolNames.push(r.name);
      }
    }
  }

  if (toolNames.length === 0) return '';

  const lines = [];
  lines.push('<details>');
  lines.push('<summary><strong>Per-tool impact breakdown</strong> — Click to expand individual tool tables</summary>\n');

  for (const toolName of toolNames) {
    lines.push(`### ${toolName}\n`);
    const headers = ['Design system or library', 'Elements', 'Baseline size', 'Optimized size', 'Savings'];
    const alignments = [':---', '---:', '---:', '---:', '---:'];
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${alignments.join(' | ')} |`);

    let totalBaseline = 0;
    let totalOptimized = 0;
    let totalElements = 0;

    for (const res of allResults) {
      const baselineRow = res.rows.find((r) => r.isBaseline);
      const toolRow = res.rows.find((r) => r.name === toolName);
      if (baselineRow && toolRow) {
        const baselineSize = baselineRow.metrics.rawBytes;
        const optSize = toolRow.metrics.rawBytes;
        const savings = toolRow.impact ? formatImpact(toolRow.impact.rawDiff, toolRow.impact.rawPercent) : '—';
        totalBaseline += baselineSize;
        totalOptimized += optSize;
        totalElements += res.componentCount;
        lines.push(`| ${res.suiteName} | ${res.componentCount} | ${formatKb(baselineSize)} | ${formatKb(optSize)} | ${savings} |`);
      }
    }

    const totalDiff = totalOptimized - totalBaseline;
    const totalPct = totalBaseline > 0 ? (totalDiff / totalBaseline) * 100 : 0;
    const totalSavingsStr = totalDiff === 0 ? '—' : formatImpact(totalDiff, totalPct);
    lines.push(`| **Total** | **${totalElements}** | **${formatKb(totalBaseline)}** | **${formatKb(totalOptimized)}** | **${totalSavingsStr}** |\n`);
  }

  lines.push('</details>\n');
  return lines.join('\n');
}

/**
 * Format deduplication diagnostics across libraries as a clean Markdown table.
 * @param {Array<{ suiteName: string, diagnostics?: Record<string, any> }>} allResults
 * @returns {string}
 */
export function renderMarkdownDiagnosticsTable(allResults) {
  const headers = ['Design system or library', 'Rules scanned', 'Duplicate rules fused', 'Shared sheets created', 'Chunks rewritten'];
  const alignments = [':---', '---:', '---:', '---:', '---:'];

  const lines = [];
  lines.push('### 🔬 Deduplication diagnostics');
  lines.push('');
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${alignments.join(' | ')} |`);

  for (const res of allResults) {
    if (res.diagnostics) {
      for (const diag of Object.values(res.diagnostics)) {
        if (diag.rulesScanned !== undefined) {
          lines.push(
            `| **${res.suiteName}** | ${diag.rulesScanned.toLocaleString()} | ${diag.rulesDeduped.toLocaleString()} | ${diag.fusedSheetsCreated.toLocaleString()} | ${diag.componentsRewritten.toLocaleString()} |`,
          );
        }
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
