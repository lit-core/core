# @lit-core/webpack-plugin

> Official Webpack plugin for Lit and Web Components (@lit-core), featuring AOT constructable stylesheet deduplication (`css-fuse`), decorator lowering (`props-lower`), and template minification (`html-minifier`, `css-minifier`).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

`@lit-core/webpack-plugin` brings the `@lit-core` ahead-of-time compiler and optimization toolchain to Webpack applications and design systems.

It unifies cross-component CSS deduplication (`css-fuse`), decorator and property lowering (`props-lower`), and high-speed native template minification (`html-minifier`, `css-minifier`) into a single, zero-configuration Webpack plugin.

### Key capabilities

- **Zero-config loader injection**: Automatically registers the internal transformation loader into Webpack's module rules without requiring manual `module.rules` configuration.
- **In-memory virtual stylesheets**: Leverages Webpack 5's native URI scheme resolution (`readResourceForScheme`) to serve shared constructable sheets in memory without disk pollution.
- **Strict cascade and specificity preservation**: Automatically prepends shared stylesheets before local component overrides in `static styles = [sharedSheet, localStyles]`.
- **Chunk boundary isolation**: Components only import the constructable sheets they participate in, preventing lazy route styles from leaking into entry chunks.
- **Composable optimization pipeline**: Run all optimizations together or pick individual standalone plugins (`cssFuse`, `propsLower`, `cssMinifier`, `htmlMinifier`).
- **Ergonomic usage**: Supports `new LitWebpackPlugin(options)`, `lit(options)`, and spread operator `...lit(options)`.

---

## Installation

```bash
# Using pnpm
pnpm add -D @lit-core/webpack-plugin webpack

# Using npm
npm install --save-dev @lit-core/webpack-plugin webpack
```

---

## Quick start

Add the plugin to your `webpack.config.js` or `webpack.config.mjs`:

```javascript
import { LitWebpackPlugin } from '@lit-core/webpack-plugin';

export default {
  entry: './src/index.ts',
  plugins: [
    new LitWebpackPlugin({
      // CSS AST deduplication (enabled by default)
      cssFuse: true,
      // AOT Lit decorator and property lowering
      propsLower: true,
      // Embedded CSS template minification
      cssMinifier: true,
      // HTML and SVG template minification
      htmlMinifier: true,
    }),
  ],
};
```

You can also use the functional helper `lit()`:

```javascript
import lit from '@lit-core/webpack-plugin';

export default {
  plugins: [
    lit({
      cssFuse: {
        include: ['src/components/**/*.ts'],
        threshold: 2,
      },
      propsLower: true,
      htmlMinifier: true,
      cssMinifier: true,
    }),
  ],
};
```

---

## Standalone plugins

If you only want specific optimizations, import them independently:

```javascript
import { cssFuse, propsLower, cssMinifier, htmlMinifier } from '@lit-core/webpack-plugin';

export default {
  plugins: [
    // Deduplicate shared component CSS rules
    cssFuse({ threshold: 2 }),
    // Lower @property() and @customElement decorators ahead of time
    propsLower(),
    // Minify embedded css template literals
    cssMinifier(),
    // Minify html template literals and collapse whitespace
    htmlMinifier(),
  ],
};
```

---

## Configuration options

### `LitPluginOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cssFuse` | `boolean \| CssFuseOptions` | `true` | Cross-component CSS deduplication and constructable stylesheet sharing |
| `propsLower` | `boolean \| PropsLowerOptions` | `false` | AOT AST lowering for Lit decorators and properties via OXC |
| `cssMinifier` | `boolean \| CssMinifierOptions` | `false` | Embedded CSS template minification via Lightning CSS |
| `htmlMinifier` | `boolean \| HtmlMinifierOptions` | `false` | Embedded HTML & SVG template minification via OXC |

### `CssFuseOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `include` | `string[]` | `['packages/components/**/src/**/*.ts', 'src/**/*.ts']` | Glob patterns for component source files to scan |
| `exclude` | `string[]` | `['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**']` | Glob patterns to exclude from scanning |
| `threshold` | `number` | `2` | Minimum number of components sharing a rule to trigger extraction |
| `outputDir` | `string` | `'.fused'` | Output directory for fused sheets |
| `scopingAudit` | `boolean` | `true` | Enable Shadow DOM scoping diagnostics |
| `applyInDev` | `boolean` | `false` | Apply deduplication during development mode |

### `PropsLowerOptions` / `CssMinifierOptions` / `HtmlMinifierOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `include` | `(string \| RegExp)[]` | `[/\.[jt]sx?$/]` | File patterns to include |
| `exclude` | `(string \| RegExp)[]` | `[/node_modules/]` | File patterns to exclude |
| `sourcemap` | `boolean` | `true` (`false` for html) | Generate sourcemaps for transformed code |

---

## How it works

1. **AST extraction and clustering**: Before compilation starts, `cssFuse` scans component stylesheets, normalizes rules with `lightningcss`, and clusters shared declaration blocks using a frequency index.
2. **Virtual module resolution**: Shared declaration blocks are exposed as virtual modules (`virtual:css-fuse/_fused_<hash>.js`) exporting shared `CSSStyleSheet` instances. Webpack 5's `readResourceForScheme` loads them completely in memory.
3. **Automatic source rewriting**: The internal loader rewrites component definitions to prepend shared constructable sheets to `static styles`, strips redundant CSS from component bodies, and applies decorator lowering and template minification in a single pass.
4. **Chunk isolation**: Webpack packages shared sheets strictly within the chunks that consume them, ensuring lazy routes do not pollute the initial bundle.

---

## License

MIT
