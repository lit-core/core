import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  escapeScriptContent,
  formatComparisonMatrix,
  formatDiagnosticsTable,
  formatVersionsTable,
  generateArtifactHtml,
  loadBenchmarkResult,
  renderBenchmarkDoc,
  saveArtifactHtml,
  saveBenchmarkResult,
} from '../src/reporters/index.js';
import { runSuiteBenchmark } from '../src/runner.js';
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

  it('escapes script tags inside inline bundle code', () => {
    const raw = 'const x = "</script><script>alert(1)</script>";';
    const escaped = escapeScriptContent(raw);
    expect(escaped).not.toContain('</script>');
    expect(escaped).toContain('<\\/script>');
  });

  it('generates self-contained inline HTML artifact adhering to sentence case', () => {
    const html = generateArtifactHtml({
      bundleCode: 'console.log("hello world");',
      suiteName: 'Carbon Web Components',
      suiteId: 'carbon',
      variant: 'baseline',
      metrics: { rawBytes: 20480, gzipBytes: 5120, buildTimeMs: 120 } as any,
      metadata: { componentCount: 42 },
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Benchmark artifact: Carbon Web Components (baseline)</title>');
    expect(html).toContain('<h1>Carbon Web Components</h1>');
    expect(html).toContain('<span class="badge">baseline</span>');
    expect(html).toContain('Component live preview');
    expect(html).toContain('console.log("hello world");');
    expect(html).toContain('20.00 KB');
    expect(html).toContain('5.00 KB');
    expect(html).toContain('120.00 ms');
  });

  it('saves and writes self-contained inline HTML benchmark artifact to disk', () => {
    const tempDir = path.resolve(__dirname, '../.temp-test-artifacts');
    const mockBundle = path.join(tempDir, 'mock-bundle.js');
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(mockBundle, 'customElements.define("my-element", class extends HTMLElement {});', 'utf-8');

    const htmlPath = saveArtifactHtml({
      bundlePath: mockBundle,
      suiteName: 'IBM Carbon Web Components',
      suiteId: 'carbon',
      variant: 'css-fuse',
      metrics: { rawBytes: 1024, gzipBytes: 512, buildTimeMs: 50 } as any,
      outDir: path.join(tempDir, 'carbon'),
    });

    expect(htmlPath).not.toBeNull();
    expect(fs.existsSync(htmlPath!)).toBe(true);
    expect(htmlPath).toBe(path.join(tempDir, 'carbon/css-fuse.html'));

    const content = fs.readFileSync(htmlPath!, 'utf-8');
    expect(content).toContain('customElements.define("my-element"');
    expect(content).toContain('IBM Carbon Web Components');
    expect(content).toContain('css-fuse');

    // Missing bundle returns null safely
    const missing = saveArtifactHtml({
      bundlePath: path.join(tempDir, 'nonexistent.js'),
      suiteName: 'Test',
      suiteId: 'test',
      variant: 'baseline',
    });
    expect(missing).toBeNull();

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves HTML artifacts during runSuiteBenchmark execution', async () => {
    const tempDir = path.resolve(__dirname, '../.temp-runner-artifacts-test');
    const artifactsDir = path.join(tempDir, 'artifacts');
    fs.mkdirSync(tempDir, { recursive: true });

    const entryPath = path.join(tempDir, 'entry.js');
    fs.writeFileSync(entryPath, 'customElements.define("test-runner-elem", class extends HTMLElement {});', 'utf-8');

    const mockSuite = {
      id: 'mock-suite',
      name: 'Mock Suite',
      description: 'Mock suite description',
      isAvailable: () => true,
      async setup() {
        return {
          id: 'mock-suite',
          name: 'Mock Suite',
          entryPath,
          componentCount: 1,
          metadata: { componentCount: 1 },
        };
      },
      async cleanup() {},
    };

    const result = await runSuiteBenchmark(mockSuite as any, [], {
      artifactsDir,
      saveArtifacts: true,
    });

    expect(result.artifacts).toBeDefined();
    expect(result.artifacts?.length).toBeGreaterThan(0);
    const baselineArtifact = result.artifacts?.[0];
    expect(baselineArtifact).toBe(path.join(artifactsDir, 'mock-suite/baseline.html'));
    expect(fs.existsSync(baselineArtifact!)).toBe(true);

    const content = fs.readFileSync(baselineArtifact!, 'utf-8');
    expect(content).toContain('test-runner-elem');
    expect(content).toContain('Mock Suite');
    expect(content).toContain('Component live preview');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
