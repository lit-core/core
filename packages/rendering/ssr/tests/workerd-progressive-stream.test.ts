/**
 * Progressive out-of-order Declarative Shadow DOM streaming verification.
 *
 * Environment Note:
 * Standard sandbox environments restrict local TCP loopback socket connections
 * (connect EPERM 127.0.0.1). Because Miniflare/workerd requires binding to an
 * ephemeral loopback port for IPC/HTTP dispatch, this in-sandbox test suite
 * executes against CloudflareHtmlRewriterSimulator with relative timing and
 * stream sequence assertions.
 */
import { describe, expect, it } from 'vitest';
import { transformWithHtmlRewriter } from '../src/html-rewriter.js';
import { CloudflareHtmlRewriterSimulator } from './helpers/cloudflare-html-rewriter-simulator.js';

describe('progressive out-of-order DSD streaming', () => {
  it('streams fast 10ms boundary chunk to HTTP response reader before slow 250ms boundary settles', async () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Edge Stream Test</title></head>
<body>
  <h1>Page Shell</h1>
  <async-island id="slow" delay="250"></async-island>
  <async-island id="fast" delay="10"></async-island>
</body>
</html>`;

    const startTime = performance.now();
    const response = transformWithHtmlRewriter(
      html,
      {
        tagManifest: ['async-island'],
        islands: {
          'async-island': {
            pending: (attrs) => `<div class="pending">Loading ${attrs.id}...</div>`,
            render: async (attrs) => {
              const delay = Number(attrs.delay);
              await new Promise((r) => setTimeout(r, delay));
              return `<div class="resolved" id="res-${attrs.id}">Resolved ${attrs.id}</div>`;
            },
          },
        },
      },
      () => new CloudflareHtmlRewriterSimulator(),
    );

    expect(response.status).toBe(200);
    const body = response.body;
    if (!body) throw new Error('Response body is missing');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: Array<{ elapsedMs: number; text: string }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      events.push({
        elapsedMs: performance.now() - startTime,
        text,
      });
    }

    // Invariant 1: Stream yielded at least 3 distinct chunk intervals (shell, fast boundary, slow boundary, termination)
    expect(events.length).toBeGreaterThanOrEqual(3);

    const fastEventIndex = events.findIndex((e) => e.text.includes('Resolved fast'));
    const slowEventIndex = events.findIndex((e) => e.text.includes('Resolved slow'));

    expect(fastEventIndex).toBeGreaterThan(0);
    expect(slowEventIndex).toBeGreaterThan(fastEventIndex);

    // Invariant 2: Initial shell chunks arrived strictly before any async boundary resolved
    const initialShellChunks = events
      .slice(0, fastEventIndex)
      .map((e) => e.text)
      .join('');
    expect(initialShellChunks).toContain('Page Shell');
    expect(initialShellChunks).toContain('Loading slow...');
    expect(initialShellChunks).toContain('Loading fast...');

    // Invariant 3: Fast boundary chunk arrival preceded slow boundary chunk arrival both in stream position and relative elapsed time
    expect(events[fastEventIndex].elapsedMs).toBeLessThan(events[slowEventIndex].elapsedMs);

    // Invariant 4: Relative elapsed time reflects the asynchronous delay differential
    expect(events[slowEventIndex].elapsedMs - events[fastEventIndex].elapsedMs).toBeGreaterThanOrEqual(100);

    // Invariant 5: Closing tags deferred until final chunk(s) after slow boundary settled
    const trailingChunks = events
      .slice(slowEventIndex)
      .map((e) => e.text)
      .join('');
    expect(trailingChunks).toContain('</body>');
    expect(trailingChunks).toContain('</html>');
  });
});
