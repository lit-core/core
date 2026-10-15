import { html, LitElement } from 'lit';

export class XToggle extends LitElement {
  static properties = {
    open: { type: Boolean },
  };

  declare open: boolean;

  constructor() {
    super();
    this.open = false;
  }

  toggle() {
    this.open = !this.open;
  }

  render() {
    return html`<button id="toggle" @click=${this.toggle}>${this.open ? 'Close' : 'Open'}</button><p id="panel" ?hidden=${!this.open}>Panel</p>`;
  }
}

customElements.define('x-toggle', XToggle);
