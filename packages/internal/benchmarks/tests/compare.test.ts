import { describe, expect, it } from 'vitest';
import { compareBenchmarkResults } from '../src/compare.js';

describe('compare benchmark results utility', () => {
  const baseline = {
    benchmarkId: 'test-bench',
    suites: [
      {
        id: 'carbon',
        name: 'IBM Carbon Web Components',
        optimized: {
          latencyMs: 10.0,
          heapKb: 100.0,
        },
      },
    ],
  };

  it('passes when candidate has identical or improved metrics', () => {
    const candidate = {
      benchmarkId: 'test-bench',
      suites: [
        {
          id: 'carbon',
          name: 'IBM Carbon Web Components',
          optimized: {
            latencyMs: 8.5, // 15% faster
            heapKb: 95.0, // 5% less memory
          },
        },
      ],
    };

    const result = compareBenchmarkResults(baseline, candidate, 5);
    expect(result.passed).toBe(true);
    expect(result.regressions).toHaveLength(0);
  });

  it('detects regressions exceeding threshold percentage', () => {
    const candidate = {
      benchmarkId: 'test-bench',
      suites: [
        {
          id: 'carbon',
          name: 'IBM Carbon Web Components',
          optimized: {
            latencyMs: 12.0, // 20% slower -> exceeds 5% threshold!
            heapKb: 100.0,
          },
        },
      ],
    };

    const result = compareBenchmarkResults(baseline, candidate, 5);
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0].metric).toBe('latencyMs');
    expect(result.regressions[0].percent).toBe(20);
  });
});

describe('runtime comparison and record builders', () => {
  it('computes correct speedup and memory savings percentages', async () => {
    const { compareRuntime, buildRuntimeRecord } = await import('../src/runner.js');

    const baseline = {
      firstRenderMs: 20.0,
      updateMs: 10.0,
      scriptEvalMs: 30.0,
      registrationMs: 5.0,
      heapUsedBytes: 100000,
    };

    const target = {
      firstRenderMs: 15.0, // 25% faster
      updateMs: 8.0, // 20% faster
      scriptEvalMs: 15.0, // 50% faster
      registrationMs: 4.0,
      heapUsedBytes: 80000, // 20% savings
    };

    const comparison = compareRuntime(baseline, target);
    expect(comparison.speedupPercent).toBeCloseTo(25.0, 1);
    expect(comparison.updateSpeedupPercent).toBeCloseTo(20.0, 1);
    expect(comparison.evalSpeedupPercent).toBeCloseTo(50.0, 1);
    expect(comparison.memorySavingsPercent).toBeCloseTo(20.0, 1);

    const record = buildRuntimeRecord(target, comparison);
    expect(record.firstRenderMs).toBe(15.0);
    expect(record.updateMs).toBe(8.0);
    expect(record.scriptEvalMs).toBe(15.0);
    expect(record.registrationMs).toBe(4.0);
    expect(record.heapUsedBytes).toBe(80000);
    expect(record.speedupPercent).toBeCloseTo(25.0, 1);
    expect(record.updateSpeedupPercent).toBeCloseTo(20.0, 1);
    expect(record.evalSpeedupPercent).toBeCloseTo(50.0, 1);
    expect(record.memorySavingsPercent).toBeCloseTo(20.0, 1);
  });

  it('safely defaults to zero when metrics are unmeasured', async () => {
    const { compareRuntime, buildRuntimeRecord } = await import('../src/runner.js');

    const baseline = {
      firstRenderMs: 0,
      updateMs: 0,
      scriptEvalMs: 0,
      registrationMs: 0,
      heapUsedBytes: 0,
    };

    const target = {
      firstRenderMs: 10.0,
      updateMs: 5.0,
      scriptEvalMs: 15.0,
      registrationMs: 2.0,
      heapUsedBytes: 50000,
    };

    const comparison = compareRuntime(baseline, target);
    expect(comparison.speedupPercent).toBe(0);
    expect(comparison.updateSpeedupPercent).toBe(0);
    expect(comparison.evalSpeedupPercent).toBe(0);
    expect(comparison.memorySavingsPercent).toBe(0);

    const record = buildRuntimeRecord(null, comparison);
    expect(record.firstRenderMs).toBe(0);
    expect(record.updateMs).toBe(0);
    expect(record.scriptEvalMs).toBe(0);
    expect(record.registrationMs).toBe(0);
    expect(record.heapUsedBytes).toBe(0);
  });

  it('handles regressions with negative percentage deltas', async () => {
    const { compareRuntime } = await import('../src/runner.js');

    const baseline = {
      firstRenderMs: 10.0,
      updateMs: 10.0,
      scriptEvalMs: 10.0,
      heapUsedBytes: 50000,
    };

    const target = {
      firstRenderMs: 15.0, // 50% slower
      updateMs: 12.0, // 20% slower
      scriptEvalMs: 20.0, // 100% slower
      heapUsedBytes: 60000, // 20% larger
    };

    const comparison = compareRuntime(baseline, target);
    expect(comparison.speedupPercent).toBeCloseTo(-50.0, 1);
    expect(comparison.updateSpeedupPercent).toBeCloseTo(-20.0, 1);
    expect(comparison.evalSpeedupPercent).toBeCloseTo(-100.0, 1);
    expect(comparison.memorySavingsPercent).toBeCloseTo(-20.0, 1);
  });
});
