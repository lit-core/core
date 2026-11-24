import { html } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import { handleActionRequest } from '../../src/action-endpoint.js';
import { ActionError } from '../../src/action-error.js';
import { createSignedStateSnapshot } from '../../src/crypto.js';
import { ServerElement } from '../../src/element.js';
import { resolveRedirectTarget } from '../../src/endpoint/form-response.js';
import { FORM_TICKET_SEQ } from '../../src/protocol.js';
import { renderServerElement } from '../../src/render/index.js';

const secret = 'form-submission-test-secret-32-char!';
const hashes = { add: '00000000000000c1', deny: '00000000000000c2', boom: '00000000000000c3', invalid: '00000000000000c4' };
const received: unknown[] = [];
/** The items the element held when an action started, to show where a form post's state comes from. */
const itemsSeenByAction: unknown[] = [];

class Basket extends ServerElement {
  static properties = { items: { state: true } };
  items: string[] = [];
  static __lit_actions = {
    [hashes.add]: { name: 'add', writes: ['items'], validate: (a: unknown[]) => a },
    [hashes.deny]: { name: 'deny', writes: [], validate: (a: unknown[]) => a },
    [hashes.boom]: { name: 'boom', writes: [], validate: (a: unknown[]) => a },
    [hashes.invalid]: { name: 'invalid', writes: [], validate: (a: unknown[]) => a },
  };
  async add(fields: Record<string, unknown>) {
    received.push(fields);
    itemsSeenByAction.push(this.items);
    this.items = [...this.items, String(fields.sku)];
    (this.context as any).setCookie('last_sku', String(fields.sku), { path: '/' });
  }
  async deny() {
    throw new ActionError('FORBIDDEN', 'Basket is <locked>');
  }
  async invalid() {
    throw new ActionError('UNPROCESSABLE_CONTENT', 'Fix the form.', { fields: { email: 'Already <registered>' } });
  }
  async boom() {
    throw new Error('secret internals');
  }
  render() {
    return { strings: ['<p>', '</p>'], values: [this.items.length] };
  }
}

const customElements = { get: (tag: string) => (tag === 'basket-el' ? Basket : undefined) };
const options = { env: {}, secret, customElements };

/** Builds the urlencoded body a browser sends for a form rendered with `formFields()`: a ticket, no state. */
async function formBody(extra: Record<string, string | string[]>, overrides: Record<string, string> = {}, ticketSeq = FORM_TICKET_SEQ) {
  const token = 'form-token';
  const { sig } = await createSignedStateSnapshot('basket-el', {}, secret, { token, seq: ticketSeq });
  const params = new URLSearchParams({
    _lit_tag: 'basket-el',
    _lit_sig: sig,
    _lit_token: token,
    _lit_attrs: JSON.stringify({ 'data-lit-token': token }),
    ...overrides,
  });
  for (const [key, value] of Object.entries(extra)) for (const v of [value].flat()) params.append(key, v);
  return params.toString();
}

const post = (hash: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`http://app.local/_lit/a/${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });

describe('no-JavaScript form submission', () => {
  it('runs the action with the submitted fields and redirects (post/redirect/get)', async () => {
    received.length = 0;
    const response = await handleActionRequest(post(hashes.add, await formBody({ sku: 'A-1', tag: ['x', 'y'] }, { _lit_redirect: '/cart?added=1' })), options);

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/cart?added=1');
    expect(response.headers.get('Set-Cookie')).toContain('last_sku=A-1');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ sku: 'A-1', tag: ['x', 'y'] });
    expect(Object.keys(received[0] as object)).not.toContain('_lit_sig');
  });

  it('falls back to the Referer, then the site root, and never leaves the origin', async () => {
    const withReferer = await handleActionRequest(post(hashes.add, await formBody({ sku: 'B' }), { Referer: 'http://app.local/shop?page=2' }), options);
    expect(withReferer.headers.get('Location')).toBe('/shop?page=2');

    const foreign = await handleActionRequest(post(hashes.add, await formBody({ sku: 'C' }, { _lit_redirect: 'https://evil.example/phish' }), { Referer: 'https://evil.example/' }), options);
    expect(foreign.headers.get('Location')).toBe('/');
  });

  it('resolves redirect targets conservatively', () => {
    const url = new URL('http://app.local/_lit/a/x');
    expect(resolveRedirectTarget('//evil.example/x', null, url)).toBe('/');
    expect(resolveRedirectTarget('javascript:alert(1)', null, url)).toBe('/');
    expect(resolveRedirectTarget('/a/b?c=1#frag', null, url)).toBe('/a/b?c=1');
    expect(resolveRedirectTarget(null, null, url)).toBe('/');
  });

  it('rejects a tampered ticket', async () => {
    const body = await formBody({ sku: 'D' }, { _lit_attrs: JSON.stringify({ 'data-lit-token': 'form-token', sku: 'injected' }) });
    const response = await handleActionRequest(post(hashes.add, body), options);
    expect(response.status).toBe(403);
  });

  it('ignores state a post claims to carry: the element starts from what its loaders produce', async () => {
    itemsSeenByAction.length = 0;
    const body = await formBody({ sku: 'D' }, { _lit_state: JSON.stringify({ items: ['stolen'] }) });
    const response = await handleActionRequest(post(hashes.add, body), options);
    expect(response.status).toBe(303);
    expect(itemsSeenByAction.at(-1)).toEqual([]);
  });

  it('accepts a form post when state encryption is on, since a form carries no state to open', async () => {
    const response = await handleActionRequest(post(hashes.add, await formBody({ sku: 'E' })), { ...options, encryptState: true });
    expect(response.status).toBe(303);
  });

  it('refuses a state snapshot presented as a ticket, and a ticket presented as a snapshot', async () => {
    const asTicket = await formBody({ sku: 'D' }, {}, 0);
    expect((await handleActionRequest(post(hashes.add, asTicket), options)).status).toBe(403);

    const token = 'form-token';
    const { sig: ticket } = await createSignedStateSnapshot('basket-el', {}, secret, { token, seq: FORM_TICKET_SEQ });
    const asSnapshot = await handleActionRequest(
      new Request(`http://localhost/_lit/a/${hashes.add}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lit-Action-Token': token },
        body: JSON.stringify({ tag: 'basket-el', attrs: { 'data-lit-token': token }, state: {}, sig: ticket, args: [{ sku: 'X' }], seq: 1, snapshotSeq: 0 }),
      }),
      options,
    );
    expect(asSnapshot.status).toBe(403);
  });

  it('applies the cross-site check to form posts and answers with a page, not JSON', async () => {
    const response = await handleActionRequest(post(hashes.add, await formBody({ sku: 'E' }), { Origin: 'https://evil.example' }), options);
    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('Cross-origin action requests forbidden');
  });

  it('answers a deliberate ActionError with its status and an escaped message', async () => {
    const response = await handleActionRequest(post(hashes.deny, await formBody({})), options);
    const html = await response.text();
    expect(response.status).toBe(403);
    expect(html).toContain('Basket is &lt;locked&gt;');
    expect(html).not.toContain('<locked>');
  });

  it('lists field-level messages on the error page, escaped', async () => {
    const response = await handleActionRequest(post(hashes.invalid, await formBody({})), options);
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain('<li><strong>email</strong>: Already &lt;registered&gt;</li>');
  });

  it('redacts unexpected failures and reports them', async () => {
    const onError = vi.fn();
    const response = await handleActionRequest(post(hashes.boom, await formBody({})), { ...options, onError });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret internals');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('drops prototype-polluting field names', async () => {
    received.length = 0;
    await handleActionRequest(post(hashes.add, await formBody({ sku: 'F', __proto__: 'x', constructor: 'y' } as never)), options);
    expect(Object.keys(received[0] as object).sort()).toEqual(['sku']);
  });

  it('rejects a form post without a snapshot', async () => {
    const response = await handleActionRequest(post(hashes.add, 'sku=1'), options);
    expect(response.status).toBe(400);
  });
});

describe('formFields and actionUrl', () => {
  it('render hidden inputs whose snapshot a form post can use', async () => {
    const rendered = await renderServerElement(Basket, {}, { secret, customElements });
    expect(rendered.html).not.toContain('formFields');

    class Cart extends Basket {
      render() {
        return html`<form method="post" action=${this.actionUrl('add')}>${this.formFields({ redirect: '/cart' })}<input name="sku"></form>`;
      }
    }
    const output = await renderServerElement(Cart, {}, { secret, customElements });

    expect(output.html).toContain(`action="/_lit/a/${hashes.add}"`);
    for (const name of ['_lit_tag', '_lit_sig', '_lit_token', '_lit_attrs', '_lit_redirect']) {
      expect(output.html).toContain(`name="${name}"`);
    }
    // The form carries a ticket, not the state, so it stays the same size however large the state grows.
    expect(output.html).not.toContain('name="_lit_state"');
    expect(output.html).toContain(`value="${output.token}"`);
  });

  it('actionUrl names the missing action', () => {
    expect(() => new Basket().actionUrl('nope')).toThrow(/no compiled @action\(\) named 'nope'/);
  });
});
