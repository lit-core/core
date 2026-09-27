# Static HTML and SVG fragment clustering

`@lit-core/html-fuse` is an ahead-of-time (AOT) AST deduplication engine for Lit HTML and SVG templates, clustering repeated static subtrees into shared template constants.

---

## The repeated markup problem

Across design systems, components repeatedly declare identical static HTML and SVG fragments:
- Common SVG icons (carets, chevrons, close icons, search icons, indicators).
- Focus rings, slot wrapper containers, badge indicators, and helper text wrappers.

In standard Lit applications, each component compiles its own template literal instance. The browser must parse `innerHTML` for each distinct template descriptor, consuming main-thread CPU time and increasing memory usage.

---

## Fragment clustering mechanism

`@lit-core/html-fuse` analyzes templates during build time:

1. **AST subtree extraction**:
   Parses `html\`...\`` and `svg\`...\`` tagged template literals using `oxc`. Traverses HTML/SVG syntax trees to isolate static subtrees devoid of dynamic interpolation expressions.

2. **Structural canonicalization**:
   Normalizes element attribute ordering and whitespace within static subtrees. Computes structural hash fingerprints for candidate subtrees exceeding the minimum length threshold (default: 15 characters).

3. **Cluster creation**:
   Extracts subtrees that appear across multiple components into shared virtual template modules:
   ```javascript
   // Virtual module: virtual:html-fuse/icon-caret
   import { html } from 'lit';
   export const _tpl_caret = html`<svg class="caret" viewBox="0 0 16 16"><path d="..."/></svg>`;
   ```

4. **Lit template caching benefit**:
   Because `lit-html` caches template results using the unique identity of the underlying `TemplateStringsArray`, sharing template constants allows the browser to parse `innerHTML` once and reuse the cached template across all components.

---

## Related documentation

- [Ahead-of-time template compilation (`html-aot`)](../../html-aot/docs/template-compilation.md)
- [HTML template minification (`html-minifier`)](../../html-minifier/README.md)
- [Benchmark diagnostics](../../benchmarks/docs/metrics.md)
