/**
 * Verbatim excerpt from @carbon/web-components/es/components/button/button.js
 */
import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import __decorate from './decorate.js';

let CDSButton = class CDSButton extends LitElement {
  constructor(..._args) {
    super(..._args);
    this.disabled = false;
    this.kind = 'primary';
    this.size = 'lg';
  }

  render() {
    return html`<button ?disabled="${this.disabled}"><slot></slot></button>`;
  }
};

__decorate([property({ type: Boolean, reflect: true })], CDSButton.prototype, 'disabled', void 0);
__decorate([property({ type: String, reflect: true })], CDSButton.prototype, 'kind', void 0);
__decorate([property({ type: String, reflect: true })], CDSButton.prototype, 'size', void 0);

export { CDSButton };
