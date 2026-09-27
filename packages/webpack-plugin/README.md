# `@lit-core/webpack-plugin`

> Webpack 5 plugin integrating the `@lit-core` ahead-of-time compilation toolchain.

`@lit-core/webpack-plugin` integrates `@lit-core` optimizations—including CSS AST deduplication, HTML fragment clustering, and decorator lowering—into Webpack 5 compilation pipelines.

---

## Key benefits

- **Webpack 5 compilation lifecycle hook**: Runs native AST transforms before module emission.
- **Zero runtime overhead**: Emits standard constructable stylesheets and static Lit property mappings.
- **Native Rust acceleration**: Powered by `oxc` and `lightningcss` for high-speed builds.

---

## Installation

```bash
pnpm add -D @lit-core/webpack-plugin
```

---

## Quick usage

```javascript
// webpack.config.js
const { LitCoreWebpackPlugin } = require('@lit-core/webpack-plugin');

module.exports = {
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

## Detailed documentation

- [Plugin configuration guide](docs/configuration.md)
- [Vite plugin reference](../vite-plugin/docs/configuration.md)
- [Empirical benchmark results](../benchmarks/README.md)
