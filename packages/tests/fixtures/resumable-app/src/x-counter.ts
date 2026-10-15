import { html, LitElement } from 'lit';

export class XCounter extends LitElement {
  static properties = {
    count: { type: Number },
  };

  declare count: number;

  constructor() {
    super();
    this.count = 0;
  }

  increment() {
    this.count++;
  }

  renderValue() {
    return html`<span id="value">${this.count}</span>`;
  }

  render() {
    return html`<div class="wrap">${this.renderValue()}<button id="inc" @click=${this.increment}>Increment</button></div>`;
  }
}

customElements.define('x-counter', XCounter);
