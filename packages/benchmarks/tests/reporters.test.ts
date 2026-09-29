import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBenchmarkResult, loadStandaloneResult, saveBenchmarkResult, saveStandaloneResult, updateManifest } from '../src/reporters/index.js';
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

  it('saves and loads standalone per-suite per-feature JSON results', () => {
    const tempDir = path.resolve(__dirname, '../.temp-standalone-results');
    const mockResult = {
      schemaVersion: '2.0.0',
      id: 'carbon-css-fuse',
      suite: { id: 'carbon', name: 'Carbon Web Components', componentCount: 20 },
      feature: { id: 'css-fuse', name: 'CSS AST deduplication', isBaseline: false },
      timestamp: new Date().toISOString(),
      metrics: { rawBytes: 50000, gzipBytes: 15000, brotliBytes: 12000, buildTimeMs: 120 },
      deltas: { rawBytes: -5000, rawPercent: -10, gzipBytes: -1500, gzipPercent: -10 },
      runtime: { firstRenderMs: 12.5, updateMs: 1.2, speedupPercent: 15.0 },
    };

    const savedPath = saveStandaloneResult({
      suiteId: 'carbon',
      featureId: 'css-fuse',
      result: mockResult,
      outDir: tempDir,
    });

    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toBe(path.join(tempDir, 'carbon/css-fuse.json'));

    const loaded = loadStandaloneResult('carbon', 'css-fuse', tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded.id).toBe('carbon-css-fuse');
    expect(loaded.metrics.rawBytes).toBe(50000);
    expect(loaded.deltas.rawPercent).toBe(-10);

    // Verify manifest was created and contains this run
    const manifestPath = path.join(tempDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.libraries.length).toBeGreaterThan(0);
    expect(manifest.features.length).toBeGreaterThan(0);
    expect(manifest.runs.some((r: any) => r.suiteId === 'carbon' && r.featureId === 'css-fuse')).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
