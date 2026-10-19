/**
 * Standard Lit component with property and state decorators
 */
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('my-counter')
export class MyCounter extends LitElement {
  static styles = css`:host { display: block; }`;

  @property({ type: String })
  heading = 'Counter';

  @property({ type: Number, reflect: true })
  count = 0;

  @state()
  _internalState = false;

  render() {
    return html`
      <h2>${this.heading}</h2>
      <p>Count: ${this.count}</p>
    `;
  }
}
