/**
 * Verbatim excerpt from @spectrum-web-components action-button pattern
 */
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';

export class ActionButton extends LitElement {
  @property({ type: Boolean, reflect: true })
  emphasized = false;

  @property({ type: Boolean, reflect: true, attribute: 'hold-affordance' })
  holdAffordance = false;

  @property({ type: String, reflect: true })
  role = 'button';

  @property({ type: String })
  value = '';

  render() {
    return html`<button><slot></slot></button>`;
  }
}
