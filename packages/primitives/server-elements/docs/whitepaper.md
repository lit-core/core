# Lit server elements: ahead-of-time compiled Web Components on edge isolates

## Executive summary

Web Components with Shadow DOM represent the native browser primitive for encapsulation. However, deploying interactive Web Components at cloud edge isolates (such as Cloudflare Workers) has historically faced four trade-offs:
1. **Full client runtime download**: Traditional server rendering ships the full component implementation and Lit runtime to the client browser to enable hydration and event handling.
2. **Sequential streaming waterfalls**: Naive `HTMLRewriter` implementations pause the HTML tokenizer while awaiting asynchronous component data, causing head-of-line blocking.
3. **Marker payload bloat**: Legacy Lit SSR wraps dynamic bindings in comment markers (`<!--lit-part-->`), inflating network payloads and requiring expensive client `TreeWalker` passes.
4. **Stateful mutation overhead**: Interactive mutations require round-tripping monolithic component trees or bespoke JSON endpoints paired with manual DOM synchronization.

Lit server elements (`@lit-core/server-elements`) eliminate these bottlenecks through an ahead-of-time compiler and streaming runtime architecture:
- Standard Lit component authoring using `@loader()` and `@action()` decorators.
- Ahead-of-time Rust compiler splitting (`@lit-core/server-split`) that generates zero-Lit client stubs containing only part descriptors and an action RPC stub (measured bundle sizes live in [`docs/claims.md`](../../../../docs/claims.md)).
- Non-blocking progressive Declarative Shadow DOM streaming on Cloudflare `workerd`.
- Sound minimal-marker part addressing (0 comment markers for element-anchored bindings).
- Stateless HMAC-SHA256 state snapshots and surgical ndjson part-level patch streaming.

---

## Core architectural pillars

### 1. Ahead-of-time compiler splitting

Components authored with `@loader()` and `@action()` are compiled at build time by `@lit-core/server-split` using `oxc` `AstBuilder` (verified in [`server-elements-e2e.test.ts`](../../../internal/tests/src/suites/server-elements-e2e.test.ts) and [`s2-s3-pipeline-and-lifecycle.test.ts`](../../../internal/tests/probes/s2-s3-pipeline-and-lifecycle.test.ts)):
- **Server artifact**: Retains loader and action logic, database connections, and private credentials, with `virtual:lit-core/install-globals` imported ahead of component modules in the AST-generated worker entry.
- **Client stub**: Lowers `extends LitElement` to `extends HTMLElement`, completely pruning `@loader` and `@action` function bodies, server-only imports, `ssrPlan` descriptors, and Lit runtime dependencies.
- **Addressable part tables**: Emits static `__litParts` and property-to-part dependency bitmasks (`__litPartDeps`) enabling surgical patch target resolution.

### 2. Progressive Declarative Shadow DOM streaming on Cloudflare workerd

The edge runtime unifies `renderServerElement` and `transformServerElementsWithHtmlRewriter` on one server-element pipeline without head-of-line blocking (verified in real `workerd` in [`s2-s4-workerd-edge.test.ts`](../../../internal/tests/probes/s2-s4-workerd-edge.test.ts) and [`server-elements-workerd.test.ts`](../../../internal/tests/src/suites/server-elements-workerd.test.ts)):
- Multiple `@loader()` methods on the same page execute concurrently via pending async boundaries while assigning unique per-request host IDs (`data-lit-ssr="0"`, `"1"`, ...).
- Asynchronous loaders emit `<slot name="pending">` skeletons during the initial pass without pausing the `HTMLRewriter` tokenizer.
- When background loader promises settle, signed state attributes (`data-lit-state`, `data-lit-sig`, `data-lit-token`) and resolved Declarative Shadow DOM fragments flush at the stream tail before `</body>` and swap into place client-side.

### 3. Sound minimal-marker DOM part addressing

Template parts are classified at build time using `crates/lit-analysis` with `html5ever` (verified in [`dsd_soundness_property.test.ts`](../../../transforms/dom-paths/tests/dsd_soundness_property.test.ts) and [`s1-security-and-integrity.test.ts`](../../../internal/tests/probes/s1-security-and-integrity.test.ts)):
- **Element-anchored bindings**: Dynamic attributes and properties require 0 comment markers.
- **Sole-text-child bindings**: Elements with a single text binding require 0 comment markers.
- **Range-addressed bindings**: Adjacent text expressions that merge during HTML parsing use compact `<?start name="pN">...<?end>` markers.
- In Chromium, `<?start>` is parsed honestly as `Node.COMMENT_NODE`.

### 4. Stateless signed state and surgical ndjson patch streaming

Mutations execute via standard HTTP `POST /_lit/a/<actionHash>` (verified in [`s4-s8-edge-streaming-client-actions.test.ts`](../../../internal/tests/probes/s4-s8-edge-streaming-client-actions.test.ts) and [`s2-s3-pipeline-and-lifecycle.test.ts`](../../../internal/tests/probes/s2-s3-pipeline-and-lifecycle.test.ts)):
- The initial server response emits an HMAC-SHA256 signed snapshot (`data-lit-state`, `data-lit-sig`, `data-lit-token`) binding tag, build ID, sequence number, and state.
- Upon action execution, the server validates signatures, clones incoming state before hydration so in-place array/object mutations survive `@loader()` revalidation, compares properties structurally via `canonicalEqual`, runs `willUpdate(changedProperties)` prior to `render()`, and renders patch fragments with the worker's custom element registry and `resumable: false`:
  - Scalar part updates: `{p, v}`
  - Structural fragment swaps: `{p, f, h}`
  - Keyed list updates: `{p, k}` (inserting plain text via `textContent` and server-rendered fragments via explicit `{ html }` items; verified in [`s1-security-and-integrity.test.ts`](../../../internal/tests/probes/s1-security-and-integrity.test.ts))
- The compact client executor applies patches directly to the existing Shadow Root, preserving active `<input>` focus and text selection.

---

## Empirical head-to-head benchmark evaluation

The benchmark renders an e-commerce product layout (`/products/mechanical-keyboard-pro`). Bundle sizes come from real Vite production builds. Render timings come from Node.js with warm iterations, and marker counts come from headless Chromium. Nothing in this section is a Cloudflare Worker CPU measurement.

### Comparative results

The measured numbers live in one place, the generated table in [`docs/claims.md`](../../../../docs/claims.md), which is rewritten from `packages/internal/benchmarks/results/edge-head-to-head.json` and checked for exact equality by `claims-ledger.test.ts`. This document does not repeat them, so it cannot drift.

### Reading the benchmark honestly

1. **Client payload**: The server element client stub is compared with the same product page shipped as a full Lit client bundle (minified). The stub contains no Lit runtime.
2. **Naive baseline**: The "Naive baseline" column is a cost model built from this repository's renderer in in-order mode with hand-written markup. It is not a measured `HTMLRewriter` worker and is tracked as a known gap in the claims ledger.
3. **CPU time**: Server render time is measured in Node.js. No Cloudflare Worker CPU limit claim is made.
4. **Streaming**: Boundary arrival times come from the real `renderToStream` and `createAsyncBoundary` in Node.js. A separate workerd test proves the shell and pending slot flush before an async island resolves.

---

## Design system status

The worker build of `@lit-core/vite-plugin` compiles static `html` templates reachable from the worker module graph ahead of time, including templates inside `node_modules`, and wires the lazy WebAssembly (`wasm32-unknown-unknown`) `SsrTemplatePlan` compiler fallback for runtime `lit/static-html.js` templates so no native `.node` addon is needed at request time. Verified in real `workerd` with DOM-equality checks against Node.js in Chromium in [`s2-s4-workerd-edge.test.ts`](../../../internal/tests/probes/s2-s4-workerd-edge.test.ts) and [`server-elements-workerd.test.ts`](../../../internal/tests/src/suites/server-elements-workerd.test.ts): IBM Carbon `cds-button`, Material Web `md-filled-button`, Adobe Spectrum `sp-button`, and Web Awesome `wa-button`.

---

## Security architecture

1. **HMAC-SHA256 snapshots**: Every snapshot binds the tag, build id, snapshot sequence, state, public attributes, per-element token and expiry, using a length-prefixed payload (verified in [`crypto-binding.test.ts`](../tests/unit/crypto-binding.test.ts)). Verification recomputes exactly one payload. There are no fallback formats.
2. **Replay scope**: A snapshot is valid only at the sequence number it was issued with, and it expires after its TTL (verified in [`server-elements-workerd.test.ts`](../../../internal/tests/src/suites/server-elements-workerd.test.ts)). Replay of a snapshot at its own sequence number within the TTL is possible, because the protocol is stateless. Closing that window needs server-side state, which is out of scope.
3. **Fail-closed secrets**: A missing secret throws unless `devMode: true` is passed explicitly. The ambient `NODE_ENV` is never consulted (verified in [`crypto-binding.test.ts`](../tests/unit/crypto-binding.test.ts) and [`s1-security-and-integrity.test.ts`](../../../internal/tests/probes/s1-security-and-integrity.test.ts)).
4. **Branded raw HTML and text-safe patch execution**: Untrusted objects carrying `.html`, `.template`, or `.tagName` properties and plain string returns from `render()` are HTML-escaped, and plain text keyed list items are inserted via `textContent` rather than `innerHTML` (verified in [`s1-security-and-integrity.test.ts`](../../../internal/tests/probes/s1-security-and-integrity.test.ts)).
5. **CSRF protection**: Verifies `Origin` and `Sec-Fetch-Site` against incoming action requests (verified in [`server-elements-adversarial.test.ts`](../../../internal/tests/src/suites/server-elements-adversarial.test.ts)).
6. **Mass-assignment prevention**: Action input applies only to declared reactive properties using `Object.hasOwn()` (verified in [`server-elements-adversarial.test.ts`](../../../internal/tests/src/suites/server-elements-adversarial.test.ts)).
7. **Redacted error frames**: Unless `devMode: true`, 500 errors are sanitized to `{ e: "Internal server error", code: "INTERNAL_ERROR" }`.
8. **State is signed, not encrypted**: Anything loaded into server state is readable by whoever can read the page.
