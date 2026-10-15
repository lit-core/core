import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('x-greeter')
export class XGreeter extends LitElement {
  @property({ type: String }) greeting = 'Hello';
  @state() name = 'world';

  onInput(event: Event) {
    this.name = (event.target as HTMLInputElement).value;
  }

  render() {
    return html`<label>Name <input id="name" .value=${this.name} @input=${this.onInput} /></label><p id="out">${this.greeting}, ${this.name}</p>`;
  }
}
