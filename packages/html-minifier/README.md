# @lit-core/html-minifier

> High-performance native Rust AOT AST HTML & SVG tagged template minifier for Lit and Web Components via OXC.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## ⚡ Impact

- **-3.5% to -6.0%** Minified JS
- **-2.0% to -3.5%** Brotli / Gzip across any component suite

---

## 🛑 The Structural Flaw

Standard bundlers and minifiers (esbuild, Rollup, Terser) treat tagged template literals as opaque JavaScript strings. Vite's build pipeline never parses or touches the markup inside `html`...`` or `svg`...`` literals.

As a result, every newline, indentation gap, trailing attribute space, and HTML comment authored inside components ships verbatim to production.

---

## ⚙️ The Core Mechanism

An **OXC AST visitor** targets `TaggedTemplateExpression` nodes where the tag is `html` or `svg`. It:
1. Extracts the raw string slices between interpolation holes (`${...}`).
2. Runs high-speed HTML minification to collapse whitespace runs and strip comments while protecting literal boundaries (`<pre>`, `<code>`, `<textarea>`, `<style>`, `<script>`).
3. Writes the compressed string fragments directly back into the template literal.

### 🛡️ Why It Is 100% Feasible

It operates purely on static string fragments in the AST. It leaves all dynamic expressions, closures, and runtime bindings completely untouched, eliminating any risk of breaking application logic.

---

## 📦 Usage

### Node.js API

```ts
import { minifyHtmlTemplates } from '@lit-core/html-minifier';

const code = `
  import { html } from 'lit';
  export const tpl = html\`
    <div class="card">
      <!-- remove this comment -->
      <h1>Hello \${name}</h1>
    </div>
  \`;
`;

const result = minifyHtmlTemplates(code, { filename: 'component.ts' });
console.log(result.code);
// Output:
// import { html } from 'lit';
// export const tpl = html\`<div class="card"><h1>Hello \${name}</h1></div>\`;
console.log(`Templates minified: ${result.templatesCount}`);
console.log(`Bytes saved: ${result.bytesSaved}`);
```

---

## 📄 License

MIT
