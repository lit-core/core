import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const wasmPath = fileURLToPath(new URL('../../../../rendering/ssr/wasm/ssr_bg.wasm', import.meta.url));

const STATIC_COMPONENT = `
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { loader } from '@lit-core/server-elements';

export class StaticCard extends LitElement {
  @state() title = '';
  @loader()
  async load() { this.title = 'hello'; }
  render() { return html\`<h1>\${this.title}</h1><p>static body</p>\`; }
}
customElements.define('static-card', StaticCard);
`;

const STATIC_HTML_COMPONENT = `
import { LitElement } from 'lit';
import { html, unsafeStatic } from 'lit/static-html.js';
import { state } from 'lit/decorators.js';
import { loader } from '@lit-core/server-elements';

export class DynamicTag extends LitElement {
  @state() tag = 'b';
  @loader()
  async load() { this.tag = 'i'; }
  render() { return html\`<\${unsafeStatic(this.tag)}>dynamic</\${unsafeStatic(this.tag)}>\`; }
}
customElements.define('dynamic-tag', DynamicTag);
`;

async function workerBuild(source: string) {
  const result = await build({
    logLevel: 'silent',
    configFile: false,
    build: { write: false, minify: false, ssr: true, rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
    plugins: [
      { name: 'virtual-entry', resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined), load: (id) => (id === '\0entry.ts' ? source : undefined) },
      serverElements({ target: 'worker' }),
    ],
  });
  const output = (Array.isArray(result) ? result[0] : (result as any)).output as Array<{ type: string; fileName: string; code?: string }>;
  return { files: output.map((o) => o.fileName), code: output.map((o) => o.code ?? '').join('\n') };
}

describe('WebAssembly cost of server rendering', () => {
  it('ships the optimized fallback binary at the documented size or smaller', () => {
    const bytes = fs.statSync(wasmPath).size;
    expect(bytes).toBeGreaterThan(100_000);
    expect(bytes).toBeLessThanOrEqual(527_306);
  });

  it('emits no .wasm asset and no wasm glue for a worker whose templates are all precompiled', async () => {
    const { files, code } = await workerBuild(STATIC_COMPONENT);

    expect(files.filter((f) => f.endsWith('.wasm'))).toEqual([]);
    expect(code).not.toMatch(/ssr_bg|WebAssembly\.instantiate|wasm-bindgen/);
  });

  it('keeps the lazy wasm fallback reachable for runtime lit/static-html.js templates', async () => {
    const { files, code } = await workerBuild(STATIC_HTML_COMPONENT);

    expect(files.some((f) => f.endsWith('.wasm')) || /ssr_bg|WebAssembly/.test(code)).toBe(true);
  });
});
