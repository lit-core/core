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
