import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Benchmark suite testing Lit elements authored with modern TypeScript decorators:
 * @customElement, @property, @state, @query, @eventOptions
 * Demonstrates the combined power of propsLower (stripping decorator overhead) + cssFuse (CSS deduplication).
 * @type {import('../types.js').BenchmarkSuite}
 */
export const litDecoratorsSuite = {
  id: 'lit-decorators',
  name: 'Lit Elements with TypeScript Decorators (10 Elements)',
  description: '10 Lit components using @customElement, @property, @state, @query and shared styles',

  isAvailable() {
    return true;
  },

  async setup() {
    const fixtureDir = path.join(__dirname, '.temp-decorators-suite');
    if (!fs.existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true });
    }

    const componentNames = [
      'button',
      'card',
      'dialog',
      'input',
      'badge',
      'toggle',
      'tooltip',
      'menu',
      'nav-bar',
      'avatar',
    ];

    const entryImports = [];

    for (const name of componentNames) {
      const compPath = path.join(fixtureDir, `${name}.ts`);
      const compCode = `
import { LitElement, html, css } from 'lit';
import { customElement, property, state, query, eventOptions } from 'lit/decorators.js';

@customElement('elem-${name}')
export class Elem${name.replace(/-/g, '')} extends LitElement {
  @property({ type: String }) titleText = '${name} component';
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: Number }) count = 0;
  @state() private internalState = 'initial';
  @query('.target') targetEl!: HTMLElement;

  static styles = css\`
    :host {
      display: inline-block;
      box-sizing: border-box;
      font-family: system-ui, sans-serif;
    }
    :host *, :host *::before, :host *::after {
      box-sizing: border-box;
    }
    :host([active]) {
      border-color: #2563eb;
    }
    .base {
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      border: 1px solid #e2e8f0;
      color: #0f172a;
      transition: all 150ms ease;
    }
    .base:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
  \`;

  @eventOptions({ passive: true })
  handleClick(e: MouseEvent) {
    this.count++;
  }

  render() {
    return html\`<div class="base target" @click="\${this.handleClick}">\${this.titleText} (\${this.count})</div>\`;
  }
}
`;
      fs.writeFileSync(compPath, compCode);
      entryImports.push(`import './${name}.ts';`);
    }

    const entryPath = path.join(fixtureDir, 'entry.ts');
    fs.writeFileSync(entryPath, entryImports.join('\n'));

    return {
      id: 'lit-decorators',
      name: 'Lit Elements with TypeScript Decorators (10 Elements)',
      entryPath,
      includePattern: path.join(fixtureDir, '*.ts'),
      componentCount: componentNames.length,
      metadata: { fixtureDir },
    };
  },

  async cleanup() {
    const fixtureDir = path.join(__dirname, '.temp-decorators-suite');
    if (fs.existsSync(fixtureDir)) {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  },
};
