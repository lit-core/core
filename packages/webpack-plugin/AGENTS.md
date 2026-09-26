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

3. **Writing style**:
   - Strictly follow sentence case for all headings, table headers, descriptions, and comments as defined in monorepo rules.
