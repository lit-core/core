# Agent guidelines for `@lit-core/benchmarks`

`@lit-core/benchmarks` provides empirical bundle size and deduplication measurements across major production Lit design systems.

---

## Writing style reminder
Always use sentence case for table headers, suite titles, metric names, and markdown documentation. Do not uppercase every word.

---

## Benchmark guidelines
1. **No repetitive reporting**:
   - Keep markdown reports concise and single-layered.
   - Do not print duplicate tables inside nested `<details>` accordions or repeat summary rows in callout text.
   - Separate summary metrics from deduplication diagnostics cleanly.
2. **Supported suites**:
   - `carbon`: `@carbon/web-components` (IBM Carbon Design System)
   - `spectrum`: `@spectrum-web-components` (Adobe Spectrum)
   - `webawesome`: `@awesome.me/webawesome`
   - `material`: `@material/web` (Google Material Design 3)
3. **Execution commands**:
   - All suites: `pnpm run benchmark`
   - Single suite: `node packages/benchmarks/src/index.js --suite=<name>`
   - Markdown output: `pnpm run benchmark:markdown`
