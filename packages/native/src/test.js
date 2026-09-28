import assert from 'node:assert';
import { classify, transformNative } from './index.js';

console.log('Testing @lit-core/native...');

// 1. Test Mode A classification (leaf component)
const buttonSource = `
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('my-button')
export class MyButton extends LitElement {
  static styles = css\`
    :host { display: inline-block; }
    button { padding: 8px 16px; border-radius: 4px; }
  \`;

  @property({ type: String }) label = 'Click';
  @property({ type: Boolean, reflect: true }) disabled = false;

  render() {
    return html\`<button ?disabled=\${this.disabled} @click=\${this._onClick}>\${this.label}</button>\`;
  }
}
`;

const buttonClassification = classify(buttonSource);
console.log('Button classification:', buttonClassification);
assert.strictEqual(buttonClassification.length, 1);
assert.strictEqual(buttonClassification[0].mode, 'vanilla');
assert.strictEqual(buttonClassification[0].componentName, 'MyButton');
assert.strictEqual(buttonClassification[0].tagName, 'my-button');

// 2. Test Mode A transformation
const buttonResult = transformNative(buttonSource);
console.log('Vanilla count:', buttonResult.vanillaCount);
assert.strictEqual(buttonResult.vanillaCount, 1);
assert.strictEqual(buttonResult.microCount, 0);
assert(!buttonResult.code.includes("from 'lit'"), 'Must remove lit import');
assert(!buttonResult.code.includes("from 'lit/decorators.js'"), 'Must remove lit/decorators import');
assert(buttonResult.code.includes('extends HTMLElement'), 'Must extend HTMLElement');
assert(buttonResult.code.includes('CSSStyleSheet'), 'Must create constructable stylesheet');
assert(buttonResult.code.includes('adoptedStyleSheets'), 'Must adopt constructable stylesheet');
assert(buttonResult.code.includes('createElement("template")') || buttonResult.code.includes("createElement('template')"), 'Must create template element');
assert(buttonResult.code.includes('cloneNode(true)'), 'Must clone template element');
assert(buttonResult.code.includes('attachShadow'), 'Must attach shadow DOM');
assert(buttonResult.code.includes('static observedAttributes'), 'Must declare observedAttributes');
assert(buttonResult.code.includes('customElements.define'), 'Must define custom element');

// 3. Test Mode B classification (directive-using component)
const alertSource = `
import { LitElement, html } from 'lit';
import { classMap } from 'lit/directives/class-map.js';

export class BannerAlert extends LitElement {
  render() {
    return html\`
      <div class="\${classMap({ active: this.active, urgent: this.urgent })}">
        <slot></slot>
      </div>
    \`;
  }
}
customElements.define('banner-alert', BannerAlert);
`;

const alertClassification = classify(alertSource);
console.log('Alert classification:', alertClassification);
assert.strictEqual(alertClassification.length, 1);
assert.strictEqual(alertClassification[0].mode, 'micro');
assert.strictEqual(alertClassification[0].componentName, 'BannerAlert');
assert.strictEqual(alertClassification[0].tagName, 'banner-alert');

// 4. Test Mode B transformation
const alertResult = transformNative(alertSource);
console.log('Micro count:', alertResult.microCount);
assert.strictEqual(alertResult.microCount, 1);
assert.strictEqual(alertResult.vanillaCount, 0);
assert(!alertResult.code.includes('lit/directives/class-map.js'), 'Must eliminate directive import');
assert(alertResult.code.includes('.filter(Boolean).join(" ")'), 'Must lower classMap expression');

console.log('All @lit-core/native smoke tests passed!');
