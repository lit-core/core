import { describe, expect, it } from 'vitest';
import type { EndpointError } from '../../../src/endpoint/endpoint-error.js';
import { isFormRequest, MAX_FORM_BODY_BYTES, readFormPayload } from '../../../src/endpoint/form-payload.js';

function formRequest(fields: Record<string, string | string[]>): Request {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return new Request('https://example.test/_lit/action/abc', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
}

async function failureOf(promise: Promise<unknown>): Promise<EndpointError> {
  try {
    await promise;
  } catch (err) {
    return err as EndpointError;
  }
  throw new Error('expected the request to be rejected');
}

describe('isFormRequest', () => {
  it('recognizes urlencoded bodies regardless of case or parameters', () => {
    expect(isFormRequest(new Request('https://x.test', { method: 'POST', headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=utf-8' }, body: 'a=1' }))).toBe(true);
    expect(isFormRequest(new Request('https://x.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).toBe(false);
  });
});

describe('readFormPayload', () => {
  const snapshot = { _lit_tag: 'my-el', _lit_sig: 'sig', _lit_token: 'tok', _lit_state: '{"n":1}', _lit_attrs: '{"id":"x"}' };

  it('maps hidden fields to the request body and every other field to the single action argument', async () => {
    const { body, token, redirect } = await readFormPayload(formRequest({ ...snapshot, title: 'hi', tag: ['a', 'b'], _lit_redirect: '/done' }));
    expect(body).toMatchObject({ tag: 'my-el', sig: 'sig', state: { n: 1 }, attrs: { id: 'x' }, seq: 0, snapshotSeq: 0 });
    expect(body.args).toEqual([{ title: 'hi', tag: ['a', 'b'] }]);
    expect(token).toBe('tok');
    expect(redirect).toBe('/done');
  });

  it('passes an encrypted state through as an opaque string', async () => {
    const { body } = await readFormPayload(formRequest({ ...snapshot, _lit_state: 'v1.AbCdEf' }));
    expect(body.state).toBe('v1.AbCdEf');
  });

  it('rejects a post without a tag', async () => {
    const { _lit_tag, ...rest } = snapshot;
    const error = await failureOf(readFormPayload(formRequest(rest)));
    expect(error).toMatchObject({ status: 400, code: 'INVALID_PAYLOAD' });
  });

  it('names the field when a JSON field is malformed', async () => {
    const error = await failureOf(readFormPayload(formRequest({ ...snapshot, _lit_attrs: '{nope' })));
    expect(error).toMatchObject({ status: 400, code: 'INVALID_PAYLOAD' });
    expect(error.message).toContain('_lit_attrs');
  });

  it('rejects prototype pollution smuggled into a JSON field', async () => {
    const error = await failureOf(readFormPayload(formRequest({ ...snapshot, _lit_attrs: '{"__proto__":{"x":1}}' })));
    expect(error).toMatchObject({ status: 400, code: 'PROTOTYPE_POLLUTION' });
  });

  it('rejects a body over the limit before parsing it', async () => {
    const error = await failureOf(readFormPayload(formRequest({ ...snapshot, big: 'x'.repeat(MAX_FORM_BODY_BYTES + 1) })));
    expect(error).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });
});
