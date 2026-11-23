import { html, LitElement } from 'lit';
import { beforeAll, describe, expect, it } from 'vitest';
import { installIsolateGlobals, renderToStream, renderToString, renderToStringAsync } from '../src/index.js';

/** Own property names and descriptors of an object, as comparable plain data. */
function snapshot(target: object): Map<PropertyKey, string> {
  const out = new Map<PropertyKey, string>();
  for (const key of Reflect.ownKeys(target)) {
    const d = Object.getOwnPropertyDescriptor(target, key);
    out.set(key, d ? `${'value' in d ? typeof d.value : 'accessor'}|${d.enumerable}|${d.configurable}|${d.writable}` : 'missing');
  }
  return out;
}

function diff(before: Map<PropertyKey, string>, after: Map<PropertyKey, string>): string[] {
  const changes: string[] = [];
  for (const [key, shape] of after) {
    if (!before.has(key)) changes.push(`added ${String(key)}`);
    else if (before.get(key) !== shape) changes.push(`changed ${String(key)}`);
  }
  for (const key of before.keys()) if (!after.has(key)) changes.push(`removed ${String(key)}`);
  return changes;
}

class IsolatedGreeting extends LitElement {
  static properties = { name: { type: String, reflect: true } };
  declare name: string;
  constructor() {
    super();
    this.name = 'world';
  }
  render() {
    return html`<p>Hello ${this.name}</p>`;
  }
}
customElements.get('isolated-greeting') ?? customElements.define('isolated-greeting', IsolatedGreeting);

const template = html`<section><isolated-greeting name="edge"></isolated-greeting></section>`;

describe('per-render isolation', () => {
  beforeAll(() => {
    installIsolateGlobals();
  });

  it('renderToString does not add, remove or reshape any global', () => {
    const before = snapshot(globalThis);
    const output = renderToString(template);
    expect(output).toContain('<template shadowrootmode="open">');
    expect(output).toContain('edge');
    expect(diff(before, snapshot(globalThis))).toEqual([]);
  });

  it('renderToStringAsync does not touch globals', async () => {
    const before = snapshot(globalThis);
    await renderToStringAsync(template);
    expect(diff(before, snapshot(globalThis))).toEqual([]);
  });

  it('renderToStream does not touch globals while streaming', async () => {
    const before = snapshot(globalThis);
    const reader = renderToStream(template).getReader();
    while (!(await reader.read()).done) {}
    expect(diff(before, snapshot(globalThis))).toEqual([]);
  });

  it('does not mutate the ReactiveElement prototype chain', () => {
    const protos: object[] = [];
    for (let p = Object.getPrototypeOf(IsolatedGreeting.prototype); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) protos.push(p);
    const before = protos.map(snapshot);
    renderToString(template);
    for (const [i, proto] of protos.entries()) {
      expect(diff(before[i], snapshot(proto))).toEqual([]);
    }
  });

  it('leaves no cross-render state: rendering twice is identical', () => {
    expect(renderToString(template)).toBe(renderToString(template));
  });
});
