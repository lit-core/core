import { html, LitElement } from 'lit';
import { describe, expect, it } from 'vitest';
import { renderToString } from '../src/index.js';

class ThrowsInRender extends LitElement {
  render(): unknown {
    throw new Error('render bug');
  }
}
class Healthy extends LitElement {
  render() {
    return html`<b>healthy-body</b>`;
  }
}
class ThrowsInConnect extends LitElement {
  connectedCallback(): void {
    throw new Error('connect bug');
  }
  render() {
    return html`<b>never</b>`;
  }
}
const registry = new Map<string, CustomElementConstructor>([
  ['throws-render', ThrowsInRender as unknown as CustomElementConstructor],
  ['healthy-el', Healthy as unknown as CustomElementConstructor],
  ['throws-connect', ThrowsInConnect as unknown as CustomElementConstructor],
]);
const customElements = { get: (tag: string) => registry.get(tag) };

describe('component failures during server rendering', () => {
  it('lets a render() error propagate, so server-incompatible code fails loudly instead of shipping an empty component', () => {
    expect(() => renderToString(html`<main><throws-render></throws-render><healthy-el></healthy-el></main>`, { customElements })).toThrow('render bug');
  });

  it('contains a connectedCallback error: reported through onError, siblings still render', () => {
    const errors: string[] = [];
    const out = renderToString(html`<main><throws-connect></throws-connect><healthy-el></healthy-el></main>`, {
      customElements,
      onError: (err, info) => errors.push(`${info.phase}:${(err as Error).message}`),
    });
    expect(out).toContain('healthy-body');
    expect(errors).toContain('connectedCallback:connect bug');
  });

  it('rethrows that connectedCallback error under strictLifecycle', () => {
    expect(() => renderToString(html`<main><throws-connect></throws-connect></main>`, { customElements, strictLifecycle: true })).toThrow('connect bug');
  });
});
