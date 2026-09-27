# Webpack plugin configuration reference

`@lit-core/webpack-plugin` integrates the `@lit-core` ahead-of-time compilation toolchain into Webpack 5 build pipelines.

---

## Installation

```bash
pnpm add -D @lit-core/webpack-plugin
```

---

## Webpack configuration

```javascript
// webpack.config.js
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
  entry: './src/index.js',
  plugins: [
    new LitCoreWebpackPlugin({
      cssFuse: true,
      propsLower: true,
      cssMinifier: true,
      htmlMinifier: true,
    }),
  ],
};
```

---

## Option parameters

- `cssFuse` (*boolean | object*, default: `true`): Enables cross-component CSS AST deduplication.
- `propsLower` (*boolean | object*, default: `true`): Enables AOT decorator lowering to static properties.
- `cssMinifier` (*boolean*, default: `true`): Native Rust CSS template literal minification.
- `htmlMinifier` (*boolean*, default: `true`): Native Rust HTML template literal minification.
- `elemProxy` (*boolean | object*, default: `false`): Enables deferred Custom Element proxy stubs.

---

## Related documentation

- [Vite plugin configuration](../../vite-plugin/docs/configuration.md)
- [CSS deduplication architecture](../../css-fuse/docs/architecture.md)
- [Empirical benchmark metrics](../../benchmarks/README.md)
