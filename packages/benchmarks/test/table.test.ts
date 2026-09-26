import { describe, it, expect } from 'vitest';
import { renderAsciiRuntimeTable, renderAsciiTable, renderMarkdownOverviewTable, renderMarkdownRuntimeTable } from '../src/table.js';

describe('benchmarks table formatting and runtime performance rendering', () => {
  it('renders top table with static bundle size analysis header in Markdown', () => {
    const summaryRows = [
      {
        suiteName: 'Web Awesome',
        componentCount: 73,
        baselineRaw: 200000,
        baselineGzip: 60000,
        totalRaw: 160000,
        totalGzip: 52000,
        rawSaved: 40000,
        rawPct: 20,
        gzipSaved: 8000,
        gzipPct: 13.3,
      },
      {
        suiteName: 'OVERALL TOTAL (All Libraries)',
        componentCount: 73,
        baselineRaw: 200000,
        baselineGzip: 60000,
        totalRaw: 160000,
        totalGzip: 52000,
        rawSaved: 40000,
        rawPct: 20,
        gzipSaved: 8000,
        gzipPct: 13.3,
      },
    ];

    const output = renderMarkdownOverviewTable(summaryRows);
    expect(output).toContain('### 📦 Static bundle size analysis');
    expect(output).toContain('Web Awesome');
    expect(output).toContain('Net savings');
  });

  it('renders runtime performance table in Markdown with sentence case', () => {
    const runtimeRows = [
      {
        name: 'Baseline (Standard Vite)',
        firstRenderMs: 14.5,
        updateMs: 3.2,
        isBaseline: true,
      },
      {
        name: 'htmlAot (Ahead-of-time Lit template compilation)',
        firstRenderMs: 9.8,
        updateMs: 3.1,
        speedupPercent: 32.4,
      },
      {
        name: 'TOTAL (All Optimizations Combined)',
        firstRenderMs: 8.6,
        updateMs: 2.9,
        speedupPercent: 40.7,
        isTotal: true,
      },
    ];

    const markdownOutput = renderMarkdownRuntimeTable(runtimeRows);
    expect(markdownOutput).toContain('### ⏱️ Runtime performance');
    expect(markdownOutput).toContain('First render (mount)');
    expect(markdownOutput).toContain('Re-render (update)');
    expect(markdownOutput).toContain('Render speedup');
    expect(markdownOutput).toContain('14.50 ms');
    expect(markdownOutput).toContain('9.80 ms');
    expect(markdownOutput).toContain('+32.4%');
    expect(markdownOutput).toContain('+40.7%');

    const asciiOutput = renderAsciiRuntimeTable('Test Suite runtime performance', runtimeRows);
    expect(asciiOutput).toContain('Test Suite runtime performance');
    expect(asciiOutput).toContain('First render (mount)');
    expect(asciiOutput).toContain('14.50 ms');
  });
});
