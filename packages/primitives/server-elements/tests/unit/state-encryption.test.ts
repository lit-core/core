import { describe, expect, it } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { ServerElement } from '../../src/element.js';
import { renderServerElement } from '../../src/render/index.js';
import { createStateSealer, StateOpenError } from '../../src/state-sealer.js';
import type { PatchFrame } from '../../src/types.js';

const secret = 'state-encryption-test-secret-32-chars';
const hash = '00000000000000e1';

class Account extends ServerElement {
  static properties = { email: { state: true }, visits: { state: true } };
  email = 'ada@example.com';
  visits = 0;
  static __lit_actions = { [hash]: { name: 'visit', writes: ['visits'], validate: (a: unknown[]) => a } };
  async visit() {
    this.visits += 1;
  }
  render() {
    return { strings: ['<i>', '</i>'], values: [this.visits] };
  }
}
const customElements = { get: (tag: string) => (tag === 'account-el' ? Account : undefined) };

describe('state sealer', () => {
  const sealer = createStateSealer(secret, true);

  it('round trips state through an opaque string', async () => {
    const sealed = await sealer.seal('account-el', { email: 'ada@example.com', n: 3, nested: { a: [1, 2] } });
    expect(typeof sealed).toBe('string');
    expect(sealed).not.toContain('ada');
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await sealer.open('account-el', sealed)).toEqual({ email: 'ada@example.com', n: 3, nested: { a: [1, 2] } });
  });

  it('produces a different ciphertext every time for the same state', async () => {
    const [a, b] = await Promise.all([sealer.seal('t', { x: 1 }), sealer.seal('t', { x: 1 })]);
    expect(a).not.toBe(b);
  });

  it('rejects tampering, a different element, a different secret, and plain state', async () => {
    const sealed = (await sealer.seal('account-el', { x: 1 })) as string;
    const flipped = `${sealed.slice(0, -2)}${sealed.endsWith('AA') ? 'BB' : 'AA'}`;

    await expect(sealer.open('account-el', flipped)).rejects.toBeInstanceOf(StateOpenError);
    await expect(sealer.open('other-el', sealed)).rejects.toBeInstanceOf(StateOpenError);
    await expect(createStateSealer('another-secret-another-secret-123456', true).open('account-el', sealed)).rejects.toBeInstanceOf(StateOpenError);
    await expect(sealer.open('account-el', { x: 1 })).rejects.toBeInstanceOf(StateOpenError);
    await expect(sealer.open('account-el', 'not base64 !!')).rejects.toBeInstanceOf(StateOpenError);
  });

  it('refuses ciphertext when encryption is off, and a CryptoKey secret when it is on', async () => {
    await expect(createStateSealer(secret, false).open('t', 'abc')).rejects.toBeInstanceOf(StateOpenError);
    const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    expect(() => createStateSealer(key, true)).toThrow(/requires the signing secret to be a string/);
  });
});

describe('encrypted state end to end', () => {
  async function render(encryptState: boolean) {
    const rendered = await renderServerElement('account-el', {}, { secret, customElements, encryptState });
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(rendered.html)?.[1] ?? '';
    return { rendered, state: attr('data-lit-state').replace(/&quot;/g, '"') };
  }

  const post = (rendered: { token: string; sig: string }, state: string | object, extra: Record<string, unknown> = {}) =>
    new Request(`http://localhost/_lit/a/${hash}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': rendered.token, Accept: 'application/x-ndjson' },
      body: JSON.stringify({ tag: 'account-el', attrs: { 'data-lit-token': rendered.token }, state, sig: rendered.sig, args: [], seq: 1, ...extra }),
    });

  const frames = async (response: Response): Promise<PatchFrame[]> =>
    (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  it('keeps loaded data out of the rendered page', async () => {
    const readable = await render(false);
    expect(readable.rendered.html).toContain('ada@example.com');

    const encrypted = await render(true);
    expect(encrypted.rendered.html).not.toContain('ada@example.com');
    expect(encrypted.state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('runs an action from encrypted state and answers with a fresh ciphertext', async () => {
    const { rendered, state } = await render(true);
    const response = await handleActionRequest(post(rendered, state), { env: {}, secret, customElements, encryptState: true });
    const out = await frames(response);

    const snapshot = out.find((f) => 's' in f) as { s: string; sq: number };
    expect(typeof snapshot.s).toBe('string');
    expect(snapshot.s).not.toContain('ada@example.com');
    expect(snapshot.sq).toBe(1);

    const next = await createStateSealer(secret, true).open('account-el', snapshot.s);
    expect(next).toMatchObject({ email: 'ada@example.com', visits: 1 });
  });

  it('rejects readable state sent to an encrypting endpoint, and ciphertext sent to a plain one', async () => {
    const encrypted = await render(true);
    const readable = await render(false);

    const plainToEncrypting = await handleActionRequest(post(readable.rendered, { email: 'ada@example.com', visits: 0 }), { env: {}, secret, customElements, encryptState: true });
    expect(plainToEncrypting.status).toBe(403);

    const cipherToPlain = await handleActionRequest(post(encrypted.rendered, encrypted.state), { env: {}, secret, customElements });
    expect(cipherToPlain.status).toBe(403);
  });

  it('rejects ciphertext from another element or tampered ciphertext', async () => {
    const { rendered, state } = await render(true);
    const tampered = `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`;
    const response = await handleActionRequest(post(rendered, tampered), { env: {}, secret, customElements, encryptState: true });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'STATE_TAMPERED' });
  });
});
