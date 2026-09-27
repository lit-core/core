# Hot Module Replacement (HMR) and chunk scoping

How `@lit-core/vite-plugin` coordinates Hot Module Replacement (HMR) and chunk boundaries for virtual constructable stylesheets.

---

## Chunk boundary scoping

When building multi-page or code-split single-page applications, components are bundled into distinct Rollup output chunks:
- If a shared constructable stylesheet module (`virtual:css-fuse/*`) were placed in a common vendor chunk, it might pull styles from lazy-loaded routes into initial entry bundles.
- To prevent chunk leaking, `@lit-core/vite-plugin` analyzes the Rollup module graph during `renderChunk`. Shared constructable stylesheets are scoped strictly to the smallest common ancestor chunk of the components that reference them.

---

## Hot Module Replacement (HMR) workflow

During development (`vite dev`), editing a component stylesheet updates only the relevant constructable stylesheet in browser memory:

1. **Vite watcher triggers update**:
   The developer saves a change in `my-element.ts` inside a `css\`...\`` literal.
2. **Delta extraction**:
   `css-fuse` determines whether the modified rule is unique to this component or shared across components.
3. **Targeted sheet replacement**:
   If the edited rule is local, only the component's local stylesheet is replaced in browser memory via `CSSStyleSheet.prototype.replaceSync()`.
4. **Zero full-page reloads**:
   The component and its shadow roots re-render immediately without unmounting DOM elements or losing local component state.

---

## Related documentation

- [Vite plugin configuration](configuration.md)
- [CSS deduplication scoping audit](../../css-fuse/docs/scoping-audit.md)
