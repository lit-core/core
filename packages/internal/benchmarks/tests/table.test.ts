import { describe, expect, it } from 'vitest';
import { renderAsciiRuntimeTable, renderAsciiTable, renderCrossSuiteSummary } from '../src/table.js';

describe('benchmarks ASCII terminal table formatting', () => {
  it('renders ASCII table with headers and box borders', () => {
    const rows = [
      {
        name: 'Baseline (Standard Vite)',
        metrics: { rawBytes: 200000, gzipBytes: 60000, brotliBytes: 50000, buildTimeMs: 100 },
        isBaseline: true,
      },
      {
        name: 'css-fuse',
        metrics: { rawBytes: 180000, gzipBytes: 54000, brotliBytes: 45000, buildTimeMs: 120 },
        impact: { rawDiff: -20000, rawPercent: -10, gzipDiff: -6000, gzipPercent: -10 },
      },
    ];

    const output = renderAsciiTable('Carbon Web Components', rows as any);
    expect(output).toContain('Carbon Web Components');
    expect(output).toContain('Baseline (Standard Vite)');
    expect(output).toContain('css-fuse');
    expect(output).toContain('Minified JS');
    expect(output).toContain('Gzip');
  });

  it('renders runtime performance ASCII table in sentence case', () => {
    const runtimeRows = [
      {
        name: 'Baseline (Standard Vite)',
        firstRenderMs: 14.5,
        updateMs: 3.2,
        isBaseline: true,
      },
      {
        name: 'html-aot',
        firstRenderMs: 9.8,
        updateMs: 3.1,
        speedupPercent: 32.4,
      },
    ];

    const asciiOutput = renderAsciiRuntimeTable('Test Suite runtime performance', runtimeRows);
    expect(asciiOutput).toContain('Test Suite runtime performance');
    expect(asciiOutput).toContain('First render');
    expect(asciiOutput).toContain('14.50 ms');
    expect(asciiOutput).toContain('+32.4%');
  });

  it('renders extended runtime metrics including script eval, registration, and heap when present', () => {
    const runtimeRows = [
      {
        name: 'Baseline (Standard Vite)',
        firstRenderMs: 14.5,
        updateMs: 3.2,
        scriptEvalMs: 12.0,
        registrationMs: 4.5,
        heapUsedBytes: 150000,
        isBaseline: true,
      },
      {
        name: 'css-fuse',
        firstRenderMs: 11.2,
        updateMs: 2.8,
        scriptEvalMs: 10.5,
        registrationMs: 3.8,
        heapUsedBytes: 120000,
        speedupPercent: 22.8,
      },
    ];

    const asciiOutput = renderAsciiRuntimeTable('Test Suite extended performance', runtimeRows);
    expect(asciiOutput).toContain('Script eval');
    expect(asciiOutput).toContain('Element registration');
    expect(asciiOutput).toContain('Retained heap');
    expect(asciiOutput).toContain('12.00 ms');
    expect(asciiOutput).toContain('4.50 ms');
    expect(asciiOutput).toContain('+22.8%');
  });

  it('renders cross-suite summary ASCII table', () => {
    const summaryRows = [
      {
        suiteName: 'Carbon Web Components',
        componentCount: 20,
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

    const output = renderCrossSuiteSummary(summaryRows);
    expect(output).toContain('Cross-library impact overview');
    expect(output).toContain('Carbon Web Components');
    expect(output).toContain('20 elements');
  });
});
