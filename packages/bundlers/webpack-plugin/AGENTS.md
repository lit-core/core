# Guidelines for @lit-core/webpack-plugin

This package implements the Webpack 5 integration for `@lit-core`.

---

## Architecture and design decisions

1. **Virtual module loading via Webpack schemes**:
   - Webpack 5 natively supports custom URI schemes via `NormalModule.getCompilationHooks(compilation).readResourceForScheme.for('virtual')`.
   - Never write intermediate virtual sheets to the filesystem unless explicitly requested by the user.

2. **Unified loader pipeline**:
   - All transformations (`cssFuse` rewritten files, `propsLower`, `cssMinifier`, `htmlMinifier`) are processed through a single internal loader (`litWebpackLoader`).
   - The plugin automatically prepends this loader into `compiler.options.module.rules`, eliminating manual loader configuration for end users.

3. **Zero consumer runtime overhead**:
   - Consumers only add `LitWebpackPlugin` to their Webpack configuration and write standard Lit components.
   - Never require consumers to install, import, or initialize runtime microloaders, client adapters, or orchestration scripts.
   - When optimizations like resumable SSR, proxy stubs, or event hoisting are active, all required glue, manifests, and inline scripts are synthesized ahead of time via `oxc` and injected automatically into compilation assets or HTML.
   - Strictly prohibit naive path fallbacks (such as assuming `/components/*`). Chunk URLs must be derived dynamically from Webpack compilation assets across any codebase.

4. **Writing style**:
   - Strictly follow sentence case for all headings, table headers, descriptions, and comments as defined in monorepo rules.

