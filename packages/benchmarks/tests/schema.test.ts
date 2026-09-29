import { describe, expect, it } from 'vitest';
import { createBenchmarkResult, getEnvironmentMetadata, SCHEMA_VERSION, validateBenchmarkResult } from '../src/schema.js';

describe('schema and benchmark result model', () => {
  it('captures system and dependency environment metadata', () => {
    const env = getEnvironmentMetadata();
    expect(env.node).toBe(process.version);
    expect(env.platform).toBe(process.platform);
    expect(env.versions.lit).toBe('3.3.3');
    expect(env.versions.vite).toBe('8.3.1');
  });

  it('creates valid BenchmarkRunResult compliant with schema', () => {
    const result = createBenchmarkResult({
      benchmarkId: 'test-benchmark',
      title: '`@lit-core/test` empirical benchmark results',
      description: 'Test description',
      suites: [
        {
          id: 'carbon',
          name: 'IBM Carbon Web Components',
          baseline: { latency: 10 },
          optimized: { latency: 5 },
        },
      ],
    });

    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.benchmarkId).toBe('test-benchmark');
    expect(result.suites).toHaveLength(1);
    expect(result.timestamp).toBeDefined();

    const validation = validateBenchmarkResult(result);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('detects schema validation errors for invalid data', () => {
    const invalidResult = {
      schemaVersion: '0.9.0',
      benchmarkId: '',
      suites: [{ id: 'test' }], // missing baseline/optimized
    };

    const validation = validateBenchmarkResult(invalidResult);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });
});
