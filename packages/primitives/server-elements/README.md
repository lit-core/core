# `@lit-core/server-elements`

Authoring primitives, decorators, and execution runtimes for Lit server elements.

Lit server elements let you write standard Lit components with server-side `@loader()` and `@action()` methods. Components render on Node.js or WinterCG edge workers (including Cloudflare Workers `HTMLRewriter`), stream initial HTML as Declarative Shadow DOM with HMAC-signed state snapshots, and apply interactive updates in the browser through surgical DOM patch frames without shipping server code or the full Lit runtime to the client.

## Installation

```bash
pnpm add @lit-core/server-elements
```

## Usage

### Component authoring

Extend `ServerElement` (or apply `ServerElementMixin` to `LitElement`) to access server `env` bindings, request `context`, and client `actionState` tracking:

```ts
import { html } from 'lit';
import { ServerElement, loader, action } from '@lit-core/server-elements';

export class ProductStock extends ServerElement {
  static properties = {
    sku: { type: String },
    stock: { type: Number, state: true },
  };

  declare sku: string;
  declare stock: number;

  @loader()
  async load(env: Env) {
    this.stock = await env.DB.prepare('SELECT qty FROM inventory WHERE sku = ?')
      .bind(this.sku)
      .first('qty');
  }

  @action()
  async reserve(qty: number) {
    await this.env.DB.prepare('UPDATE inventory SET qty = qty - ? WHERE sku = ?')
      .bind(qty, this.sku)
      .run();
    this.stock -= qty;
  }

  render() {
    return html`
      <p>In stock: ${this.stock}</p>
      <button ?disabled=${this.isActionPending('reserve')} @click=${() => this.reserve(1)}>
        Reserve
      </button>
    `;
  }
}

customElements.define('product-stock', ProductStock);
```

### Edge rendering and action handling

Use the edge and action endpoint helpers to render components to Declarative Shadow DOM and handle `POST /_lit/a/<actionHash>` RPC mutations:

```ts
import {
  handleActionRequest,
  renderToResponse,
  transformServerElementsWithHtmlRewriter,
} from '@lit-core/server-elements';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/_lit/a/')) {
      return handleActionRequest(request, {
        env,
        secret: env.LIT_ACTION_SECRET,
      });
    }

    const html = '<product-stock sku="item-42"></product-stock>';
    return transformServerElementsWithHtmlRewriter(html, {
      request,
      env,
      secret: env.LIT_ACTION_SECRET,
    });
  },
};
```

## Subpath exports

| Export path | Purpose |
| :--- | :--- |
| `@lit-core/server-elements` | Main entry point exporting `ServerElement`, `ServerElementMixin`, `@loader()`, `@action()`, edge renderers, and action handlers |
| `@lit-core/server-elements/edge` | Edge rendering utilities (`renderServerElement`, `renderToResponse`, `transformServerElementsWithHtmlRewriter`, `createLoaderContext`) |
| `@lit-core/server-elements/action-endpoint` | Server action RPC handler (`handleActionRequest`, `computeSurgicalPatches`) with CSRF, HMAC state verification, and argument validation |
| `@lit-core/server-elements/client` | Client RPC dispatcher and event binder (`dispatchServerAction`, `bindFormAction`, `executePatches`) |
| `@lit-core/server-elements/executor` | Low-level DOM patch executor and keyed list reconciler (`executePatches`, `reconcileKeyedList`) |
| `@lit-core/server-elements/crypto` | HMAC-SHA256 state signing and verification (`createSignedStateSnapshot`, `verifyStateSignature`, `generateActionToken`) |

## Compilation requirements

Methods decorated with `@loader()` and `@action()` are split ahead of time by [`@lit-core/server-split`](../../transforms/server-split/README.md) (integrated automatically via [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) or [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md)). Evaluating uncompiled `@loader()` or `@action()` decorators at runtime throws `UncompiledServerElementError` so database queries and secrets cannot leak into client bundles.

## Related packages

- [`@lit-core/server-split`](../../transforms/server-split/README.md) - Ahead-of-time server/client boundary splitter and schema compiler
- [`@lit-core/ssr`](../../rendering/ssr/README.md) - Streaming Declarative Shadow DOM server-side rendering engine
- [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) - Vite and Rollup integration
- [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md) - Webpack integration
