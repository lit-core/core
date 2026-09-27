# Shadow DOM scoping and safety audit

`@lit-core/css-fuse` includes rigorous AST scoping checks to ensure that extracted CSS declarations preserve complete style isolation and avoid unintended cascading side effects.

---

## Safety audit checks

### 1. Specificity preservation
When declaration blocks are extracted into shared constructable stylesheets, selectors must remain unchanged:
- Selectors are never mangled, shortened, or combined across conflicting pseudo-classes.
- `:host`, `:host(...)`, `:host-context(...)`, `::slotted(...)`, and custom sub-element selectors retain their exact AST specificity weight.

### 2. Ordering and precedence invariants
Because CSS rules depend on source order when specificity is equal, shared constructable stylesheets must always be prepended before local component rules:
```javascript
// Correct cascade ordering
static styles = [sharedConstructableSheet, localComponentOverrides];
```
This guarantees that any local declarations override shared definitions if an identical selector is used.

### 3. Chunk boundary alignment
To prevent lazy-loaded component styles from leaking into entry chunks or causing circular chunk dependencies, `css-fuse` works in tandem with `@lit-core/vite-plugin` and Rollup:
- Virtual modules are scoped to the smallest common ancestor chunk in the module graph.
- Code-split routes only import shared sheets required by the components within that route.

### 4. Net savings threshold
Shared constructable sheets introduce a negligible virtual import overhead (~60 bytes per import). To avoid creating shared sheets that save fewer bytes than the import overhead, `css-fuse` evaluates net savings:
- Declaration blocks are only extracted when total bytes saved exceeds the import and registration overhead.

---

## Related documentation

- [CSS deduplication architecture](architecture.md)
- [HMR and chunk boundary handling](../../vite-plugin/docs/hmr.md)
- [Benchmark methodology](../../benchmarks/docs/methodology.md)
