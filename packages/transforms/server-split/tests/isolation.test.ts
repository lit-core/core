import { describe, expect, it } from 'vitest';
import { splitServerElement } from '../src/index.js';

describe('security isolation and reactive tracking (SE101, SE103, SE104)', () => {
  it('detects node builtin leak into render() with SE101 error', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';
      import { readFileSync } from 'fs';

      export class SecretReader extends LitElement {
        static properties = { text: { type: String } };

        @loader()
        async load() {
          this.text = readFileSync('safe.txt', 'utf-8');
        }

        render() {
          return html\`<div>\${readFileSync('leaked.txt', 'utf-8')}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se101 = res.diagnostics.find((d) => d.code === 'SE101');
    expect(se101).toBeDefined();
    expect(se101?.message).toContain("resolves to server-only binding from 'fs'");
    expect(se101?.message).toContain('accessed within render()');
  });

  it('detects server-only package leak into render() with SE101 error', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';
      import { connectDb } from '@internal/db.server';

      export class DatabaseView extends LitElement {
        static properties = { status: { type: String } };

        @loader()
        async init() {
          const db = connectDb();
          this.status = 'connected';
        }

        render() {
          connectDb();
          return html\`<div>\${this.status}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se101 = res.diagnostics.find((d) => d.code === 'SE101');
    expect(se101).toBeDefined();
    expect(se101?.message).toContain("resolves to server-only binding from '@internal/db.server'");
  });

  it('detects direct loader call inside render() with SE104 error', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';

      export class DirectCallComponent extends LitElement {
        static properties = { title: { type: String } };

        @loader()
        async fetchTitle(id: string) {
          this.title = id;
        }

        render() {
          this.fetchTitle('123');
          return html\`<h1>\${this.title}</h1>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se104 = res.diagnostics.find((d) => d.code === 'SE104');
    expect(se104).toBeDefined();
    expect(se104?.message).toContain("render() method attempts to invoke @loader() method 'fetchTitle' directly");
  });

  it('warns when loader or action modifies undeclared property with SE103 warning', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader, action } from '@lit-core/server-elements';

      export class UndeclaredPropComponent extends LitElement {
        // missing declared property

        @loader()
        async load() {
          this.missingLoaderProp = 'val';
        }

        @action()
        async act(arg: string) {
          this.missingActionProp = arg;
        }

        render() {
          return html\`<div>Done</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    const se103Warnings = res.diagnostics.filter((d) => d.code === 'SE103');
    expect(se103Warnings).toHaveLength(2);
    expect(se103Warnings[0].severity).toBe('warning');
    expect(se103Warnings[1].severity).toBe('warning');
  });

  it('detects server-only re-exports and prunes them from client artifact', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';
      import { readFileSync } from 'node:fs';

      export * from 'node:fs';
      export { readFileSync } from 'node:fs';
      export { readFileSync as myRead };

      export class ReExportComp extends LitElement {
        @loader()
        async load() {
          this.data = readFileSync('file.txt', 'utf-8');
        }
        render() {
          return html\`<div>Clean</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);

    const se101s = res.diagnostics.filter((d) => d.code === 'SE101');
    expect(se101s.length).toBeGreaterThanOrEqual(2);

    // Pruned from client code
    expect(res.clientCode).not.toContain('node:fs');
    expect(res.clientCode).not.toContain('myRead');
  });

  it('detects destructured loader parameters leaked into render()', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';

      export class DestructuredComp extends LitElement {
        @loader()
        async load({ env, auth }: { env: any, auth: any }) {
          console.log(env, auth);
        }
        render() {
          return html\`<div>\${env.SECRET}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se101 = res.diagnostics.find((d) => d.code === 'SE101');
    expect(se101).toBeDefined();
    expect(se101?.message).toContain("resolves to server-only binding from '@loader() parameter'");
  });

  it('allows safe local variables that shadow server names', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { loader } from '@lit-core/server-elements';
      import { env } from 'node:process';

      export class ShadowingComp extends LitElement {
        @loader()
        async load() {
          console.log(env);
        }
        render() {
          const env = 'client-safe-env';
          return html\`<div>\${env}</div>\`;
        }
      }
    `;

    const res = splitServerElement(code);
    const se101InRender = res.diagnostics.filter((d) => d.code === 'SE101' && d.message.includes('accessed within render()'));
    expect(se101InRender).toHaveLength(0);
  });
});
