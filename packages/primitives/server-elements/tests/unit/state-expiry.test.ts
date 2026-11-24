import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import { isReloadRequired, ServerActionError } from '../../src/errors.js';
import { FORM_TICKET_SEQ } from '../../src/protocol.js';

const secret = 'state-expiry-test-secret-32-characters!';
const token = 'expiry-token';
const hash = '00000000000000f1';

class Note extends ServerElement {
  static properties = { text: { state: true } };
  text = '';
  static __lit_actions = { [hash]: { name: 'save', writes: ['text'], validate: (a: unknown[]) => a } };
  async save() {
    this.text = 'saved';
  }
  render() {
    return { strings: ['<p>', '</p>'], values: [this.text] };
  }
}

const customElements = { get: (tag: string) => (tag === 'note-el' ? Note : undefined) };
const options = { env: {}, secret, customElements };

async function snapshot(ttlMs: number, seq = 0) {
  const state = { text: '' };
  const { sig } = await createSignedStateSnapshot('note-el', state, secret, { token, ttlMs, seq });
  return { state, sig };
}

const json = ({ state, sig }: { state: object; sig: string }) =>
  new Request(`http://localhost/_lit/a/${hash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
    body: JSON.stringify({ tag: 'note-el', attrs: { 'data-lit-token': token }, state, sig, args: [], seq: 1, snapshotSeq: 0 }),
  });

describe('a page that has outlived its signed state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told it expired, with a code that is not the tamper code, so the page can offer a reload', async () => {
    const fresh = await snapshot(60_000);
    vi.setSystemTime(1_700_000_000_000 + 61_000);

    const response = await handleActionRequest(json(fresh), options);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STATE_EXPIRED', error: expect.stringContaining('Reload') });
  });

  it('still runs the action while the snapshot is within its lifetime', async () => {
    const fresh = await snapshot(60_000);
    vi.setSystemTime(1_700_000_000_000 + 59_000);
    expect((await handleActionRequest(json(fresh), options)).status).toBe(200);
  });

  it('keeps a forged signature with a future expiry as tampering, not as expiry', async () => {
    const fresh = await snapshot(60_000);
    const forged = { ...fresh, sig: `${Date.now() + 60_000}.${'0'.repeat(64)}` };
    const response = await handleActionRequest(json(forged), options);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'STATE_TAMPERED' });
  });

  it('answers a form post from an expired page with a page that says so', async () => {
    const { sig } = await createSignedStateSnapshot('note-el', {}, secret, { token, ttlMs: 60_000, seq: FORM_TICKET_SEQ });
    vi.setSystemTime(1_700_000_000_000 + 61_000);
    const body = new URLSearchParams({ _lit_tag: 'note-el', _lit_sig: sig, _lit_token: token, _lit_attrs: JSON.stringify({ 'data-lit-token': token }) });
    const response = await handleActionRequest(
      new Request(`http://localhost/_lit/a/${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }),
      options,
    );
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('expired');
  });
});

describe('isReloadRequired', () => {
  it('is true for the three codes that mean the page is out of date', () => {
    for (const code of ['ACTION_STALE', 'STATE_REPLAYED', 'STATE_EXPIRED']) {
      expect(isReloadRequired(new ServerActionError('x', code, 409))).toBe(true);
    }
  });

  it('is false for failures a reload would not fix, and for things that are not errors', () => {
    for (const value of [new ServerActionError('x', 'VALIDATION_ERROR', 400), new ServerActionError('x', 'STATE_TAMPERED', 403), new Error('plain'), null, undefined, 'STATE_EXPIRED', { code: 42 }]) {
      expect(isReloadRequired(value)).toBe(false);
    }
  });
});
