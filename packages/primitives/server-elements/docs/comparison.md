# Comparison with Qwik City, Astro and React server actions

Compared against the upstream sources of Qwik (`qwik-router`) and Astro (`actions`, `server-islands`), plus React's documented server action model. Cells marked "Not reviewed" were not checked against source. This is a working document: it records where server elements stand so the gaps drive the next work.

## Capability comparison

| Capability                  | Server elements                                                                      | Qwik City                        | Astro                            | React server actions |
| :-------------------------- | :----------------------------------------------------------------------------------- | :------------------------------- | :------------------------------- | :------------------- |
| Input validation            | Compiler synthesizes validators from TypeScript parameters, naming the failing field | `zod$` and `valibot$` validators | Zod `input` schemas              | Manual               |
| Typed, user-safe errors     | `ActionError` with codes and statuses; others are redacted                           | `fail()` returns                 | `ActionError` with codes         | Throw or return      |
| Works without JavaScript    | Yes: form posts, enhanced in place when script runs                                  | Yes, form posts                  | Yes, form posts                  | Yes, form actions    |
| Streaming action responses  | Two-phase NDJSON: action patches first, loader patches after                         | Loaders stream through SSR       | No                               | Streams through RSC  |
| Deferred rendering          | `renderPending` boundaries flushed out of order                                      | Lazy resumption                  | Server islands (`server:defer`)  | Suspense             |
| State integrity             | HMAC signed; AES-GCM encryption opt-in                                               | Not reviewed                     | Island props encrypted           | Not reviewed         |
| Cross-site protection       | `Origin` and `Sec-Fetch-Site` checks, allowlist                                      | `checkOrigin` option             | `checkOrigin` option             | Not reviewed         |
| Request body limit          | 64 KB, enforced while streaming                                                      | Not reviewed                     | Configurable, enforced streaming | Not reviewed         |
| Selective revalidation      | `dependencies` and `revalidate: false`, compiler checked                             | Loaders refresh after actions    | Not applicable                   | Cache tags and paths |
| Client code for a component | Zero Lit runtime: part descriptors, RPC stub, patch executor                         | Lazy chunks plus a small loader  | Framework island or none         | React runtime        |

## Resumability and streaming

Server elements do not resume application code: they send patches. The sibling package `@lit-core/resumable` covers the other half, deferring a component's JavaScript until someone touches it. Compared against Qwik's `qwikloader.ts` and its streaming executors, and Lit's `ssr-client` hydration support.

| Aspect                  | `@lit-core/resumable`                                                               | Qwik                                                                     | Lit labs `ssr-client`                    |
| :---------------------- | :---------------------------------------------------------------------------------- | :----------------------------------------------------------------------- | :--------------------------------------- |
| Unit that is loaded     | The touched component's chunk, found by tag in a build manifest                     | One handler: attributes hold `chunk#symbol#captures`                     | Whole component classes, loaded up front |
| Trigger                 | Capture-phase `click`, `keydown`, `input`; `events` option widens it                | Any event through `on:` attributes, plus window, document and visibility | Page load, or `defer-hydration` removal  |
| State carried to client | Reactive property snapshot per component                                            | Serialized object graph and closure captures                             | None; re-derived by re-rendering         |
| Preloading              | Hover, focus and pointer-down preload, optional idle, load/idle/visible             | A preloader module in core                                               | None                                     |
| Out-of-order streaming  | Boundaries fill in as they resolve; optional `together` or `forwards` reveal groups | Streaming executor with reveal groups and order (`q:g`, `q:o`)           | Ordered, in document order               |
| Failed boundary         | `errorFallback` on the boundary                                                     | Error swap executor                                                      | Not applicable                           |

What follows from this:

- **Granularity is the structural difference.** Qwik can load one click handler without its component. A Lit component is a class with a `render()` that closes over `this`, so the smallest sound unit here is the component. Closing that gap would mean serializing handler captures, which the Lit programming model does not give us.
- **Reveal ordering is server-side.** Qwik groups boundaries with attributes (`q:g`, `q:o`) interpreted by a client executor. Ours orders the chunks it emits, with `createAsyncBoundary(..., { group: { id, reveal: 'together' | 'forwards' } })`, so the browser needs no extra script.
- **Parity where it counts for the goal.** Zero component JavaScript on first paint, nodes and focus preserved on resume, hover preload and an error fallback are all present and tested.

## Where server elements are ahead

- Validation comes from the types the author already wrote, with no runtime schema library and nothing extra shipped to the browser.
- A server element keeps its Web Component shape: standard Shadow DOM, standard attributes, no framework boundary around it.
- Action patches target individual bindings with compiler-computed dependencies, so unrelated DOM, focus and selection are untouched.

## Gaps, in priority order

1. **No optimistic updates.** React offers `useOptimistic`. Pending state is covered (`data-lit-pending` and `aria-busy` on the host, `isActionPending` on Lit elements), but a provisional result before the server answers is not: a zero-Lit stub cannot render one.

   Design sketch, not built. The patch executor can already apply scalar values, so the missing pieces are narrower than a client renderer:
   - The compiler would emit an identity map from a property to the parts that display it unchanged (a binding that is exactly `${this.count}`, never `${this.count * 2}`). Only those parts can be set honestly from a property value.
   - `dispatchServerAction` would accept `optimistic: { count: 3 }`, read each part's current value, apply the provisional one, and restore the saved value when the action fails. Authoritative frames from the server replace the provisional ones on success.
   - Queued actions complicate rollback: a failure must restore the value from before the first provisional write that is still unresolved.
2. **Replay protection is opt-in.** `replayGuard` makes snapshots single-use, but it needs a shared store the deployment provides; without one a snapshot can be replayed until it expires.
3. **State encryption is opt-in.** `encryptState` hides state from the page as Astro does for island props, but it is off by default, so state is readable until you enable it.
4. **Queued actions are never cancelled (deliberate).** Actions on one element run in order, and each one runs to completion: actions are mutations, so cancelling one could discard a submit the user meant. Search-as-you-type reads belong in loaders, not actions.
