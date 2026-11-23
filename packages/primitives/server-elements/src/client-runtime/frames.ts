import type { PatchFrame } from '../types.js';

/**
 * Yields the patch frames of an action response, whichever transport carried them.
 *
 * NDJSON responses are decoded incrementally so frames apply as they arrive. Buffered JSON
 * responses carry an array of frames. Abandoning the iteration early cancels the underlying
 * stream, so a caller that decides a response is stale stops the download too.
 */
export async function* readFrames(response: Response): AsyncGenerator<PatchFrame> {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/x-ndjson') || !response.body) {
    const data = await response.json();
    yield* (Array.isArray(data) ? data : [data]) as PatchFrame[];
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as PatchFrame;
      }
    }
    if (buffered.trim()) yield JSON.parse(buffered) as PatchFrame;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
