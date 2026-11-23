import { describe, expect, it } from 'vitest';
import { BodyTooLargeError, readTextWithLimit } from '../../../src/endpoint/body.js';

function chunkedRequest(chunks: Uint8Array[], headers: HeadersInit = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request('http://localhost/', { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit);
}

describe('readTextWithLimit', () => {
  it('reads a body within the limit', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: '{"ok":true}' });
    expect(await readTextWithLimit(request, 1024)).toBe('{"ok":true}');
  });

  it('rejects a declared content-length above the limit without reading the body', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: 'x', headers: { 'content-length': '99999' } });
    await expect(readTextWithLimit(request, 10)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('enforces the limit on received bytes when no content-length is declared', async () => {
    const encoder = new TextEncoder();
    const request = chunkedRequest([encoder.encode('aaaaa'), encoder.encode('bbbbb'), encoder.encode('ccccc')]);
    expect(request.headers.get('content-length')).toBeNull();
    await expect(readTextWithLimit(request, 12)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('stops pulling from the stream once the limit is exceeded', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new Request('http://localhost/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(readTextWithLimit(request, 4096)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled).toBeLessThan(16);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('héllo €');
    const request = chunkedRequest([bytes.slice(0, 2), bytes.slice(2, 8), bytes.slice(8)]);
    expect(await readTextWithLimit(request, 1024)).toBe('héllo €');
  });

  it('rejects invalid UTF-8 instead of silently substituting characters', async () => {
    const request = chunkedRequest([new Uint8Array([0xff, 0xfe, 0xfd])]);
    await expect(readTextWithLimit(request, 1024)).rejects.toThrow();
  });

  it('returns an empty string for a request without a body', async () => {
    expect(await readTextWithLimit(new Request('http://localhost/'), 10)).toBe('');
  });
});
