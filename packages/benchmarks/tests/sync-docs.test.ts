import { describe, expect, it } from 'vitest';
import { extractTableUnderHeading, formatDedicatedToolTable, formatExecutiveOverviewTable, formatRootSummaryTable, parseTableCells, replaceTableUnderHeading } from '../src/sync-docs.js';

describe('sync-docs markdown table formatting and synchronization', () => {
  const sampleMarkdown = `
# Sample doc

## Bundle size and runtime performance comparison

| Metric | Carbon Web Components (99 elements) | Spectrum Web Components (52 elements) |
| :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 1,739.92 KB |
| **Optimized bundle size** | 5,799.20 KB | 1,736.80 KB |

## Another section
Some text here.
`;

  it('extracts table under target heading accurately', () => {
    const table = extractTableUnderHeading(sampleMarkdown, /## Bundle size and runtime performance comparison/);
    expect(table).not.toBeNull();
    expect(table).toContain('Metric');
    expect(table).toContain('5,801.88 KB');
  });

  it('replaces table under target heading cleanly without affecting surrounding text', () => {
    const newTable = `| Metric | Test Col |\n| :--- | :--- |\n| Value | 123 |`;
    const replaced = replaceTableUnderHeading(sampleMarkdown, /## Bundle size and runtime performance comparison/, newTable);

    expect(replaced).toContain('## Bundle size and runtime performance comparison\n\n| Metric | Test Col |');
    expect(replaced).toContain('## Another section\nSome text here.');
    expect(replaced).not.toContain('5,801.88 KB');
  });

  it('parses table cells correctly into 2D array', () => {
    const tableStr = `| Header 1 | Header 2 |\n| :--- | :--- |\n| Val 1 | Val 2 |`;
    const cells = parseTableCells(tableStr);
    expect(cells).toEqual([
      ['Header 1', 'Header 2'],
      [':---', ':---'],
      ['Val 1', 'Val 2'],
    ]);
  });

  it('formats root summary table and computes totals correctly', () => {
    const allResults = [
      {
        suiteId: 'carbon',
        componentCount: 99,
        rows: [
          { isBaseline: true, metrics: { rawBytes: 5941125, buildTimeMs: 200 } },
          { isTotal: true, metrics: { rawBytes: 2874787, buildTimeMs: 1500 } },
        ],
        runtimeRows: [
          { isBaseline: true, firstRenderMs: 15.2 },
          { isTotal: true, firstRenderMs: 9.8, speedupPercent: 35.5 },
        ],
      },
    ];

    const existingTable = `
| Design system or library | Elements | Baseline size | Optimized size | Net savings | First render speedup |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Carbon Web Components | 99 | 5,801.88 KB | 2,807.41 KB | **-2,994.47 KB (-51.61%)** | **+35.8%** |
| Spectrum Web Components | 52 | 1,739.92 KB | 1,740.01 KB | **+0.09 KB (+0.01%)** | **+35.4%** |
`;

    const formatted = formatRootSummaryTable(allResults, existingTable);
    expect(formatted).toContain('Carbon Web Components');
    expect(formatted).toContain('Spectrum Web Components');
    expect(formatted).not.toContain('**Total**');
  });

  it('formats executive overview table merging fresh results with existing columns', () => {
    const allResults = [
      {
        suiteId: 'material',
        componentCount: 28,
        rows: [
          { isBaseline: true, metrics: { rawBytes: 459130, buildTimeMs: 40 } },
          { isTotal: true, metrics: { rawBytes: 461301, buildTimeMs: 350 } },
        ],
        runtimeRows: [
          { isBaseline: true, firstRenderMs: 14.9 },
          { isTotal: true, firstRenderMs: 9.7, speedupPercent: 34.9 },
        ],
      },
    ];

    const existingTable = `
| Metric | Carbon Web Components (99 elements) | Material Web (28 elements) |
| :--- | :--- | :--- |
| **Baseline bundle size** | 5,801.88 KB | 448.37 KB |
| **Optimized bundle size** | 2,807.41 KB | 450.49 KB |
| **Net bundle savings** | **-2,994.47 KB (-51.61%)** | **+2.11 KB (+0.47%)** |
| **Baseline build time** | 185 ms | 32 ms |
| **Optimized build time** | 1,578 ms | 328 ms |
| **Build overhead** | +1,393 ms | +296 ms |
| **First render speedup** | **+35.8% faster** | **+34.5% faster** |
`;

    const formatted = formatExecutiveOverviewTable(allResults, existingTable);
    expect(formatted).toContain('**Baseline bundle size**');
    expect(formatted).toContain('5,801.88 KB'); // Carbon preserved
    expect(formatted).toContain('448.37 KB'); // Material updated
    expect(formatted).toContain('+34.9% faster'); // Fresh speedup
  });

  it('formats dedicated tool comparison table with neutral latency notes for static AST transforms', () => {
    const allResults = [
      {
        suiteId: 'carbon',
        componentCount: 99,
        rows: [
          { isBaseline: true, metrics: { rawBytes: 5941125 } },
          { name: 'html-fuse (static HTML/SVG template deduplication)', metrics: { rawBytes: 5938380 } },
        ],
        runtimeRows: [
          { isBaseline: true, firstRenderMs: 15.2, updateMs: 3.48 },
          {
            name: 'html-fuse (static HTML/SVG template deduplication)',
            firstRenderMs: 15.1,
            updateMs: 3.46,
            speedupPercent: 0.6,
          },
        ],
      },
    ];

    const formatted = formatDedicatedToolTable('html-fuse', allResults);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('**Baseline mount latency**');
    expect(formatted).toContain('15.20 ms');
    expect(formatted).toContain('15.10 ms');
    expect(formatted).toContain('+0.6% (neutral)');
  });
});
