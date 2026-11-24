/** Largest request body the endpoint reads unless `maxBodyBytes` says otherwise. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Reads a request body as UTF-8 text, enforcing a byte limit while streaming.
 *
 * The declared `Content-Length` is only a hint and is absent for chunked uploads, so the limit
 * is enforced on the bytes actually received and the stream is cancelled the moment it is
 * exceeded. This keeps memory bounded even when a client lies about, or omits, the length.
 */
export async function readTextWithLimit(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) {
      throw new BodyTooLargeError(limit);
    }
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError(limit);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}
