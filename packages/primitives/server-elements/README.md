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

### Wiring it up

A running app has three parts: the components, a client bundle that makes them interactive, and a worker that renders pages and answers actions. The demo in `packages/internal/tests/src/demo/` is a complete, tested example (a todo list with a Durable Object store, a streamed element, the replay guard), served by the real `workerd` over HTTP in `suites/demo-workerd-http.test.ts`.

**Build twice from the same sources.** The compiler splits each element into a client stub and a worker class, so the client and worker builds use the same plugin with a different `target`:

```ts
import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';

// The browser bundle: stubs only, no Lit and no loader or action code.
await build({
  build: { rollupOptions: { input: 'src/client.ts' } }, // imports each component file
  plugins: [propsLower(), serverElements({ target: 'client', autoInjectExecutor: true })],
});

// The worker: the full classes, templates compiled ahead of time.
await build({
  build: { ssr: true, rollupOptions: { input: 'src/worker.ts', external: ['./ssr_bg.wasm'], output: { entryFileNames: 'worker.js' } } },
  ssr: { noExternal: true },
  plugins: [propsLower(), serverElements({ target: 'worker' })],
});
```

**The worker** routes three kinds of request: the client script, actions, and pages. Pick the page path by what the page needs. `renderServerElement` finishes the loaders before sending, so the page works with scripts off; the `HTMLRewriter` path streams the shell first and needs scripts for the swap.

```ts
import 'virtual:lit-core/install-globals';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { renderServerElement } from '@lit-core/server-elements/edge';
import { initSsrWasmSync } from '@lit-core/ssr';
import ssrWasmModule from './ssr_bg.wasm';
import './todo-list.js'; // registers the element

initSsrWasmSync(ssrWasmModule);

export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/_lit/a/')) {
      return handleActionRequest(request, { env, secret: env.SECRET });
    }
    const ssr = await renderServerElement('todo-list', {}, { secret: env.SECRET, env, request, mode: 'dsd' });
    return new Response(`<!doctype html><script type="module" src="/client.js"></script>${ssr.html}`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
```

On the streaming path, `tagManifest` is an allowlist: it names the tags the rewriter expands, and only those. Expanding a tag runs that element's loaders on the server, so a registered element whose tag happens to appear in the page is left alone unless it is listed. Give no list at all and every registered element qualifies, which suits a page you fully control.

`SECRET` is 32 random bytes kept as a secret binding (`openssl rand -base64 32`). The signature and the data it covers are in every page, so a short or guessable secret can be found by trying guesses offline: rendering and the endpoint refuse any secret shorter than 32 characters, or none at all, and randomness is what makes a longer one safe. The worker also needs `ssr_bg.wasm` from `@lit-core/ssr` bound as a module and the `nodejs_compat` flag; the demo's `demo-server.ts` shows the full `workerd` configuration. Everything else in this document (`ttlMs`, `maxBodyBytes`, `replayGuard`, `encryptState`) is an option on one of those two calls.

**During `vite dev`** the plugin answers action requests itself, so a component can be tried without a worker. It finds the element in the project when a request names an action it has not seen (for example after the dev server restarts under an open page), loads it, and verifies the snapshot with the plugin's `secret` option, which defaults to a fixed development key. The page you render in development must sign with that same secret, or every action fails with `STATE_TAMPERED`. The default key is public: set `secret` for anything reachable from outside your machine.

The plugin can also generate a worker entry (`virtual:lit-core/worker`), which suits a static site whose HTML is served from the assets binding and streamed through `HTMLRewriter`. It handles actions with the defaults only, and it does not give pages that work without JavaScript, so a worker you write yourself is the route when you need the options above.

### Loader revalidation

After an action runs, its loaders re-run so server data reflects the change. Narrow that with literal decorator options, which the compiler checks (`SE107` for anything non-literal or unknown):

```ts
@loader({ dependencies: ['category'] })   // re-runs only after an action wrote `category`
async loadItems() { /* ... */ }

@action({ revalidate: false })           // skips loader revalidation for this action
async trackView() { /* ... */ }
```

Loaders without `dependencies` re-run after every action. Loaders of one element run concurrently, so each should assign its own properties.

### Placeholders for streamed elements

On the streaming path an element is swapped in once its loaders settle. Until then it shows what its `renderPending()` returns, or an empty slot when it has none:

```ts
renderPending() {
  return html`<p class="pending">Counting tasks…</p>`;
}
```

`renderPending()` runs on the server only. The compiler keeps it in the worker and removes it from the client stub, so it adds nothing to what the browser downloads.

### Method names

A server element is a real custom element, so an `@action()` or `@loader()` named like a member the element already has would replace it: an action called `remove` would make `element.remove()` send a request. The compiler rejects these names with `SE108`. Pick a more specific name, such as `removeTask`.

### State is plain data

Element state is signed and sent to the browser as JSON, then echoed back with every action. A `Map`, `Set`, `Date`, class instance, function or `NaN` cannot make that trip: it would come back as something other than what the server held, so state holding one is refused rather than silently altered.

- At build time, `SE109` rejects a reactive property whose type annotation is one of these (`@state() tags: Set<string>`), including inside arrays, unions and object types.
- At render and when an action signs its result, a `NonJsonStateError` names the property path (`items[2].tags`) and what was found there. This catches values the annotations did not show.

Keep an array of entries for a `Map` or `Set`, and an ISO string for a `Date`.

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

`formFields()` embeds a signed ticket as hidden inputs: the element's tag, public attributes, token and build id, with no state. The endpoint verifies the ticket, applies the same cross-site check, runs the element's loaders to rebuild the state the page was rendered with (a form post carries none, so a forged state field is ignored), runs the action with the other fields as one argument object, then answers `303` back to `redirect` (a same-site path), the `Referer`, or `/`. The reloaded page shows the result because its loaders re-run, so state a form changes must come from loaders, a database, or cookies, not from client-only state. A deliberate `ActionError` shows its message on a plain page with the mapped status. When JavaScript is available, the same form is intercepted: its `submit` calls the action over `fetch` and applies the patches in place, keeping focus, scroll and unsubmitted input. The compiler adds the runtime to any component whose template binds a `<form>`'s `action`, and the runtime reads the action from the form's own URL.

#### Which render path works without JavaScript

Forms only work with scripts off on pages where the element's loaders finish **before** the page is sent, which is what `renderServerElement` and `renderToResponse` do. The list, its forms and their signed fields are then in the HTML itself.

The streaming path (`transformServerElementsWithHtmlRewriter`) sends the page shell first and swaps each element in as its loaders settle. That swap is an inline script, so with scripts off a visitor sees only the pending slot. Use the non-streaming path for any page that has to work without JavaScript, and keep streaming for pages where that does not matter. The demo's `/` and `/stream` routes show both, and a test pins the difference.

### Pending state on the client

A compiled client element cannot re-render, so while an action is in flight its host carries `data-lit-pending="save"` (the action name, or its hash) and `aria-busy="true"`, and both are removed when nothing is outstanding. Style it with plain CSS:

```css
:host([data-lit-pending]) button {
  opacity: 0.6;
  pointer-events: none;
}
```

### Responses apply as a unit

An action response is a stream of patches, an optional result, and a signed snapshot of the state those patches leave the page in. When loaders must re-run, the action's own patches arrive first, with their snapshot, and the loader-derived patches follow with another.

The browser holds each group of frames until its snapshot arrives and applies them together. If the connection drops mid-response, the page and the signed state it will send next are both still as they were, instead of a page showing the new state over a snapshot of the old one. A phase that arrived whole stays applied.

### Encrypted state

By default the signed state in the page is readable, so anything loaded into it can be seen by whoever can see the page. Turn on `encryptState` to send it as an opaque AES-GCM ciphertext instead:

```ts
renderServerElement('account-card', {}, { secret, encryptState: true });
handleActionRequest(request, { env, secret, encryptState: true });
```

Render and endpoint must agree. The key is derived from `secret` (HKDF), so the secret must be a string, and each ciphertext is bound to its element tag. The HMAC signature still covers the plaintext, so sequence, token and build checks are unchanged. Forms carry no state at all, encrypted or not, so each form stays a few hundred bytes however large the state is.

### State lifetime and pages that go out of date

Every signed snapshot, and every form ticket, carries an expiry: 15 minutes by default, set with `ttlMs` when rendering and `stateTtlMs` on the action endpoint. Each action returns a fresh snapshot, so a page in use stays valid. A page left open past the lifetime, or from before a deploy, cannot run actions, and the browser is told why rather than shown a tamper error:

| Code             | Status | Meaning                                              |
| :--------------- | :----- | :--------------------------------------------------- |
| `STATE_EXPIRED`  | 409    | The page outlived its signed state                   |
| `ACTION_STALE`   | 409    | The server was deployed since the page was rendered  |
| `STATE_REPLAYED` | 409    | The snapshot was already used (with a `replayGuard`) |

All three mean the same thing to the person: reload. `isReloadRequired(error)` recognizes them, and a form post from such a page gets an HTML page that says so:

```ts
import { isReloadRequired } from '@lit-core/server-elements/client';

document.addEventListener('lit-action-error', (event) => {
  if (isReloadRequired((event as CustomEvent).detail.error)) showReloadBanner();
});
```

Pick a lifetime for how long people leave a page open before acting: a short one limits how long a captured request stays usable, a long one suits forms people fill in slowly.

### Request size

An action request carries the element's whole signed state, so its size grows with the data the element holds, not with the action's arguments. The endpoint reads at most 64 KB by default and enforces that while the body streams in. An element holding a few hundred rows can reach it, and the action then fails with `413 PAYLOAD_TOO_LARGE`, whose message says the state is the cause.

Raise it where the data is legitimately larger, or keep large data out of reactive properties and load it from a loader instead:

```ts
handleActionRequest(request, { env, secret, maxBodyBytes: 256 * 1024 });
```

A no-JavaScript form post carries a ticket rather than state, so only the form's own fields count against the limit.

### Replay protection

Signed state is stateless, so a captured request can be replayed until its snapshot expires. Pass a `replayGuard` to make every snapshot single-use:

```ts
import { createMemoryReplayGuard, handleActionRequest } from '@lit-core/server-elements/action-endpoint';

handleActionRequest(request, { env, secret, replayGuard: createMemoryReplayGuard() });
```

A second use of a snapshot is rejected with `409 STATE_REPLAYED` before the action runs. A request rejected earlier (bad origin, signature, arguments or unknown action) does not consume its snapshot. A streamed action that fails after it started does, so the response begins with a fresh snapshot of the state the browser already holds, and the next action carries on from it. The in-memory guard only protects one isolate; implement `ReplayGuard.claim(signature, ttlMs)` over a shared store (a Durable Object, or Redis `SET NX`) in production. If `claim` rejects, the request fails closed.

#### On Cloudflare Workers

`@lit-core/server-elements/cloudflare` ships a guard backed by Durable Objects, one deployment-wide store that every isolate shares. Export the object class from the worker entry, bind it, and pass the guard:

```ts
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { createDurableObjectReplayGuard } from '@lit-core/server-elements/cloudflare';

export { ReplayGuardStore } from '@lit-core/server-elements/cloudflare';

export default {
  fetch: (request, env) => handleActionRequest(request, { env, secret: env.SECRET, replayGuard: createDurableObjectReplayGuard(env.REPLAY_GUARD) }),
};
```

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "REPLAY_GUARD"
class_name = "ReplayGuardStore"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ReplayGuardStore"]
```

Claims are spread over 16 objects by default, so unrelated requests do not queue behind each other (`{ shards: n }` changes that). A given signature always goes to the same object, which is what makes single use hold: of any number of simultaneous requests carrying one signature, exactly one wins. The demo runs this guard in `workerd` and a test sends ten at once.


The browser runtime runs one element's actions strictly in order, each starting from the snapshot the previous response delivered. That is what makes single-use snapshots safe for honest traffic, and it also stops two quick actions from overwriting each other's state.

### Errors

Throw `ActionError` for expected failures. Its code and message reach the user, and the JSON transport answers with the matching HTTP status. Any other thrown error is treated as a bug: it is redacted from the response (outside `devMode`) and passed to `onError`.

```ts
import { action, ActionError } from '@lit-core/server-elements';

@action()
async removeItem(id: string) {
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
| `@lit-core/server-elements/cloudflare`      | Durable Object replay guard for Cloudflare Workers (`createDurableObjectReplayGuard`, `ReplayGuardStore`)               |
| `@lit-core/server-elements/crypto`          | HMAC-SHA256 state signing and verification (`createSignedStateSnapshot`, `verifyStateSignature`, `generateActionToken`) |

The root entry never imports the server or browser runtime, so a component file can be bundled for either side.

## Source layout

Each directory has one job, and the dependency rules are tested in `tests/unit/layering.test.ts`.

| Path                               | Responsibility                                                                                      | Runs in         |
| :--------------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------- |
| `index.ts`, `element.ts`           | Authoring surface: `ServerElement`, decorators, context and protocol types                          | Server + client |
| `decorators/`                      | `@loader()` and `@action()`, which throw if a file reaches the runtime uncompiled                   | Server          |
| `render/`                          | Server rendering: loaders, lifecycle, state signing, `HTMLRewriter` adapter, streaming responses    | Server          |
| `endpoint/`                        | Action requests: validation, scope, transports (form, NDJSON, JSON), replay and CSRF checks         | Server          |
| `patches/`                         | Diffing: which binding parts changed, keyed list ops, snapshot frames                               | Server          |
| `client-runtime/`                  | Browser: action queue, patch executor, form interception, pending state                             | Client          |
| `crypto.ts`, `state-sealer.ts`     | HMAC signing, and optional AES-GCM encryption of state                                              | Server          |
| `replay-guard.ts`, `cloudflare.ts` | Single-use snapshots: the in-memory guard and the Durable Object guard                              | Server          |
| `bounded-cache.ts`                 | Least-recently-used cache that keeps derived signing and encryption keys from growing without limit | Server          |
| `protocol.ts`, `form-fields.ts`    | Wire constants and form field collection shared by both sides, with no dependencies                 | Both            |

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
