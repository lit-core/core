import { describe, expect, it } from 'vitest';
import {
  countMarkers,
  evaluateTargetA,
  evaluateTargetC,
  evaluateTargetD,
  getFullLitClientBundle,
  getLitLabsClientBundle,
  measureCompression,
  runEdgeHeadToHeadBenchmark,
  verifyEdgeDesignSystemSsr,
} from '../src/features/edge-head-to-head.js';
import { validateBenchmarkResult } from '../src/schema.js';

describe('edge-head-to-head feature benchmark', () => {
  it('measures compression metrics accurately with gzip level 9 and brotli quality 11', () => {
    const sample = 'hello world '.repeat(100);
    const result = measureCompression(sample);

    expect(result.rawBytes).toBe(1200);
    expect(result.gzipBytes).toBeLessThan(result.rawBytes);
    expect(result.brotliBytes).toBeLessThan(result.rawBytes);
  });

  it('correctly counts comment markers and processing instruction range markers', () => {
    const htmlWithMarkers = `
      <div><!--lit-part 1-->Hello<!--/lit-part--></div>
      <span><?start name="p1"?>Dynamic<?end?></span>
    `;

    const counts = countMarkers(htmlWithMarkers);
    expect(counts.commentMarkersCount).toBe(2);
    expect(counts.rangeMarkersCount).toBe(2);
    expect(counts.totalMarkersCount).toBe(4);

    const p8Counts = countMarkers('<div><?start name="p8"><?end></div>');
    expect(p8Counts.rangeMarkersCount).toBe(2);
    expect(p8Counts.totalMarkersCount).toBe(2);
  });

  it('evaluates target A with genuine AOT split, DSD rendering, and ndjson action execution', async () => {
    const targetA = await evaluateTargetA();

    expect(targetA.targetId).toBe('target-a');
    expect(targetA.clientJs.gzipBytes).toBeLessThan(5000);
    expect(targetA.initialHtml.commentMarkersCount).toBeLessThanOrEqual(4);
    expect(targetA.actionWire.rawBytes).toBeLessThan(120);
    expect(targetA.streamingTimeline.ttfbMs).toBeGreaterThan(0);
    expect(targetA.streamingTimeline.fastChunkMs).toBeGreaterThanOrEqual(targetA.streamingTimeline.ttfbMs);
    expect(targetA.streamingTimeline.slowChunkMs).toBeGreaterThan(targetA.streamingTimeline.fastChunkMs);
    expect(targetA.streamingTimeline.ttlbMs).toBeGreaterThanOrEqual(targetA.streamingTimeline.slowChunkMs);
    expect(targetA.streamingTimeline.progressiveVerified).toBe(true);
    expect(targetA.streamingTimeline.headOfLineBlocking).toBe(false);
    expect(targetA.workerCpu.cpuTimeMs).toBeLessThan(10);
    expect(targetA.workerCpu.withinLimit).toBe(true);
  });

  it('resolves authentic Lit and Lit Labs client runtime bundles from disk', () => {
    expect(getFullLitClientBundle().length).toBeGreaterThan(10000);
    expect(getLitLabsClientBundle().length).toBeGreaterThan(1000);
  });

  it('evaluates target C confirming head-of-line blocking on naive streaming', async () => {
    const targetC = await evaluateTargetC();

    expect(targetC.targetId).toBe('target-c');
    expect(targetC.clientJs.rawBytes).toBeGreaterThan(15000);
    expect(targetC.streamingTimeline.headOfLineBlocking).toBe(true);
    expect(targetC.streamingTimeline.progressiveVerified).toBe(false);
    expect(targetC.streamingTimeline.ttfbMs).toBeGreaterThan(0);
    expect(targetC.streamingTimeline.fastChunkMs).toBeGreaterThanOrEqual(targetC.streamingTimeline.ttfbMs);
  });

  it('evaluates target D with comment markers and generator SSR stream', async () => {
    const targetD = await evaluateTargetD();

    expect(targetD.targetId).toBe('target-d');
    expect(targetD.clientJs.rawBytes).toBeGreaterThan(15000);
    expect(targetD.initialHtml.commentMarkersCount).toBeGreaterThanOrEqual(0);
    expect(targetD.streamingTimeline.ttfbMs).toBeGreaterThan(0);
    expect(targetD.streamingTimeline.progressiveVerified).toBe(false);
  });

  it('verifies edge design system SSR across 4 production design systems in isolates', async () => {
    const results = await verifyEdgeDesignSystemSsr();

    expect(results).toHaveLength(4);
    for (const ds of results) {
      expect(ds.zeroCommentMarkersVerified).toBe(true);
      expect(ds.commentMarkersCount).toBe(0);
      expect(ds.cpuTimeMs).toBeGreaterThan(0);
      expect(ds.cpuTimeMs).toBeLessThan(10);
      expect(ds.renderedBytes).toBeGreaterThan(0);
    }
  });

  it('runs the full benchmark runner and produces valid schema-compliant results', async () => {
    const result = await runEdgeHeadToHeadBenchmark();

    const validation = validateBenchmarkResult(result);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    expect(result.suites).toHaveLength(3);
    expect(result.summary?.evaluatedScenario).toBe('E-commerce product page (/products/mechanical-keyboard-pro)');
    expect(result.summary?.clientJsSavingsVsBaselinePercent).toBeDefined();
    expect(result.summary?.actionWireSavingsVsBaselinePercent).toBeDefined();
  });
});
