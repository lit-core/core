import { describe, expect, it } from 'vitest';
import { classify, transformNative } from '../src/index.js';
describe('Mode A vanilla compiler', () => {
  it('classifies leaf button component as Mode A vanilla', () => {
    const input = `
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('simple-button')
export class SimpleButton extends LitElement {
  static styles = css\`
    button { color: red; }
  \`;

  @property({ type: String }) text = 'Submit';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html\`<button ?disabled=\${this.disabled} @click=\${this._onClick}>\${this.text}</button>\`;
  }
}
`;
    const res = classify(input);
    expect(res).toHaveLength(1);
    expect(res[0].mode).toBe('vanilla');
    expect(res[0].componentName).toBe('SimpleButton');
    expect(res[0].tagName).toBe('simple-button');
  });
  it('compiles leaf component to pure native HTMLElement with 0 Lit imports', () => {
    const input = `
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('status-badge')
export class StatusBadge extends LitElement {
  static styles = css\`
    :host { display: inline-flex; }
    .badge { padding: 4px; }
  \`;

  @property({ type: String }) status = 'active';

  render() {
    return html\`<span class="badge">\${this.status}</span>\`;
  }
}
`;
    const res = transformNative(input);
    expect(res.vanillaCount).toBe(1);
    expect(res.microCount).toBe(0);
    // Verify zero Lit imports
    expect(res.code).not.toContain("from 'lit'");
    expect(res.code).not.toContain("from 'lit/decorators.js'");
    expect(res.code).not.toContain("from 'lit-element'");
    expect(res.code).not.toContain("from 'lit-html'");
    // Verify native custom element features
    expect(res.code).toContain('class StatusBadge extends HTMLElement');
    expect(res.code).toContain('new CSSStyleSheet()');
    expect(res.code).toContain('replaceSync(');
    expect(res.code).toContain("document.createElement('template')");
    expect(res.code).toContain('cloneNode(true)');
    expect(res.code).toContain('attachShadow');
    expect(res.code).toContain('adoptedStyleSheets');
    expect(res.code).toContain('static observedAttributes');
    expect(res.code).toContain('get status()');
    expect(res.code).toContain('set status(v)');
    expect(res.code).toContain('attributeChangedCallback');
    expect(res.code).toContain("customElements.define('status-badge', StatusBadge)");
  });
  it('correctly reflects boolean and string attributes', () => {
    const input = `
import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('nav-item')
export class NavItem extends LitElement {
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: String, reflect: true }) href = '#';

  render() {
    return html\`<a href=\${this.href}><slot></slot></a>\`;
  }
}
`;
    const res = transformNative(input);
    expect(res.vanillaCount).toBe(1);
    expect(res.code).toContain('toggleAttribute');
    expect(res.code).toContain('setAttribute');
  });
});
