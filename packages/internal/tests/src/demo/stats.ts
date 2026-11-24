import { loader, ServerElement } from '@lit-core/server-elements';
import { html } from 'lit';
import { state } from 'lit/decorators.js';
import type { DemoEnv } from './todo-list.js';
import type { Todo } from './todo-store.js';

/** How long the count takes to arrive, so the page shell and the todo list are on screen well before it. */
export const STATS_DELAY_MS = 300;

/** A slow summary. On the streaming route it shows a skeleton first and swaps in when its loader settles. */
export class DemoStats extends ServerElement {
  @state() total = 0;
  @state() done = 0;

  @loader()
  async load(env: DemoEnv) {
    await new Promise((resolve) => setTimeout(resolve, STATS_DELAY_MS));
    const stub = env.TODOS.get(env.TODOS.idFromName('main'));
    const items = (await (await stub.fetch('http://store/list')).json()) as Todo[];
    this.total = items.length;
    this.done = items.filter((item) => item.done).length;
  }

  renderPending() {
    return html`<p class="pending">Counting tasks…</p>`;
  }

  render() {
    return html`<p class="stats">${this.done} of ${this.total} done</p>`;
  }
}
customElements.define('demo-stats', DemoStats);
