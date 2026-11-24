import { loader, ServerElement } from '@lit-core/server-elements';
import { html } from 'lit';
import { state } from 'lit/decorators.js';

/**
 * Reads who the request is from out of a cookie, after a random pause, so concurrent requests
 * interleave inside the worker. If any state were shared between requests, one visitor would
 * be greeted with another's name.
 */
export class DemoGreeting extends ServerElement {
  @state() visitor = '';

  @loader()
  async load() {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25)));
    this.visitor = this.context.cookies.get('visitor') ?? 'stranger';
  }

  render() {
    return html`<p class="who">Hello, ${this.visitor}</p>`;
  }
}
customElements.define('demo-greeting', DemoGreeting);
