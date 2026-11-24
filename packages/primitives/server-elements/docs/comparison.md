# Comparison with Qwik City, Astro and React server actions

Compared against the upstream sources of Qwik (`qwik-router`) and Astro (`actions`, `server-islands`), plus React's documented server action model. Cells marked "Not reviewed" were not checked against source. This is a working document: it records where server elements stand so the gaps drive the next work.

## Capability comparison

| Capability                  | Server elements                                                                                                                 | Qwik City                        | Astro                            | React server actions |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :------------------------------- | :------------------------------- | :------------------- |
| Input validation            | Compiler synthesizes validators from TypeScript parameters, naming the failing field                                            | `zod$` and `valibot$` validators | Zod `input` schemas              | Manual               |
| Typed, user-safe errors     | `ActionError` with codes and statuses; others are redacted                                                                      | `fail()` returns                 | `ActionError` with codes         | Throw or return      |
| Works without JavaScript    | Yes on the non-streaming render path: form posts, enhanced in place when script runs (a streamed element needs its swap script) | Yes, form posts                  | Yes, form posts                  | Yes, form actions    |
| Streaming action responses  | Two-phase NDJSON: action patches first, loader patches after                                                                    | Loaders stream through SSR       | No                               | Streams through RSC  |
| Deferred rendering          | `renderPending` boundaries flushed out of order                                                                                 | Lazy resumption                  | Server islands (`server:defer`)  | Suspense             |
| State integrity             | HMAC signed; AES-GCM encryption opt-in                                                                                          | Not reviewed                     | Island props encrypted           | Not reviewed         |
| Cross-site protection       | `Origin` and `Sec-Fetch-Site` checks, allowlist                                                                                 | `checkOrigin` option             | `checkOrigin` option             | Not reviewed         |
| Request body limit          | 64 KB by default (`maxBodyBytes`), enforced while streaming                                                                     | Not reviewed                     | Configurable, enforced streaming | Not reviewed         |
| Selective revalidation      | `dependencies` and `revalidate: false`, compiler checked                                                                        | Loaders refresh after actions    | Not applicable                   | Cache tags and paths |
| Client code for a component | Zero Lit runtime: part descriptors, RPC stub, patch executor                                                                    | Lazy chunks plus a small loader  | Framework island or none         | React runtime        |

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

1. **No optimistic updates (deferred).** React offers `useOptimistic`. The Qwik City and Astro action APIs reviewed for this comparison had no built-in equivalent, though those sources were not rechecked when this was written. Pending state is covered (`data-lit-pending` and `aria-busy` on the host, `isActionPending` on Lit elements), and a page can already show a provisional result itself, from the `lit-action-success` and `lit-action-error` events, with CSS on the pending attribute.

   Not built, on purpose. A sound version has to render a prediction without a client renderer and take it back on failure, and that is a larger surface than the benefit justifies while the closest competitors go without it:
   - The compiler would emit an identity map from a property to the parts that display it unchanged (a binding that is exactly `${this.count}`, never `${this.count * 2}`). Only those parts can be set honestly from a property value.
   - The prediction itself should come from the action, not be written twice. A body made only of assignments over literals, arguments and other properties could be compiled to a client predictor, and anything else would be refused with a diagnostic when `optimistic` is requested.
   - Rollback has to survive the action queue: a failure restores the authoritative state, then re-applies the predictions of actions still waiting.
2. **Replay protection is opt-in.** `replayGuard` makes snapshots single-use. On Cloudflare Workers `@lit-core/server-elements/cloudflare` provides a Durable Object guard tested in `workerd`; elsewhere it needs a shared store the deployment provides, and without a guard a snapshot can be replayed until it expires.
3. **State encryption is opt-in.** `encryptState` hides state from the page as Astro does for island props, but it is off by default, so state is readable until you enable it.
4. **Queued actions are never cancelled (deliberate).** Actions on one element run in order, and each one runs to completion: actions are mutations, so cancelling one could discard a submit the user meant. Search-as-you-type reads belong in loaders, not actions.
5. **Action requests carry the element's whole state.** Every JSON action sends all of the element's signed state, so request size grows with the data it holds: about 25 KB at 400 rows of 60 bytes, and the 64 KB default (`maxBodyBytes`) is reached at roughly 1,000. No-JavaScript forms avoid this, since they carry a ticket and rebuild state from loaders. The JSON path cannot do the same, because state an action accumulates (a counter with no database behind it) exists only in the snapshot. Sending only what an action needs would take a compiler analysis of what each action reads and a render that tolerates absent properties, and `render()` reads most of the state to compute patches. Until there is a design that holds up, the guidance is to keep large collections in loaders and storage rather than reactive properties, and raise `maxBodyBytes` where that is not possible.
