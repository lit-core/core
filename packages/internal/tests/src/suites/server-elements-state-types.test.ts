import { propsLower, serverElements } from '@lit-core/vite-plugin';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const component = (field: string) => `
import { LitElement, html } from 'lit';
import { state } from 'lit/decorators.js';
import { action } from '@lit-core/server-elements';

export class StateTypes extends LitElement {
  ${field}

  @action()
  async save() {
    this.count = 1;
  }

  render() {
    return html\`<p>\${this.count}</p>\`;
  }
}
customElements.define('state-types', StateTypes);
`;

async function buildWith(field: string, target: 'client' | 'worker') {
  return build({
    logLevel: 'silent',
    configFile: false,
    build: { write: false, minify: false, ssr: target === 'worker', rollupOptions: { input: 'entry.ts', output: { format: 'es' } } },
    plugins: [
      {
        name: 'virtual-entry',
        resolveId: (id) => (id === 'entry.ts' ? '\0entry.ts' : undefined),
        load: (id) => (id === '\0entry.ts' ? component(`${field}\n  @state() count = 0;`) : undefined),
      },
      // The order real projects use: decorator lowering first, then the server elements plugin.
      propsLower(),
      serverElements({ target }),
    ],
  });
}

describe('state types that JSON cannot carry, through a real build', () => {
  for (const target of ['client', 'worker'] as const) {
    it(`rejects a Set-typed reactive property in the ${target} build, naming SE109 and the property`, async () => {
      await expect(buildWith('@state() tags: Set<string> = new Set();', target)).rejects.toThrow(/SE109[\s\S]*'tags'|'tags'[\s\S]*SE109/);
    });
  }

  it('rejects a Date-typed property too', async () => {
    await expect(buildWith('@state() at: Date = new Date(0);', 'worker')).rejects.toThrow(/SE109/);
  });

  it('builds the same element once the property holds plain data', async () => {
    await expect(buildWith('@state() tags: string[] = [];', 'worker')).resolves.toBeDefined();
  });
});
