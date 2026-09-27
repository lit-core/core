# `@lit-core/memoize`

> Ahead-of-time reactive expression auto-memoization compiler pass and bundler optimization for Lit and Web Components.

`@lit-core/memoize` is an ahead-of-time AST optimization pass powered by OXC that analyzes JavaScript data flow inside Lit `render()` methods and automatically wraps pure array transformations (`.map()`, `.filter()`, `.sort()`, `.slice()`, `.reduce()`, `.flatMap()`) in property-guarded cache slots (`this.__memo_*`).

---

## Key benefits

- **Zero heap allocations on re-render**: Returns cached array and `TemplateResult` references when input properties are unchanged.
- **Microtask reconciliation skipping**: Allows Lit's `Object.is()` check to skip child subtree diffing in 0 ms.
- **Automatic dependency tracking**: Inspects accessed reactive properties on `this` without manual dependency array declarations.
- **Strict purity guarantees**: Rejects mutating array methods, external non-deterministic globals, and impure calls.

---

## How it works

1. **AST data-flow analysis**:
   - Inspects classes extending `LitElement` or decorated with `@customElement`.
   - Traverses statements and expressions inside `render()`.
   - Identifies candidate pure array transformation call chains and inline template expressions.
2. **Component dependency extraction**:
   - Extracts all reactive properties on `this` referenced in the transformation pipeline (`this.items`, `this.filterText`, `this.limit`, etc.).
3. **Purity and mutation safety**:
   - Verifies that expressions and callbacks do not invoke mutating methods (`.splice()`, `.reverse()`, `.push()`, etc.).
   - Rejects expressions accessing non-deterministic APIs or external globals (`Date.now()`, `Math.random()`, DOM queries).
   - Rejects arbitrary method invocations on `this`.
4. **Code rewriting**:
   - Synthesizes property-guarded memoization blocks on the component instance.
   - Substitutes memoized variable references into the template interpolation slots or variable declarations.

### Example transformation

#### Input source

```ts
export class FilteredList extends LitElement {
  render() {
    return html`
      <ul>
        ${this.items.filter(x => x.includes(this.filterText)).map(x => html`<li>${x}</li>`)}
      </ul>
    `;
  }
}
```

#### Transformed output

```ts
export class FilteredList extends LitElement {
  render() {
    let _memoized_items;
    if (this.__memo_items_ref === this.items && this.__memo_filterText_ref === this.filterText) {
      _memoized_items = this.__memo_items_val;
    } else {
      this.__memo_items_ref = this.items;
      this.__memo_filterText_ref = this.filterText;
      _memoized_items = this.__memo_items_val = this.items
        .filter(x => x.includes(this.filterText))
        .map(x => html`<li>${x}</li>`);
    }
    return html`
      <ul>
        ${_memoized_items}
      </ul>
    `;
  }
}
```

---

## Installation

```bash
pnpm add -D @lit-core/memoize
```

---

## Quick usage

### Vite plugin

```typescript
import { defineConfig } from 'vite';
import { lit } from '@lit-core/vite-plugin';

export default defineConfig({
  plugins: [
    lit({
      memoize: true,
    }),
  ],
});
```

### Webpack plugin

```javascript
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  plugins: [
    new LitCoreWebpackPlugin({
      memoize: true,
    }),
  ],
};
```

### Direct API

```ts
import { transformMemoize } from '@lit-core/memoize';

const result = transformMemoize(sourceCode, {
  filename: 'my-element.ts',
  sourcemap: true,
});

console.log(result.code);
console.log(`Memoized ${result.memoizedCount} expressions across ${result.componentsCount} components`);
```

---

## Related documentation

- [Ahead-of-time property dependency bitmasking (`dirty-mask`)](../dirty-mask/README.md)
- [Ahead-of-time template compilation (`html-aot`)](../html-aot/docs/template-compilation.md)
- [memoize benchmark report](../benchmarks/docs/memoize.md)
- [Monorepo benchmark overview](../benchmarks/README.md)
