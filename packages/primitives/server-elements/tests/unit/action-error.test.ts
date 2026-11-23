import { describe, expect, it, vi } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { ACTION_ERROR_STATUS, ActionError, isActionError } from '../../src/action-error.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';

const secret = 'action-error-test-secret-32-chars!!';
const token = 'token-errors';
const hashes = { denied: '00000000000000b1', bug: '00000000000000b2', ok: '00000000000000b3', invalid: '00000000000000b4' };

class Guarded extends ServerElement {
  static properties = { count: { state: true } };
  count = 0;
  static __lit_actions = {
    [hashes.denied]: { name: 'denied', writes: [], validate: (a: unknown[]) => a },
    [hashes.bug]: { name: 'bug', writes: [], validate: (a: unknown[]) => a },
    [hashes.ok]: { name: 'ok', writes: [], validate: (a: unknown[]) => a },
    [hashes.invalid]: { name: 'invalid', writes: [], validate: (a: unknown[]) => a },
  };
  async denied() {
    throw new ActionError('FORBIDDEN', 'You cannot edit this list.');
  }
  async bug() {
    throw new Error('connection string postgres://user:hunter2@db');
  }
  async ok() {
    return 1;
  }
  async invalid() {
    throw new ActionError('UNPROCESSABLE_CONTENT', 'Fix the highlighted fields.', { fields: { email: 'Already registered', name: '<required>' } });
  }
  render() {
    return { strings: ['<i>', '</i>'], values: [this.count] };
  }
}

const customElements = { get: (tag: string) => (tag === 'guarded-el' ? Guarded : undefined) };

async function call(hash: string, accept: string, onError = vi.fn(), devMode = false) {
  const state = { count: 0 };
  const { sig } = await createSignedStateSnapshot('guarded-el', state, secret, { token });
  const request = new Request(`http://localhost/_lit/a/${hash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token, Accept: accept },
    body: JSON.stringify({ tag: 'guarded-el', attrs: { 'data-lit-token': token }, state, sig, args: [], seq: 1 }),
  });
  const response = await handleActionRequest(request, { env: {}, secret, customElements, onError, devMode });
  return { response, text: await response.text(), onError };
}

const frames = (text: string) =>
  text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

/** The error frames of a failed stream. A failed action also re-signs the state the browser already holds, which comes first. */
const errorFrames = (text: string) => {
  const all = frames(text);
  expect(all[0]).toHaveProperty('sig');
  return all.filter((frame) => 'e' in frame);
};

describe('ActionError', () => {
  it('carries a code, the matching status, and a default message', () => {
    const error = new ActionError('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('NOT_FOUND');
    expect(isActionError(error)).toBe(true);
    expect(isActionError(new Error('x'))).toBe(false);
    expect(isActionError({ code: 'FORBIDDEN' })).toBe(false);
  });

  it('maps every code to a 4xx status', () => {
    for (const status of Object.values(ACTION_ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  it('streams a deliberate error with its own message and code, even outside devMode', async () => {
    const { text, onError } = await call(hashes.denied, 'application/x-ndjson');
    expect(errorFrames(text)).toEqual([{ e: 'You cannot edit this list.', code: 'FORBIDDEN' }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('answers the JSON transport with the mapped HTTP status', async () => {
    const { response, text } = await call(hashes.denied, 'application/json');
    expect(response.status).toBe(403);
    expect(JSON.parse(text)).toEqual({ error: 'You cannot edit this list.', code: 'FORBIDDEN' });
  });

  it('still redacts unexpected errors and reports them', async () => {
    const stream = await call(hashes.bug, 'application/x-ndjson');
    expect(errorFrames(stream.text)).toEqual([{ e: 'Internal server error', code: 'INTERNAL_ERROR' }]);
    expect(stream.text).not.toContain('hunter2');
    expect(stream.onError).toHaveBeenCalledTimes(1);

    const json = await call(hashes.bug, 'application/json');
    expect(json.response.status).toBe(500);
    expect(json.text).not.toContain('hunter2');
  });

  it('is recognized across module copies through the shared brand', () => {
    const foreign = new Error('copy');
    (foreign as unknown as Record<symbol, unknown>)[Symbol.for('@lit-core/server-elements/action-error')] = true;
    expect(isActionError(foreign)).toBe(true);
  });

  describe('field-level messages', () => {
    const fields = { email: 'Already registered', name: '<required>' };

    it('are frozen copies, so later mutation of the source cannot change the error', () => {
      const source = { email: 'taken' };
      const error = new ActionError('UNPROCESSABLE_CONTENT', 'x', { fields: source });
      source.email = 'changed';
      expect(error.fields).toEqual({ email: 'taken' });
      expect(Object.isFrozen(error.fields)).toBe(true);
    });

    it('travel on the streamed error frame', async () => {
      const { text } = await call(hashes.invalid, 'application/x-ndjson');
      expect(errorFrames(text)).toEqual([{ e: 'Fix the highlighted fields.', code: 'UNPROCESSABLE_CONTENT', fields }]);
    });

    it('travel in the JSON error body with a 422', async () => {
      const { response, text } = await call(hashes.invalid, 'application/json');
      expect(response.status).toBe(422);
      expect(JSON.parse(text)).toEqual({ error: 'Fix the highlighted fields.', code: 'UNPROCESSABLE_CONTENT', fields });
    });

    it('are omitted when an error has none', async () => {
      const { text } = await call(hashes.denied, 'application/x-ndjson');
      expect(errorFrames(text)[0]).not.toHaveProperty('fields');
    });
  });
});
