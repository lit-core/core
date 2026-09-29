import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatComparisonMatrix, formatDiagnosticsTable, formatVersionsTable, loadBenchmarkResult, renderBenchmarkDoc, saveBenchmarkResult } from '../src/reporters/index.js';
import { createBenchmarkResult } from '../src/schema.js';

describe('reporters for decoupled benchmark output', () => {
  it('saves and loads structured JSON benchmark results', () => {
    const tempDir = path.resolve(__dirname, '../.temp-test-results');
    const result = createBenchmarkResult({
      benchmarkId: 'test-json',
      title: 'Test Benchmark',
      suites: [
        {
          id: 'carbon',
          name: 'IBM Carbon Web Components',
          baseline: { time: 100 },
          optimized: { time: 50 },
        },
      ],
    });

    const writtenPath = saveBenchmarkResult(result as any, { outDir: tempDir });
    expect(fs.existsSync(writtenPath)).toBe(true);

    const loaded = loadBenchmarkResult('test-json', tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.benchmarkId).toBe('test-json');
    expect(loaded?.suites[0].baseline.time).toBe(100);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('renders benchmark versions table in sentence case', () => {
    const table = formatVersionsTable();
    expect(table).toContain('## Benchmarked dependency versions');
    expect(table).toContain('| `@carbon/web-components` | IBM Carbon Design System | `2.64.0` |');
    expect(table).toContain('| `lit` | Core runtime | `3.3.3` | n/a |');
  });

  it('renders comparison matrix without any total column', () => {
    const suites = [
      { shortName: 'Carbon', baseline: { val: 100 }, optimized: { val: 20 } },
      { shortName: 'Spectrum', baseline: { val: 200 }, optimized: { val: 40 } },
    ];
    const metrics = [
      { label: 'Baseline latency', getValue: (s: any) => `${s.baseline.val} ms` },
      { label: 'Optimized latency', getValue: (s: any) => `${s.optimized.val} ms` },
    ];

    const matrix = formatComparisonMatrix(suites, metrics);
    expect(matrix).toContain('| Metric | Carbon | Spectrum |');
    expect(matrix).toContain('| Baseline latency | 100 ms | 200 ms |');
    expect(matrix).toContain('| Optimized latency | 20 ms | 40 ms |');

    // Strict constraint: NO "Total" column
    expect(matrix).not.toContain('Total');
    expect(matrix).not.toContain('average');
  });

  it('renders diagnostics table without any total row', () => {
    const suites = [
      { name: 'IBM Carbon', diagnostics: { count: 50 } },
      { name: 'Adobe Spectrum', diagnostics: { count: 30 } },
    ];
    const columns = [{ header: 'Components scanned', getValue: (s: any) => String(s.diagnostics.count) }];

    const table = formatDiagnosticsTable(suites, columns);
    expect(table).toContain('| Design system or library | Components scanned |');
    expect(table).toContain('| IBM Carbon | 50 |');
    expect(table).toContain('| Adobe Spectrum | 30 |');

    // Strict constraint: NO "Total" row
    expect(table).not.toContain('Total');
    expect(table).not.toContain('average');
  });

  it('renders complete benchmark doc adhering to sentence case and invariants', () => {
    const doc = renderBenchmarkDoc({
      title: '`@lit-core/test` empirical benchmark results',
      leadParagraph: 'Test paragraph description.',
      comparisonHeading: 'Performance comparison',
      comparisonDescription: 'Comparing baseline vs optimized:',
      suites: [{ shortName: 'Carbon', name: 'IBM Carbon Web Components', baseline: { v: 10 }, optimized: { v: 5 } }],
      metrics: [{ label: 'Metric A', getValue: (s: any) => `${s.optimized.v}` }],
      note: 'Test note callout.',
      runCommand: 'node test.js',
      invariants: ['Invariant 1', 'Invariant 2'],
      relatedDocs: [{ label: 'Executive overview', url: '../README.md' }],
    });

    expect(doc).toContain('# `@lit-core/test` empirical benchmark results');
    expect(doc).toContain('## Benchmarked dependency versions');
    expect(doc).toContain('## Performance comparison');
    expect(doc).toContain('> [!NOTE]');
    expect(doc).toContain('## Running this benchmark');
    expect(doc).toContain('## Architectural highlights and invariants');
    expect(doc).toContain('## Related documentation');
    expect(doc).not.toContain('Total / average');
  });
});
