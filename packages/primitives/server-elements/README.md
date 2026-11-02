# `@lit-core/server-elements`

Authoring primitives, decorators, and context types for Lit server elements.

## Overview

Lit server elements allow developers to author standard Lit Web Components with ahead-of-time compiled edge `@loader()` and `@action()` methods. These execute on Cloudflare Workers (WinterCG standard `Request` and `Response`), stream initial HTML as Declarative Shadow DOM, and handle interactive mutations through surgical part-level patch frames with zero client Lit runtime overhead.

## Installation

```bash
pnpm add @lit-core/server-elements
```

## Quick start

```ts
import { LitElement, html } from 'lit';
import { loader, action } from '@lit-core/server-elements';

export class ProductStock extends LitElement {
  static properties = {
    sku: { type: String },
    stock: { type: Number, state: true },
  };

  declare sku: string;
  declare stock: number;

  @loader()
  async load(env: Env) {
    this.stock = await env.DB.prepare('SELECT qty FROM inventory WHERE sku = ?').bind(this.sku).first('qty');
  }

  @action()
  async reserve(qty: number) {
    await this.env.DB.prepare('UPDATE inventory SET qty = qty - ? WHERE sku = ?').bind(qty, this.sku).run();
    this.stock -= qty;
  }

  render() {
    return html`
      <p>In stock: ${this.stock}</p>
      <button @click=${() => this.reserve(1)}>Reserve</button>
    `;
  }
}

customElements.define('product-stock', ProductStock);
```

## Compilation requirements

Methods decorated with `@loader()` and `@action()` are compiled ahead-of-time by `@lit-core/server-split` (integrated automatically via `@lit-core/vite-plugin` or `@lit-core/webpack-plugin`). Executing uncompiled server element files directly in a browser or raw Node.js environment throws `UncompiledServerElementError` to prevent server credentials and private logic from leaking to client environments.
