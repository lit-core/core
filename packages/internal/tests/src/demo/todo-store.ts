/** Minimal subset of the Durable Object runtime types the demo uses, so no extra type packages are needed. */
interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

/** Holds the todo list. One instance serves the whole demo, so state survives across requests and isolates. */
export class TodoStore {
  constructor(private readonly state: { storage: DurableObjectStorageLike }) {}

  private async read(): Promise<Todo[]> {
    return (await this.state.storage.get<Todo[]>('items')) ?? [];
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const items = await this.read();

    if (request.method === 'GET' && url.pathname === '/list') {
      return Response.json(items);
    }
    const body = (await request.json()) as { id?: string; title?: string };
    let next = items;
    if (url.pathname === '/add') {
      next = [...items, { id: crypto.randomUUID().slice(0, 8), title: String(body.title), done: false }];
    } else if (url.pathname === '/toggle') {
      next = items.map((item) => (item.id === body.id ? { ...item, done: !item.done } : item));
    } else if (url.pathname === '/remove') {
      next = items.filter((item) => item.id !== body.id);
    } else {
      return new Response('Not found', { status: 404 });
    }
    await this.state.storage.put('items', next);
    return Response.json(next);
  }
}
