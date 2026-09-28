import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPENDENCY_VERSIONS } from '../schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDocsDir = path.resolve(__dirname, '../../docs');

/**
 * Format standard benchmarked dependency versions table.
 * Reusable across all benchmark documents.
 * @param {Record<string, { role: string, version: string, elements?: string | number }>} [versions]
 * @returns {string}
 */
export function formatVersionsTable(versions = DEPENDENCY_VERSIONS) {
  const lines = ['## Benchmarked dependency versions', '', '| Package | Role | Version evaluated | Elements evaluated |', '| :--- | :--- | :--- | ---: |'];

  for (const [pkg, info] of Object.entries(versions)) {
    const elStr = typeof info.elements === 'number' ? `${info.elements} elements` : info.elements || 'n/a';
    lines.push(`| \`${pkg}\` | ${info.role} | \`${info.version}\` | ${elStr} |`);
  }

  return lines.join('\n');
}

/**
 * @typedef {Object} MetricDefinition
 * @property {string} label - Human-readable sentence-case label (e.g. 'Baseline expression evaluations')
 * @property {(suite: any) => string} getValue - Function extracting formatted value from suite
 * @property {boolean} [bold=false] - Whether to bold row label
 */

/**
 * Format a multi-suite comparison matrix table.
 * IMPORTANT: Strictly omits 'Total' columns to keep reports focused and compliant.
 * @param {Array<any>} suites
 * @param {Array<MetricDefinition>} metrics
 * @returns {string}
 */
export function formatComparisonMatrix(suites, metrics) {
  const headers = ['Metric', ...suites.map((s) => s.shortName || s.name.replace(' Web Components', '').replace(' Design', ''))];
  const alignments = [':---', ...suites.map(() => '---:')];

  const lines = [`| ${headers.join(' | ')} |`, `| ${alignments.join(' | ')} |`];

  for (const m of metrics) {
    const label = m.bold ? `**${m.label}**` : m.label;
    const cells = suites.map((s) => m.getValue(s));
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * @typedef {Object} DiagnosticColumn
 * @property {string} header - Sentence-case column header (e.g. 'Components scanned')
 * @property {'left' | 'right'} [align='right']
 * @property {(suite: any) => string} getValue
 */

/**
 * Format a compilation and diagnostics table.
 * IMPORTANT: Strictly omits 'Total' rows.
 * @param {Array<any>} suites
 * @param {Array<DiagnosticColumn>} columns
 * @param {string} [nameHeader='Design system or library']
 * @returns {string}
 */
export function formatDiagnosticsTable(suites, columns, nameHeader = 'Design system or library') {
  const headers = [nameHeader, ...columns.map((c) => c.header)];
  const alignments = [':---', ...columns.map((c) => (c.align === 'left' ? ':---' : '---:'))];

  const lines = [`| ${headers.join(' | ')} |`, `| ${alignments.join(' | ')} |`];

  for (const s of suites) {
    const cells = columns.map((c) => c.getValue(s));
    lines.push(`| ${s.name} | ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

/**
 * @typedef {Object} BenchmarkDocConfig
 * @property {string} title - Document title (e.g. '`@lit-core/dirty-mask` empirical benchmark results')
 * @property {string} leadParagraph - Executive summary paragraph
 * @property {string} comparisonHeading - Sentence case heading for comparison section
 * @property {string} comparisonDescription - Description preceding comparison matrix
 * @property {Array<any>} suites - Suite results array
 * @property {Array<MetricDefinition>} metrics - Metrics definitions for comparison matrix
 * @property {string} note - Markdown text for > [!NOTE] callout
 * @property {string} [diagnosticsHeading] - Heading for diagnostics section
 * @property {string} [diagnosticsDescription] - Description for diagnostics section
 * @property {Array<DiagnosticColumn>} [diagnosticsColumns] - Columns for diagnostics table
 * @property {string} [runCommand] - Shell command to run this benchmark
 * @property {string[]} invariants - List of architectural highlights / invariants bullets
 * @property {Array<{ label: string, url: string }>} relatedDocs - Related documentation links
 * @property {Record<string, any>} [versions] - Optional custom dependency versions table
 */

/**
 * Render a complete, standardized benchmark markdown document.
 * Adheres strictly to monorepo sentence case guidelines and omits total rows/columns.
 * @param {BenchmarkDocConfig} config
 * @returns {string}
 */
export function renderBenchmarkDoc(config) {
  const lines = [];

  // 1. Title and lead paragraph
  lines.push(`# ${config.title}`);
  lines.push('');
  lines.push(config.leadParagraph);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 2. Benchmarked dependency versions table (reusable across all benchmarks)
  lines.push(formatVersionsTable(config.versions));
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3. Comparison matrix section
  lines.push(`## ${config.comparisonHeading}`);
  lines.push('');
  lines.push(config.comparisonDescription);
  lines.push('');
  lines.push(formatComparisonMatrix(config.suites, config.metrics));
  lines.push('');

  // 4. Note callout
  if (config.note) {
    lines.push('> [!NOTE]');
    lines.push(`> ${config.note}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 5. Diagnostics section
  if (config.diagnosticsColumns && config.diagnosticsColumns.length > 0) {
    lines.push(`## ${config.diagnosticsHeading || 'Compilation diagnostics'}`);
    lines.push('');
    if (config.diagnosticsDescription) {
      lines.push(config.diagnosticsDescription);
      lines.push('');
    }
    lines.push(formatDiagnosticsTable(config.suites, config.diagnosticsColumns));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 6. Running this benchmark
  if (config.runCommand) {
    lines.push('## Running this benchmark');
    lines.push('');
    lines.push('```bash');
    lines.push(config.runCommand);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 7. Architectural highlights and invariants
  if (config.invariants && config.invariants.length > 0) {
    lines.push('## Architectural highlights and invariants');
    lines.push('');
    for (const inv of config.invariants) {
      lines.push(`- ${inv}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 8. Related documentation
  if (config.relatedDocs && config.relatedDocs.length > 0) {
    lines.push('## Related documentation');
    lines.push('');
    for (const doc of config.relatedDocs) {
      lines.push(`- [${doc.label}](${doc.url})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Synchronize content to a documentation file in packages/benchmarks/docs/.
 * @param {string} filename - Filename (e.g. 'dirty-mask.md')
 * @param {string} content - Markdown content
 * @param {string} [docsDir] - Docs directory override
 * @returns {string} File path written
 */
export function syncDocFile(filename, content, docsDir = defaultDocsDir) {
  fs.mkdirSync(docsDir, { recursive: true });
  const docPath = path.join(docsDir, filename);
  fs.writeFileSync(docPath, content, 'utf-8');
  return docPath;
}
