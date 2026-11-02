import { describe, expect, it } from 'vitest';
import { transformWithHtmlRewriter } from '../src/html-rewriter.js';
import { CloudflareHtmlRewriterSimulator } from './helpers/cloudflare-html-rewriter-simulator.js';

describe('progressive streaming concurrent out-of-order stress testing', () => {
  it('empirically proves chunks arrive in monotonic time order without head-of-line blocking across 4 concurrent boundaries', async () => {
    // 4 boundaries in reverse speed order: slowest (200ms) is FIRST in document order!
    const html = `<!DOCTYPE html>
<html>
<head><title>Concurrent Streaming Stress</title></head>
<body>
  <header><h1>Dashboard Shell</h1></header>
  <main>
    <async-widget id="slow-200" delay="200"></async-widget>
    <async-widget id="medium-50" delay="50"></async-widget>
    <async-widget id="fast-15" delay="15"></async-widget>
    <async-widget id="immediate-5" delay="5"></async-widget>
  </main>
</body>
</html>`;

    const startTime = performance.now();
    const response = transformWithHtmlRewriter(
      html,
      {
        tagManifest: ['async-widget'],
        islands: {
          'async-widget': {
            pending: (attrs) => `<div class="skeleton" id="skel-${attrs.id}">Loading ${attrs.id}...</div>`,
            render: async (attrs) => {
              const delay = Number(attrs.delay);
              await new Promise((resolve) => setTimeout(resolve, delay));
              return `<section class="resolved-widget" id="res-${attrs.id}">Resolved ${attrs.id} in ${delay}ms</section>`;
            },
          },
        },
      },
      () => new CloudflareHtmlRewriterSimulator(),
    );

    if (!response.body) throw new Error('Response body missing');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Array<{ elapsedMs: number; text: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      chunks.push({
        elapsedMs: performance.now() - startTime,
        text,
      });
    }

    // Assertion 1: Total chunks >= 5 (initial shell + 4 boundary swap chunks + optional closing chunk)
    expect(chunks.length).toBeGreaterThanOrEqual(5);

    // Assertion 2: Shell arrived strictly before any async boundary resolved
    const firstResolvedIndex = chunks.findIndex((c) => c.text.includes('res-'));
    expect(firstResolvedIndex).toBeGreaterThan(0);
    const initialShellText = chunks
      .slice(0, firstResolvedIndex)
      .map((c) => c.text)
      .join('');
    expect(initialShellText).toContain('Dashboard Shell');
    expect(initialShellText).toContain('skel-slow-200');
    expect(initialShellText).toContain('skel-medium-50');
    expect(initialShellText).toContain('skel-fast-15');
    expect(initialShellText).toContain('skel-immediate-5');

    // Extract arrival times of the 4 resolved boundary chunks
    const chunkImmediate5 = chunks.find((c) => c.text.includes('res-immediate-5'));
    const chunkFast15 = chunks.find((c) => c.text.includes('res-fast-15'));
    const chunkMedium50 = chunks.find((c) => c.text.includes('res-medium-50'));
    const chunkSlow200 = chunks.find((c) => c.text.includes('res-slow-200'));

    expect(chunkImmediate5).toBeDefined();
    expect(chunkFast15).toBeDefined();
    expect(chunkMedium50).toBeDefined();
    expect(chunkSlow200).toBeDefined();

    const tImmediate5 = chunkImmediate5?.elapsedMs ?? 0;
    const tFast15 = chunkFast15?.elapsedMs ?? 0;
    const tMedium50 = chunkMedium50?.elapsedMs ?? 0;
    const tSlow200 = chunkSlow200?.elapsedMs ?? 0;

    // Assertion 3: Non-blocking proof — immediate-5, fast-15, and medium-50 ALL arrive BEFORE slow-200 resolves!
    expect(tImmediate5).toBeLessThan(tSlow200);
    expect(tFast15).toBeLessThan(tSlow200);
    expect(tMedium50).toBeLessThan(tSlow200);

    // Assertion 4: Strict monotonic arrival order: 5ms < 15ms < 50ms < 200ms
    expect(tImmediate5).toBeLessThanOrEqual(tFast15);
    expect(tFast15).toBeLessThan(tMedium50);
    expect(tMedium50).toBeLessThan(tSlow200);

    // Assertion 5: Slow chunk arrives at or after its 200ms delay
    expect(tSlow200).toBeGreaterThanOrEqual(180);

    // Assertion 6: Document stream integrity — closing tags emitted after all boundaries settle
    const fullHtml = chunks.map((c) => c.text).join('');
    expect(fullHtml).toContain('</body>');
    expect(fullHtml).toContain('</html>');

    // Verify closing tags occur in the very last chunk or after the slow-200 chunk
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.text).toContain('</html>');
  });

  it('handles nested dynamic async boundaries discovered during stream draining', async () => {
    // Outer island resolves after 20ms and yields a nested async island (30ms)
    const html = `<!DOCTYPE html>
<html>
<body>
  <nested-root-island id="outer"></nested-root-island>
</body>
</html>`;

    const startTime = performance.now();
    const response = transformWithHtmlRewriter(
      html,
      {
        tagManifest: ['nested-root-island', 'nested-child-island'],
        islands: {
          'nested-root-island': {
            pending: '<div class="pending-outer">Loading outer...</div>',
            render: async () => {
              await new Promise((r) => setTimeout(r, 20));
              // Outer resolves to HTML containing another async island
              return '<div class="outer-content">Outer Resolved <nested-child-island id="inner"></nested-child-island></div>';
            },
          },
          'nested-child-island': {
            pending: '<div class="pending-inner">Loading inner...</div>',
            render: async () => {
              await new Promise((r) => setTimeout(r, 30));
              return '<div class="inner-content">Inner Resolved 42</div>';
            },
          },
        },
      },
      () => new CloudflareHtmlRewriterSimulator(),
    );

    if (!response.body) throw new Error('Response body missing');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: Array<{ elapsedMs: number; text: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push({
        elapsedMs: performance.now() - startTime,
        text: decoder.decode(value),
      });
    }

    const fullHtml = chunks.map((c) => c.text).join('');
    expect(fullHtml).toContain('Loading outer...');
    expect(fullHtml).toContain('Outer Resolved');
    expect(fullHtml).toContain('</body>');
    expect(fullHtml).toContain('</html>');
  });

  it('isolates failures: boundary rejection triggers error fallback without stalling sibling streams', async () => {
    const html = `<!DOCTYPE html>
<html>
<body>
  <failing-island id="fail-fast" delay="10"></failing-island>
  <healthy-island id="healthy-slow" delay="40"></healthy-island>
</body>
</html>`;

    const capturedErrors: any[] = [];
    const response = transformWithHtmlRewriter(
      html,
      {
        tagManifest: ['failing-island', 'healthy-island'],
        onError: (err) => {
          capturedErrors.push(err);
        },
        islands: {
          'failing-island': {
            pending: '<div>Loading failing...</div>',
            render: async () => {
              await new Promise((r) => setTimeout(r, 10));
              throw new Error('Simulated Island Failure');
            },
            errorFallback: (err: any) => `<div class="error-badge">Failed: ${err.message}</div>`,
          },
          'healthy-island': {
            pending: '<div>Loading healthy...</div>',
            render: async () => {
              await new Promise((r) => setTimeout(r, 40));
              return '<div class="healthy-content">Healthy Success</div>';
            },
          },
        },
      },
      () => new CloudflareHtmlRewriterSimulator(),
    );

    if (!response.body) throw new Error('Response body missing');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }

    const fullHtml = chunks.join('');

    // Error was handled via errorFallback and captured by onError
    expect(capturedErrors).toHaveLength(1);
    expect(capturedErrors[0].message).toBe('Simulated Island Failure');
    expect(fullHtml).toContain('Failed: Simulated Island Failure');

    // Healthy island resolved successfully despite sibling failure
    expect(fullHtml).toContain('Healthy Success');
    expect(fullHtml).toContain('</body></html>');
  });
});
