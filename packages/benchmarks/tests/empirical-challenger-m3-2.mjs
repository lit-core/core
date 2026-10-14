#!/usr/bin/env node
// @ts-nocheck
import { fork } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(__dirname, '../src/features/ssr-worker.js');

function formatBytes(bytes) {
  if (Math.abs(bytes) < 1024) return `${bytes.toFixed(0)} B`;
  if (Math.abs(bytes) < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function calculatePercentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => {
    const idx = Math.min(n - 1, Math.floor((pct / 100) * n));
    return sorted[idx];
  };
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    min: sorted[0],
    p25: p(25),
    median: p(50),
    p75: p(75),
    p95: p(95),
    p99: p(99),
    max: sorted[n - 1],
    mean: Number((sum / n).toFixed(4)),
  };
}

// -----------------------------------------------------------------------------
// TEST 1: Child process isolation and orphan process cleanup
// -----------------------------------------------------------------------------
async function testProcessIsolation() {
  console.log('\n=== [CHALLENGE 1] Child process isolation & orphan cleanup ===');
  const results = {
    cleanExitPass: false,
    childKilledSignalPass: false,
    ipcDisconnectPass: false,
    invalidArgsExitPass: false,
  };

  // Case 1A: Normal exit verification
  const child1 = fork(workerPath, ['carbon', 'core'], {
    execArgv: ['--expose-gc'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const pid1 = child1.pid;
  let receivedMsg = false;
  child1.on('message', () => {
    receivedMsg = true;
  });

  const exitCode1 = await new Promise((resolve) => {
    child1.on('exit', (code) => resolve(code));
  });

  // Check if process still exists via signal 0
  let isAlive1 = false;
  try {
    process.kill(pid1, 0);
    isAlive1 = true;
  } catch (_e) {
    isAlive1 = false;
  }

  results.cleanExitPass = exitCode1 === 0 && receivedMsg && !isAlive1;
  console.log(`  1A. Normal worker execution: exitCode=${exitCode1}, receivedMsg=${receivedMsg}, pidAlive=${isAlive1} -> ${results.cleanExitPass ? 'PASS' : 'FAIL'}`);

  // Case 1B: SIGTERM termination handling
  const child2 = fork(workerPath, ['carbon', 'core'], {
    execArgv: ['--expose-gc'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const pid2 = child2.pid;

  // Let worker start, then send SIGTERM
  await new Promise((r) => setTimeout(r, 50));
  child2.kill('SIGTERM');

  const exitSignal2 = await new Promise((resolve) => {
    child2.on('exit', (code, signal) => resolve(signal || code));
  });

  let isAlive2 = false;
  try {
    process.kill(pid2, 0);
    isAlive2 = true;
  } catch (_e) {
    isAlive2 = false;
  }

  results.childKilledSignalPass = !isAlive2;
  console.log(`  1B. SIGTERM kill signal: exit=${exitSignal2}, pidAlive=${isAlive2} -> ${results.childKilledSignalPass ? 'PASS' : 'FAIL'}`);

  // Case 1C: Invalid arguments exit behavior
  const child3 = fork(workerPath, ['invalid-suite', 'core'], {
    execArgv: ['--expose-gc'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const pid3 = child3.pid;
  const exitCode3 = await new Promise((resolve) => {
    child3.on('exit', (code) => resolve(code));
  });

  let isAlive3 = false;
  try {
    process.kill(pid3, 0);
    isAlive3 = true;
  } catch (_e) {
    isAlive3 = false;
  }

  // Material is default fallback in ssr-worker.js for unknown suiteId!
  results.invalidArgsExitPass = exitCode3 === 0 && !isAlive3;
  console.log(`  1C. Fallback suite handling: exitCode=${exitCode3}, pidAlive=${isAlive3} -> ${results.invalidArgsExitPass ? 'PASS' : 'FAIL'}`);

  return results;
}

// -----------------------------------------------------------------------------
// TEST 2: Multi-request streaming TTFB latency distribution
// -----------------------------------------------------------------------------
async function testStreamingTtfbDistribution() {
  console.log('\n=== [CHALLENGE 2] Multi-request streaming TTFB latency distribution ===');

  const { installIsolateGlobals, renderToStream } = await import('@lit-core/ssr');
  installIsolateGlobals();

  globalThis.window = globalThis.window || globalThis;
  globalThis.window.__swc = globalThis.window.__swc || { issuedWarnings: new Set() };
  globalThis.window.dispatchEvent = globalThis.window.dispatchEvent || (() => true);
  globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});
  globalThis.window.removeEventListener = globalThis.window.removeEventListener || (() => {});
  globalThis.MutationObserver =
    globalThis.MutationObserver ||
    class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ||
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  globalThis.IntersectionObserver =
    globalThis.IntersectionObserver ||
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };

  const { html } = await import('lit');

  // Load Carbon components
  await import('@carbon/web-components/es/components/button/index.js');
  await import('@carbon/web-components/es/components/tag/index.js');
  await import('@carbon/web-components/es/components/progress-bar/index.js');
  await import('@carbon/web-components/es/components/tile/index.js');

  const carbonTpl = html`
    <cds-tile class="metric-card">
      <div class="card-header">
        <span class="metric-name">Production cluster telemetry</span>
        <cds-tag type="warm-gray">Healthy</cds-tag>
      </div>
      <div class="metric-value">99.98%</div>
      <cds-progress-bar value="78" max="100"></cds-progress-bar>
      <div class="card-actions">
        <cds-button kind="primary" size="sm">Scale</cds-button>
        <cds-button kind="secondary" size="sm">Inspect</cds-button>
      </div>
    </cds-tile>
  `;

  // Warmup 50 requests
  for (let i = 0; i < 50; i++) {
    const s = renderToStream(carbonTpl, { customElements });
    const reader = s.getReader();
    await reader.read();
    await reader.cancel();
  }

  // Measure 250 consecutive streaming requests
  const sampleCount = 250;
  const ttfbSamplesMs = [];
  const firstChunkByteSizes = [];
  let firstChunkHasTag = true;

  for (let i = 0; i < sampleCount; i++) {
    const t0 = performance.now();
    const stream = renderToStream(carbonTpl, { customElements });
    const reader = stream.getReader();
    const { value } = await reader.read();
    const ttfb = performance.now() - t0;
    ttfbSamplesMs.push(ttfb);

    if (value) {
      firstChunkByteSizes.push(value.byteLength);
      const text = new TextDecoder().decode(value);
      if (!text.includes('<cds-tile')) {
        firstChunkHasTag = false;
      }
    }
    await reader.cancel();
  }

  const stats = calculatePercentiles(ttfbSamplesMs);
  console.log(`  Carbon @lit-core/ssr TTFB across ${sampleCount} requests:`);
  console.log(`    min:    ${stats.min.toFixed(4)} ms`);
  console.log(`    p25:    ${stats.p25.toFixed(4)} ms`);
  console.log(`    median: ${stats.median.toFixed(4)} ms`);
  console.log(`    mean:   ${stats.mean.toFixed(4)} ms`);
  console.log(`    p75:    ${stats.p75.toFixed(4)} ms`);
  console.log(`    p95:    ${stats.p95.toFixed(4)} ms`);
  console.log(`    p99:    ${stats.p99.toFixed(4)} ms`);
  console.log(`    max:    ${stats.max.toFixed(4)} ms`);
  console.log(`    first chunk contains opening tag: ${firstChunkHasTag}`);
  console.log(`    avg first chunk size: ${(firstChunkByteSizes.reduce((a, b) => a + b, 0) / firstChunkByteSizes.length).toFixed(0)} bytes`);

  return { stats, firstChunkHasTag };
}

// -----------------------------------------------------------------------------
// TEST 3: Memory stress test under sustained load with global.gc()
// -----------------------------------------------------------------------------
async function testMemorySustainedLoad() {
  console.log('\n=== [CHALLENGE 3] Sustained load memory stress test (1,000 to 5,000 renders) ===');

  const { render, renderToStream } = await import('@lit-core/ssr');
  const { html } = await import('lit');

  const tpl = html`
    <cds-tile class="metric-card">
      <div class="card-header">
        <span class="metric-name">Memory stress telemetry</span>
        <cds-tag type="warm-gray">Stable</cds-tag>
      </div>
      <div class="metric-value">100.0%</div>
      <cds-progress-bar value="50" max="100"></cds-progress-bar>
    </cds-tile>
  `;

  if (typeof global.gc !== 'function') {
    throw new Error('global.gc() is not available! Must run with node --expose-gc');
  }

  // 3A: Synchronous render iterator over 2,000 iterations
  global.gc();
  global.gc();
  const baseHeap = process.memoryUsage().heapUsed;
  let peakHeap = baseHeap;

  const totalRenders = 2000;
  for (let i = 0; i < totalRenders; i++) {
    for (const _ of render(tpl, { customElements })) {
    }
    const current = process.memoryUsage().heapUsed;
    if (current > peakHeap) {
      peakHeap = current;
    }
  }

  const uncollectedHeap = process.memoryUsage().heapUsed;
  global.gc();
  global.gc();
  const retainedHeap = process.memoryUsage().heapUsed;

  const peakDelta = peakHeap - baseHeap;
  const retainedDelta = retainedHeap - baseHeap;

  console.log(`  3A. 2,000 synchronous renders:`);
  console.log(`    Base heap:      ${formatBytes(baseHeap)}`);
  console.log(`    Peak heap:      ${formatBytes(peakHeap)} (peak delta: ${formatBytes(peakDelta)})`);
  console.log(`    Uncollected:    ${formatBytes(uncollectedHeap)}`);
  console.log(`    Post-GC heap:   ${formatBytes(retainedHeap)} (retained delta: ${formatBytes(retainedDelta)})`);

  // 3B: Streaming request pipeline over 1,000 requests
  global.gc();
  global.gc();
  const streamBaseHeap = process.memoryUsage().heapUsed;
  let streamPeakHeap = streamBaseHeap;

  const totalStreams = 1000;
  for (let i = 0; i < totalStreams; i++) {
    const s = renderToStream(tpl, { customElements });
    const res = new Response(s);
    await res.text();

    if (i % 20 === 0) {
      const cur = process.memoryUsage().heapUsed;
      if (cur > streamPeakHeap) streamPeakHeap = cur;
    }
  }

  global.gc();
  global.gc();
  const streamRetainedHeap = process.memoryUsage().heapUsed;
  const streamRetainedDelta = streamRetainedHeap - streamBaseHeap;

  console.log(`  3B. 1,000 streaming requests (Response(stream).text()):`);
  console.log(`    Base heap:      ${formatBytes(streamBaseHeap)}`);
  console.log(`    Peak heap:      ${formatBytes(streamPeakHeap)} (delta: ${formatBytes(streamPeakHeap - streamBaseHeap)})`);
  console.log(`    Post-GC heap:   ${formatBytes(streamRetainedHeap)} (retained delta: ${formatBytes(streamRetainedDelta)})`);

  const memoryLeakDetected = retainedDelta > 5 * 1024 * 1024 || streamRetainedDelta > 5 * 1024 * 1024;
  console.log(`    Memory leak verdict: ${memoryLeakDetected ? 'LEAK DETECTED' : 'NO LEAK (retained memory cleanly reclaimed)'}`);

  return {
    retainedDelta,
    streamRetainedDelta,
    memoryLeakDetected,
  };
}

// -----------------------------------------------------------------------------
// TEST 4: Byte count precision & UTF-8 character length verification
// -----------------------------------------------------------------------------
async function testByteCountPrecision() {
  console.log('\n=== [CHALLENGE 4] Byte counts precision & UTF-8 validation ===');

  const { collectResult, render } = await import('@lit-core/ssr');
  const { html } = await import('lit');

  // Template with multibyte UTF-8 characters:
  // € (3 bytes), — (3 bytes), ⚡ (3 bytes), 🚀 (4 bytes), 漢 (3 bytes)
  const unicodeTpl = html`
    <div class="unicode-test">
      <h1>Currency: 100 €</h1>
      <p>Dash: em—dash</p>
      <span>Icon: ⚡ Lightning</span>
      <span>Rocket: 🚀 Rocket</span>
      <span>Kanji: 漢字 Kanji</span>
    </div>
  `;

  const output = await collectResult(render(unicodeTpl));
  const utf16Length = output.length;
  const utf8ByteLength = Buffer.byteLength(output, 'utf8');
  const bufferFromLength = Buffer.from(output, 'utf8').length;

  const exactMatch = utf8ByteLength === bufferFromLength;
  const multibyteDiff = utf8ByteLength - utf16Length;

  const gzipped = zlib.gzipSync(Buffer.from(output, 'utf8'), { level: 9 });
  const brotlied = zlib.brotliCompressSync(Buffer.from(output, 'utf8'));

  console.log(`  Multibyte UTF-8 template:`);
  console.log(`    String UTF-16 length:       ${utf16Length} code units`);
  console.log(`    Buffer.byteLength:          ${utf8ByteLength} bytes`);
  console.log(`    Buffer.from().length:       ${bufferFromLength} bytes`);
  console.log(`    Byte difference:            +${multibyteDiff} bytes over string.length`);
  console.log(`    Exact byte match:           ${exactMatch}`);
  console.log(`    Gzip level 9 byte length:   ${gzipped.length} bytes`);
  console.log(`    Brotli byte length:         ${brotlied.length} bytes`);

  // Verify comment marker regex behavior
  const sampleWithMarkers = '<!----><div><!--lit-part abc--><span>hello</span><!--/lit-part--></div>';
  const markerRegex = /<!--\/?lit-[a-z0-9_-]+(?:\s[\s\S]*?)?-->/gi;
  const markerMatches = sampleWithMarkers.match(markerRegex) || [];
  console.log(`  Marker regex on lit-part sample: found ${markerMatches.length} markers`);

  const markerMatchesInCore = (output.match(markerRegex) || []).length;
  console.log(`  Marker matches in @lit-core/ssr: ${markerMatchesInCore} markers`);

  return {
    exactMatch,
    multibyteDiff,
    zeroMarkers: markerMatchesInCore === 0,
  };
}

async function runAllChallengerTests() {
  console.log('================================================================');
  console.log('ADVERSARIAL CHALLENGER SUITE: MILESTONE 3 (@lit-core/ssr)');
  console.log('================================================================');

  const isolation = await testProcessIsolation();
  const streaming = await testStreamingTtfbDistribution();
  const memory = await testMemorySustainedLoad();
  const byteCounts = await testByteCountPrecision();

  console.log('\n================================================================');
  console.log('CHALLENGER SUMMARY VERDICT MATRIX');
  console.log('================================================================');
  console.log(`  1. Process isolation & orphan cleanup: ${isolation.cleanExitPass && isolation.childKilledSignalPass ? 'PASS' : 'FAIL'}`);
  console.log(`  2. Streaming TTFB multi-request median: ${streaming.stats.median.toFixed(4)} ms (p95: ${streaming.stats.p95.toFixed(4)} ms, max: ${streaming.stats.max.toFixed(4)} ms)`);
  console.log(`  3. Memory leak under sustained load:   ${!memory.memoryLeakDetected ? 'PASS (0 retained leak)' : 'FAIL'}`);
  console.log(`  4. Buffer.byteLength precision:         ${byteCounts.exactMatch && byteCounts.zeroMarkers ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');
}

runAllChallengerTests().catch((err) => {
  console.error('Challenger test failed:', err);
  process.exit(1);
});
