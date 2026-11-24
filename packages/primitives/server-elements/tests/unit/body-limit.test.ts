import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import { DEFAULT_MAX_BODY_BYTES } from '../../src/endpoint/body.js';
import { FORM_TICKET_SEQ } from '../../src/protocol.js';

const secret = 'body-limit-test-secret-at-least-32-chars!';
const token = 'limit-token';
const hash = '00000000000000b1';

class Ledger extends ServerElement {
  static properties = { rows: { state: true } };
  rows: string[] = [];
  static __lit_actions = { [hash]: { name: 'note', writes: [], validate: (a: unknown[]) => a } };
  async note() {}
  render() {
    return { strings: ['<p>', '</p>'], values: [this.rows.length] };
  }
}
const customElements = { get: (tag: string) => (tag === 'ledger-el' ? Ledger : undefined) };

/** An action request whose element holds `rows` rows of 100 bytes each. */
async function requestWithRows(rows: number) {
  const state = { rows: Array.from({ length: rows }, (_, index) => `row ${index} `.padEnd(100, 'x')) };
  const { sig } = await createSignedStateSnapshot('ledger-el', state, secret, { token });
  return new Request(`http://localhost/_lit/a/${hash}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
    body: JSON.stringify({ tag: 'ledger-el', attrs: { 'data-lit-token': token }, state, sig, args: [], seq: 1, snapshotSeq: 0 }),
  });
}

describe('the request body limit', () => {
  it('is 64 KB by default, so a list that holds enough rows is refused', async () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(64 * 1024);
    const response = await handleActionRequest(await requestWithRows(700), { env: {}, secret, customElements });
    expect(response.status).toBe(413);
  });

  it('explains that the element state is what made the request large, and what to do about it', async () => {
    const response = await handleActionRequest(await requestWithRows(700), { env: {}, secret, customElements });
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error).toContain(String(DEFAULT_MAX_BODY_BYTES));
    expect(body.error).toContain('state');
    expect(body.error).toContain('maxBodyBytes');
  });

  it('can be raised for an endpoint whose elements hold more', async () => {
    const response = await handleActionRequest(await requestWithRows(700), { env: {}, secret, customElements, maxBodyBytes: 256 * 1024 });
    expect(response.status).toBe(200);
  });

  it('can be lowered, and then applies to a form post too, without the state hint a form does not need', async () => {
    const { sig } = await createSignedStateSnapshot('ledger-el', {}, secret, { token, seq: FORM_TICKET_SEQ });
    const body = new URLSearchParams({ _lit_tag: 'ledger-el', _lit_sig: sig, _lit_token: token, _lit_attrs: JSON.stringify({ 'data-lit-token': token }), note: 'x'.repeat(2_000) });
    const response = await handleActionRequest(
      new Request(`http://localhost/_lit/a/${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }),
      { env: {}, secret, customElements, maxBodyBytes: 1_000 },
    );
    expect(response.status).toBe(413);
    const page = await response.text();
    expect(page).toContain('1000 byte limit');
    expect(page).not.toContain('maxBodyBytes');
  });
});
