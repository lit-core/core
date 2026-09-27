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
assert(buttonResult.code.includes("document.createElement('template')"), 'Must create template element');
assert(buttonResult.code.includes('cloneNode(true)'), 'Must clone template element');
assert(buttonResult.code.includes('attachShadow'), 'Must attach shadow DOM');
assert(buttonResult.code.includes('static observedAttributes'), 'Must declare observedAttributes');
assert(buttonResult.code.includes('customElements.define'), 'Must define custom element');

// 3. Test Mode B classification (dynamic list component)
const listSource = `
import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

export class ItemList extends LitElement {
  @property({ type: Array }) items = [];

  render() {
    return html\`
      <ul>
        \${repeat(this.items, (i) => i.id, (i) => html\`<li>\${i.text}</li>\`)}
      </ul>
    \`;
  }
}
customElements.define('item-list', ItemList);
`;

const listClassification = classify(listSource);
console.log('List classification:', listClassification);
assert.strictEqual(listClassification.length, 1);
assert.strictEqual(listClassification[0].mode, 'micro');
assert.strictEqual(listClassification[0].componentName, 'ItemList');
assert.strictEqual(listClassification[0].tagName, 'item-list');

// 4. Test Mode B transformation
const listResult = transformNative(listSource);
console.log('Micro count:', listResult.microCount);
assert.strictEqual(listResult.microCount, 1);
assert.strictEqual(listResult.vanillaCount, 0);
assert(listResult.code.includes('NativeElement'), 'Must use NativeElement base class');
assert(listResult.code.includes('@lit-core/native/runtime'), 'Must import micro-runtime');

console.log('All @lit-core/native smoke tests passed!');
