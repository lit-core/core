import { describe, expect, it } from 'vitest';
import type { EndpointError } from '../../../src/endpoint/endpoint-error.js';
import { parseActionHash } from '../../../src/endpoint/validate-request.js';

const hash = '0123456789abcdef';
const parse = (path: string, prefix: string) => parseActionHash(new URL(`https://example.test${path}`), prefix);
const failure = (path: string, prefix: string): EndpointError => {
  try {
    parse(path, prefix);
  } catch (err) {
    return err as EndpointError;
  }
  throw new Error('expected a rejection');
};

describe('parseActionHash', () => {
  it('reads the hash after the prefix', () => {
    expect(parse(`/_lit/a/${hash}`, '/_lit/a/')).toBe(hash);
  });

  it('tolerates a trailing slash on the request path', () => {
    expect(parse(`/_lit/a/${hash}/`, '/_lit/a/')).toBe(hash);
  });

  it('accepts a prefix configured without its trailing slash, the way the client and actionUrl() address it', () => {
    expect(parse(`/api/actions/${hash}`, '/api/actions')).toBe(hash);
  });

  it('does not treat a longer sibling path as the prefix', () => {
    expect(failure(`/api/actionsX/${hash}`, '/api/actions')).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('answers 404 for a path outside the prefix', () => {
    expect(failure(`/other/${hash}`, '/_lit/a/')).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('rejects hashes of the wrong shape', () => {
    expect(failure('/_lit/a/short', '/_lit/a/')).toMatchObject({ status: 400, code: 'INVALID_HASH' });
    expect(failure(`/_lit/a/${hash}x`, '/_lit/a/')).toMatchObject({ status: 400, code: 'INVALID_HASH' });
    // The URL parser resolves dot segments first, so a traversal attempt lands outside the prefix.
    expect(failure('/_lit/a/../../etc/passwd', '/_lit/a/')).toMatchObject({ status: 404 });
    expect(failure('/_lit/a/%2e%2e%2f%2e%2e%2fetc', '/_lit/a/')).toMatchObject({ status: 400 });
  });
});
