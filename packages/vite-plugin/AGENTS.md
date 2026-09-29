# Agent guidelines for `@lit-core/vite-plugin`

`@lit-core/vite-plugin` is the official Vite and Rollup plugin integrating `cssFuse`, `propsLower`, and minifiers into the modern frontend build lifecycle.

---

## Writing style reminder
Use sentence case for all headings, options descriptions, comments, and documentation. Do not uppercase every word.

---

## Plugin lifecycle and responsibilities
1. **Virtual module resolution**:
   - Resolves virtual ID prefixes (`virtual:css-fuse/`) to virtual modules containing shared constructable stylesheet code.
2. **Transform pipeline**:
   - Executes AST extraction and lowering in Vite's `transform` hook.
   - Coordinates with `css-fuse` native bindings to extract styles across component modules.
3. **Rollup chunk scoping**:
   - Ensures virtual stylesheets are aligned with Rollup chunk boundaries to prevent shared styles from leaking across route boundaries or entry points.
4. **HMR handling**:
   - Updates virtual stylesheet contents on module updates without forcing full page reloads.
5. **Zero consumer runtime overhead**:
   - Automatically injects compiler-synthesized code (such as resumable microloaders and adapters) ahead of time into HTML entry points or bundle chunks.
   - Downstream consumers do not install, import, or manage runtime loaders manually.
   - Strictly prohibit naive path fallbacks (such as `/components/*`); resolve all chunk mappings dynamically through Vite / Rollup build manifests.


---

## Configuration guidelines
- Support both unified plugin invocation (`lit({ cssFuse: true, propsLower: true })`) and direct modular imports (`cssFuse()`, `propsLower()`).
- Always preserve TypeScript types and documentation comments in `options.ts`.
