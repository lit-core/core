#!/usr/bin/env node
/**
 * Renders the "Edge head-to-head benchmark results" table of docs/claims.md directly from the
 * committed benchmark artifact, so the ledger cannot drift from the data by hand editing.
 *
 * Usage:
 *   node packages/internal/benchmarks/src/render-claims-table.js          # rewrite docs/claims.md
 *   node packages/internal/benchmarks/src/render-claims-table.js --check  # exit 1 if out of date
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const resultPath = path.join(root, 'packages/internal/benchmarks/results/edge-head-to-head.json');
const claimsPath = path.join(root, 'docs/claims.md');
const SECTION_HEADING = '## Edge head-to-head benchmark results';
const COMMAND = '`node packages/internal/benchmarks/src/features/edge-head-to-head.js --verbose`';

/** @param {number} n */
const bytes = (n) => `${n.toLocaleString('en-US')} B`;
/** @param {number} n */
const ms = (n) => `${n} ms`;
/**
 * @param {number} a
 * @param {number} c
 */
const pct = (a, c) => {
  const delta = ((a - c) / c) * 100;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`;
};

/** @param {{ suites: Array<{ id: string; metrics: Record<string, any> }>; summary?: Record<string, any>; plainSsr?: any }} data */
export function buildTable(data) {
  const byId = Object.fromEntries(data.suites.map((/** @type {{ id: string; metrics: Record<string, any> }} */ s) => [s.id, s.metrics]));
  const a = byId['target-a'];
  const c = byId['target-c'];
  const d = byId['target-d'];
  const plain =
    data.summary?.plainSsrProductPage ||
    (() => {
      const w = data.plainSsr?.workloads?.find((/** @type {any} */ item) => item.id === 'product-page');
      if (!w) return null;
      return {
        litCoreWorkerdMedianMs: w.litCore.workerdCpuMedianMs,
        litLabsWorkerdMedianMs: w.litLabs.workerdCpuMedianMs,
        litCoreNodeMedianMs: w.litCore.nodeCpuMedianMs,
        litLabsNodeMedianMs: w.litLabs.nodeCpuMedianMs,
        litCoreRawBytes: w.litCore.rawBytes,
        litLabsRawBytes: w.litLabs.rawBytes,
      };
    })();
  /** @param {string} metric */
  const byteDelta = (metric) => `${a[metric] - c[metric] > 0 ? '+' : ''}${a[metric] - c[metric]} B vs baseline`;

  const rows = [
    ['Metric', 'Lit server elements (@lit-core)', 'HTMLRewriter + REST baseline', '@lit-labs/ssr', 'Relative delta vs baseline', 'Reproducible command'],
    ['Client JavaScript bundle (gzip)', bytes(a.clientJsGzipBytes), bytes(c.clientJsGzipBytes), bytes(d.clientJsGzipBytes), pct(a.clientJsGzipBytes, c.clientJsGzipBytes), COMMAND],
    ['Client JavaScript bundle (brotli)', bytes(a.clientJsBrotliBytes), bytes(c.clientJsBrotliBytes), bytes(d.clientJsBrotliBytes), pct(a.clientJsBrotliBytes, c.clientJsBrotliBytes), COMMAND],
    ['Client JavaScript bundle (raw)', bytes(a.clientJsRawBytes), bytes(c.clientJsRawBytes), bytes(d.clientJsRawBytes), pct(a.clientJsRawBytes, c.clientJsRawBytes), COMMAND],
    ['Action wire mutation payload (raw)', bytes(a.actionWireRawBytes), bytes(c.actionWireRawBytes), 'Not supported', pct(a.actionWireRawBytes, c.actionWireRawBytes), COMMAND],
    ['Action wire mutation payload (gzip)', bytes(a.actionWireGzipBytes), bytes(c.actionWireGzipBytes), 'Not supported', pct(a.actionWireGzipBytes, c.actionWireGzipBytes), COMMAND],
    ['Initial Declarative Shadow DOM (raw)', bytes(a.initialHtmlRawBytes), bytes(c.initialHtmlRawBytes), bytes(d.initialHtmlRawBytes), byteDelta('initialHtmlRawBytes'), COMMAND],
    ['Initial Declarative Shadow DOM (gzip)', bytes(a.initialHtmlGzipBytes), bytes(c.initialHtmlGzipBytes), bytes(d.initialHtmlGzipBytes), byteDelta('initialHtmlGzipBytes'), COMMAND],
    [
      'Comment nodes in full document (`COMMENT_NODE`)',
      String(a.commentMarkersCount),
      String(c.commentMarkersCount),
      String(d.commentMarkersCount),
      pct(a.commentMarkersCount, c.commentMarkersCount),
      COMMAND,
    ],
    [
      'Server render CPU, Cloudflare workerd warm median',
      ms(a.workerdRenderCpuMedianMs),
      ms(c.workerdRenderCpuMedianMs),
      ms(d.workerdRenderCpuMedianMs),
      pct(a.workerdRenderCpuMedianMs, c.workerdRenderCpuMedianMs),
      COMMAND,
    ],
    [
      'Action mutation CPU, Cloudflare workerd warm median',
      ms(a.workerdActionCpuMedianMs),
      ms(c.workerdActionCpuMedianMs),
      'Not supported',
      pct(a.workerdActionCpuMedianMs, c.workerdActionCpuMedianMs),
      COMMAND,
    ],
    ['Server render CPU, Node.js warm median', ms(a.nodeRenderCpuMedianMs), ms(c.nodeRenderCpuMedianMs), ms(d.nodeRenderCpuMedianMs), pct(a.nodeRenderCpuMedianMs, c.nodeRenderCpuMedianMs), COMMAND],
    ['Action mutation CPU, Node.js warm median', ms(a.nodeActionCpuMedianMs), ms(c.nodeActionCpuMedianMs), 'Not supported', pct(a.nodeActionCpuMedianMs, c.nodeActionCpuMedianMs), COMMAND],
    ['Out-of-order boundary arrival in workerd (fast boundary)', ms(a.fastChunkMs), ms(c.fastChunkMs), ms(d.fastChunkMs), `${ms(a.slowChunkMs)} slow boundary`, COMMAND],
  ];

  if (plain) {
    rows.push(
      ['Plain SSR product page (raw bytes, identical tree)', bytes(plain.litCoreRawBytes), 'Not applicable', bytes(plain.litLabsRawBytes), pct(plain.litCoreRawBytes, plain.litLabsRawBytes), COMMAND],
      [
        'Plain SSR product page CPU, Cloudflare workerd median',
        ms(plain.litCoreWorkerdMedianMs),
        'Not applicable',
        ms(plain.litLabsWorkerdMedianMs),
        pct(plain.litCoreWorkerdMedianMs, plain.litLabsWorkerdMedianMs),
        COMMAND,
      ],
      [
        'Plain SSR product page CPU, Node.js median',
        ms(plain.litCoreNodeMedianMs),
        'Not applicable',
        ms(plain.litLabsNodeMedianMs),
        pct(plain.litCoreNodeMedianMs, plain.litLabsNodeMedianMs),
        COMMAND,
      ],
    );
  }

  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  /** @param {string[]} r */
  const line = (r) => `| ${r.map((cell, i) => cell.padEnd(widths[i])).join(' | ')} |`;
  const separator = `| ${widths.map((w) => `:${'-'.repeat(w - 1)}`).join(' | ')} |`;
  return [line(rows[0]), separator, ...rows.slice(1).map(line)].join('\n');
}

/**
 * @param {string} claims
 * @param {{ suites: Array<{ id: string; metrics: Record<string, any> }>; summary?: Record<string, any>; plainSsr?: any }} data
 */
export function renderClaims(claims, data) {
  const lines = claims.split('\n');
  const heading = lines.findIndex((/** @type {string} */ l) => l.trim() === SECTION_HEADING);
  if (heading === -1) throw new Error(`Missing "${SECTION_HEADING}" in docs/claims.md`);
  let start = heading + 1;
  while (start < lines.length && !lines[start].startsWith('|')) start++;
  let end = start;
  while (end < lines.length && lines[end].startsWith('|')) end++;
  return [...lines.slice(0, start), ...buildTable(data).split('\n'), ...lines.slice(end)].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  const current = fs.readFileSync(claimsPath, 'utf-8');
  const next = renderClaims(current, data);
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('docs/claims.md is out of date with edge-head-to-head.json. Run render-claims-table.js.');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(claimsPath, next);
    console.log('docs/claims.md edge table regenerated from edge-head-to-head.json');
  }
}
