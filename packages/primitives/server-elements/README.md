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
    this.stock = await env.DB.prepare('SELECT qty FROM inventory WHERE sku = ?').bind(this.sku).first('qty');
  }

  @action()
  async reserve(qty: number) {
    await this.env.DB.prepare('UPDATE inventory SET qty = qty - ? WHERE sku = ?').bind(qty, this.sku).run();
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

### Loader revalidation

After an action runs, its loaders re-run so server data reflects the change. Narrow that with literal decorator options, which the compiler checks (`SE107` for anything non-literal or unknown):

```ts
@loader({ dependencies: ['category'] })   // re-runs only after an action wrote `category`
async loadItems() { /* ... */ }

@action({ revalidate: false })           // skips loader revalidation for this action
async trackView() { /* ... */ }
```

Loaders without `dependencies` re-run after every action. Loaders of one element run concurrently, so each should assign its own properties.

### Forms without JavaScript

Inside a server element, a plain HTML form can run an action with no script on the page:

```ts
render() {
  return html`
    <form method="post" action=${this.actionUrl('reserve')}>
      ${this.formFields({ redirect: '/cart' })}
      <input name="qty" />
      <button>Reserve</button>
    </form>
  `;
}
```

`formFields()` embeds the signed snapshot as hidden inputs. The endpoint verifies it exactly as it does for `fetch`, applies the same cross-site check, runs the action with the other fields as one argument object, then answers `303` back to `redirect` (a same-site path), the `Referer`, or `/`. The reloaded page shows the result because its loaders re-run, so state a form changes must come from loaders, a database, or cookies, not from client-only state. A deliberate `ActionError` shows its message on a plain page with the mapped status. When JavaScript is available, the same form is intercepted: its `submit` calls the action over `fetch` and applies the patches in place, keeping focus, scroll and unsubmitted input. The compiler adds the runtime to any component whose template binds a `<form>`'s `action`, and the runtime reads the action from the form's own URL.

### Pending state on the client

A compiled client element cannot re-render, so while an action is in flight its host carries `data-lit-pending="save"` (the action name, or its hash) and `aria-busy="true"`, and both are removed when nothing is outstanding. Style it with plain CSS:

```css
:host([data-lit-pending]) button {
  opacity: 0.6;
  pointer-events: none;
}
```

### Encrypted state

By default the signed state in the page is readable, so anything loaded into it can be seen by whoever can see the page. Turn on `encryptState` to send it as an opaque AES-GCM ciphertext instead:

```ts
renderServerElement('account-card', {}, { secret, encryptState: true });
handleActionRequest(request, { env, secret, encryptState: true });
```

Render and endpoint must agree. The key is derived from `secret` (HKDF), so the secret must be a string, and each ciphertext is bound to its element tag. The HMAC signature still covers the plaintext, so sequence, token and build checks are unchanged. Encrypted state is also what the no-JavaScript form fields carry.

### Replay protection

Signed state is stateless, so a captured request can be replayed until its snapshot expires. Pass a `replayGuard` to make every snapshot single-use:

```ts
import { createMemoryReplayGuard, handleActionRequest } from '@lit-core/server-elements/action-endpoint';

handleActionRequest(request, { env, secret, replayGuard: createMemoryReplayGuard() });
```

A second use of a snapshot is rejected with `409 STATE_REPLAYED` before the action runs. A request rejected earlier (bad origin, signature, arguments or unknown action) does not consume its snapshot. A streamed action that fails after it started does, so the response begins with a fresh snapshot of the state the browser already holds, and the next action carries on from it. The in-memory guard only protects one isolate; implement `ReplayGuard.claim(signature, ttlMs)` over a shared store (a Durable Object, or Redis `SET NX`) in production. If `claim` rejects, the request fails closed.

The browser runtime runs one element's actions strictly in order, each starting from the snapshot the previous response delivered. That is what makes single-use snapshots safe for honest traffic, and it also stops two quick actions from overwriting each other's state.

### Errors

Throw `ActionError` for expected failures. Its code and message reach the user, and the JSON transport answers with the matching HTTP status. Any other thrown error is treated as a bug: it is redacted from the response (outside `devMode`) and passed to `onError`.

```ts
import { action, ActionError } from '@lit-core/server-elements';

@action()
async remove(id: string) {
  if (!this.canEdit) throw new ActionError('FORBIDDEN', 'You cannot edit this list.');
}
```

Attach per-field messages for a form to show next to its inputs:

```ts
throw new ActionError('UNPROCESSABLE_CONTENT', 'Fix the highlighted fields.', { fields: { email: 'Already registered' } });
```

They arrive on the error frame and JSON body, on `ServerActionError.fields`, and on the plain error page of a no-JavaScript post.

The compiler's argument validators report the same way. When an action takes a form's fields as one object, a failed type check names the offending input (`{ age: "Invalid argument 'fields.age': expected number" }`) with a `400 VALIDATION_ERROR`. A parameter with a default value (`note: string = 'none'`) may be omitted, and is still type-checked when given.

Client elements compiled to zero-Lit stubs have no action state, so every settled action also fires a bubbling, composed DOM event: `lit-action-success` (`detail.result`) and `lit-action-error` (`detail.error`, with its `code` and `fields`), each with `detail.action`. Listen on the element or on `document`.

Codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `GONE`, `PRECONDITION_FAILED`, `UNPROCESSABLE_CONTENT`, `TOO_MANY_REQUESTS`. See [`docs/comparison.md`](docs/comparison.md) for how this compares with other frameworks.

### Action response streaming

An action response streams as NDJSON. When loaders must re-run, the action's own patches and return value are sent first, so the page reflects the action while slower loaders are still fetching. The loader-derived patches follow, then the signed state snapshot. Set cookies and headers inside the action: a loader that revalidates after the response has started cannot, and throws a clear error if it tries. If a loader fails, the snapshot for what was already delivered is sent before the error frame, so the browser's signed state always matches its DOM.

### Edge rendering and action handling

Use the edge and action endpoint helpers to render components to Declarative Shadow DOM and handle `POST /_lit/a/<actionHash>` RPC mutations:

```ts
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { transformServerElementsWithHtmlRewriter } from '@lit-core/server-elements/edge';

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

| Export path                                 | Purpose                                                                                                                 |
| :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------- |
| `@lit-core/server-elements`                 | Authoring surface: `ServerElement`, `ServerElementMixin`, `@loader()`, `@action()`, context and protocol types          |
| `@lit-core/server-elements/edge`            | Server rendering (`renderServerElement`, `renderToResponse`, `transformServerElementsWithHtmlRewriter`)                 |
| `@lit-core/server-elements/action-endpoint` | Action RPC handler (`handleActionRequest`) with CSRF, HMAC state verification, and argument validation                  |
| `@lit-core/server-elements/client`          | Browser runtime (`dispatchServerAction`, `bindFormAction`, `executePatches`)                                            |
| `@lit-core/server-elements/executor`        | Browser patch executor alone, injected by bundler plugins into client builds                                            |
| `@lit-core/server-elements/crypto`          | HMAC-SHA256 state signing and verification (`createSignedStateSnapshot`, `verifyStateSignature`, `generateActionToken`) |

The root entry never imports the server or browser runtime, so a component file can be bundled for either side.

## Source layout

Each directory has one job, and the dependency rules are tested in `tests/unit/layering.test.ts`.

| Path                            | Responsibility                                                                                   | Runs in         |
| :------------------------------ | :----------------------------------------------------------------------------------------------- | :-------------- |
| `index.ts`, `element.ts`        | Authoring surface: `ServerElement`, decorators, context and protocol types                       | Server + client |
| `decorators/`                   | `@loader()` and `@action()`, which throw if a file reaches the runtime uncompiled                | Server          |
| `render/`                       | Server rendering: loaders, lifecycle, state signing, `HTMLRewriter` adapter, streaming responses | Server          |
| `endpoint/`                     | Action requests: validation, scope, transports (form, NDJSON, JSON), replay and CSRF checks      | Server          |
| `patches/`                      | Diffing: which binding parts changed, keyed list ops, snapshot frames                            | Server          |
| `client-runtime/`               | Browser: action queue, patch executor, form interception, pending state                          | Client          |
| `crypto.ts`, `state-sealer.ts`  | HMAC signing, and optional AES-GCM encryption of state                                           | Server          |
| `protocol.ts`, `form-fields.ts` | Wire constants and form field collection shared by both sides, with no dependencies              | Both            |

Rules the layering test enforces:

- The browser entry points (`client.ts`, `executor.ts`) load no package and no server module, so nothing server-only can ship to a page. This once failed when `ActionError` was added next to a browser class; the test now catches it.
- The authoring entry (`index.ts`) loads neither runtime, so a component file bundles for either side.
- `protocol.ts` and `form-fields.ts` import nothing, and `types.ts` has no runtime imports.

## Compilation requirements

Methods decorated with `@loader()` and `@action()` are split ahead of time by [`@lit-core/server-split`](../../transforms/server-split/README.md) (integrated automatically via [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) or [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md)). Evaluating uncompiled `@loader()` or `@action()` decorators at runtime throws `UncompiledServerElementError` so database queries and secrets cannot leak into client bundles.

## Related packages

- [`@lit-core/server-split`](../../transforms/server-split/README.md) - Ahead-of-time server/client boundary splitter and schema compiler
- [`@lit-core/ssr`](../../rendering/ssr/README.md) - Streaming Declarative Shadow DOM server-side rendering engine
- [`@lit-core/vite-plugin`](../../bundlers/vite-plugin/README.md) - Vite and Rollup integration
- [`@lit-core/webpack-plugin`](../../bundlers/webpack-plugin/README.md) - Webpack integration
