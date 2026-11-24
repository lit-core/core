import { ActionError, action, loader, ServerElement } from '@lit-core/server-elements';
import { html } from 'lit';
import { state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Todo } from './todo-store.js';

/** Bindings the demo worker is deployed with. */
export interface DemoEnv {
  TODOS: { idFromName(name: string): unknown; get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> } };
}

const MAX_TODOS = 5;

async function callStore(env: DemoEnv, path: string, body?: unknown): Promise<Todo[]> {
  const stub = env.TODOS.get(env.TODOS.idFromName('main'));
  const response = await stub.fetch(`http://store${path}`, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
  return (await response.json()) as Todo[];
}

/** A todo list whose data lives in a Durable Object, so every change is visible to the next request. */
export class DemoTodos extends ServerElement {
  @state() items: Todo[] = [];

  @loader()
  async load(env: DemoEnv) {
    this.items = await callStore(env, '/list');
  }

  @action()
  async add(input: { title: string }) {
    const title = (input.title ?? '').trim();
    if (!title) {
      throw new ActionError('UNPROCESSABLE_CONTENT', 'Give the task a title.', { fields: { title: 'Required' } });
    }
    if (this.items.length >= MAX_TODOS) {
      throw new ActionError('CONFLICT', `The list is full (${MAX_TODOS} tasks).`);
    }
    this.items = await callStore(this.env as unknown as DemoEnv, '/add', { title });
  }

  @action()
  async toggle(input: { id: string }) {
    this.items = await callStore(this.env as unknown as DemoEnv, '/toggle', { id: input.id });
  }

  @action()
  async removeTask(input: { id: string }) {
    this.items = await callStore(this.env as unknown as DemoEnv, '/remove', { id: input.id });
  }

  render() {
    return html`
      <ul class="list">
        ${repeat(
          this.items,
          (item) => item.id,
          (item) => html`<li class="row" data-id="${item.id}">
            <form method="post" action="${this.actionUrl('toggle')}">
              ${this.formFields({ redirect: '/' })}
              <input type="hidden" name="id" value="${item.id}" />
              <button class="toggle" type="submit">${item.done ? 'Undo' : 'Done'}</button>
            </form>
            <span class="title" data-done="${item.done ? 'yes' : 'no'}">${item.title}</span>
            <form method="post" action="${this.actionUrl('removeTask')}">
              ${this.formFields({ redirect: '/' })}
              <input type="hidden" name="id" value="${item.id}" />
              <button class="remove" type="submit">Remove</button>
            </form>
          </li>`,
        )}
      </ul>
      <form class="add" method="post" action="${this.actionUrl('add')}">
        ${this.formFields({ redirect: '/' })}
        <input name="title" placeholder="New task" />
        <button class="add-btn" type="submit">Add</button>
      </form>
    `;
  }
}
customElements.define('demo-todos', DemoTodos);
