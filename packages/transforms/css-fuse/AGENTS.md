# Agent guidelines for `@lit-core/css-fuse`

`css-fuse` is the core native Rust engine for cross-component CSS AST deduplication and constructable stylesheet extraction.

---

## Writing style reminder
Remember to use sentence case for all documentation, table headers, and descriptions. Do not uppercase every word.

---

## Core architecture
- **Parser**: Uses `oxc` for JS/TS AST parsing and `lightningcss` for CSS normalization, rule parsing, and minification.
- **Extractor**:
  - Scans `TaggedTemplateExpression` matching `css` template tags and their local imports/aliases.
  - Scans `CallExpression` matching `css([...])` calls (e.g. SCSS outputs in Carbon Web Components).
- **Cluster engine**: Groups duplicate CSS rules across components, calculates rule frequencies, and builds shared constructable stylesheet modules.
- **Rewriter**: Rewrites component `static styles` arrays, prepending shared sheets before component local overrides while preserving cascade order.
- **Bindings**: Native Node.js bindings generated via NAPI-RS (`napi`, `napi-derive`).

---

## Critical rules and invariants
1. **Cascade preservation**:
   - Always prepend shared sheets before local overrides: `static styles = [shared_0, local_styles]`. Never append them after.
2. **Selector specificity**:
   - Never modify or simplify selectors in ways that alter specificity or break CSS cascade semantics in Shadow DOM.
3. **Property compatibility**:
   - Component styles may use `.styleSheet` accessor (e.g. `export default styles.styleSheet`). Rewritten expressions must remain compatible with Lit `CSSResult` or array expectations.
4. **Rebuilding native bindings**:
   - After editing Rust files in `src/`, run `cargo build --release` and copy or link the compiled artifact to `css-fuse.<arch>.node` before running JS tests.
