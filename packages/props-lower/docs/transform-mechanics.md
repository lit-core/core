# Lit decorator lowering mechanics

`@lit-core/props-lower` is a high-speed ahead-of-time (AOT) compiler pass written in Rust with `oxc`. It transforms Lit TypeScript decorators and property declarations into standard static `properties` fields ahead of time.

---

## Why lower decorators ahead of time?

Modern Lit components traditionally use TypeScript experimental decorators:
```typescript
@customElement('my-element')
export class MyElement extends LitElement {
  @property({ type: String }) name = 'World';
  @state() count = 0;
  @query('.button') button!: HTMLButtonElement;
}
```

In standard builds, decorator syntax requires:
- Runtime decorator metadata polyfills (e.g. `tslib` or Babel helper functions).
- Runtime reflection overhead during class declaration evaluation.
- Additional bundle bytes for each decorated property wrapper.

---

## Transform mechanics

`@lit-core/props-lower` transforms decorated Lit classes into standard ES6 class definitions during compilation:

```typescript
// Transformed output
export class MyElement extends LitElement {
  static properties = {
    name: { type: String },
    count: { state: true },
  };

  get button() {
    return this.renderRoot?.querySelector('.button');
  }

  constructor() {
    super();
    this.name = 'World';
    this.count = 0;
  }
}
customElements.define('my-element', MyElement);
```

### Supported decorators

| Decorator | Lowering target | Benefit |
| :--- | :--- | :--- |
| `@customElement(tag)` | `customElements.define(tag, Class)` | Removes decorator wrapper function |
| `@property(opts)` | `static properties = { prop: opts }` | Eliminates runtime descriptor creation |
| `@state(opts)` | `static properties = { prop: { state: true, ...opts } }` | Native Lit static reactive declaration |
| `@query(selector)` | Getter delegating to `this.renderRoot?.querySelector` | Zero runtime decorator overhead |
| `@queryAll(selector)` | Getter delegating to `this.renderRoot?.querySelectorAll` | Zero runtime decorator overhead |

---

## Related documentation

- [Deferred custom element proxy architecture](../../elem-proxy/docs/proxy-architecture.md)
- [Vite plugin configuration](../../vite-plugin/docs/configuration.md)
- [Benchmark results](../../benchmarks/README.md)
