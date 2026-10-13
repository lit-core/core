import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse as cssFuse } from '../src/index.js';
import { fuse as htmlFuse } from '../../html-fuse/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, '.challenger-empirical-suite');

fs.mkdirSync(testDir, { recursive: true });

try {
  console.log('--- STARTING EMPIRICAL CHALLENGER SUITE ---');

  // ==========================================
  // PART 1: CSS-FUSE ARRAY STYLES PRESERVATION
  // ==========================================
  console.log('Testing CSS-FUSE Array Styles Preservation...');

  // Scenario 1: Preserving non-css array elements alongside shared cluster
  {
    const compA = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';
      import { theme } from './theme.js';

      export class CompA extends LitElement {
        static styles = [
          baseReset,
          theme,
          css\`:host { display: flex; color: red; }\`
        ];
      }
    `;

    const compB = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';
      import { theme } from './theme.js';

      export class CompB extends LitElement {
        static styles = [
          baseReset,
          theme,
          css\`:host { display: flex; color: blue; }\`
        ];
      }
    `;

    const f1 = path.join(testDir, 'arr-compA.ts');
    const f2 = path.join(testDir, 'arr-compB.ts');
    fs.writeFileSync(f1, compA);
    fs.writeFileSync(f2, compB);

    const res = cssFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files should be rewritten');
    assert(res.fusedSheets.length >= 1, 'At least 1 shared sheet created for :host { display: flex; }');

    for (const rw of res.rewrittenFiles) {
      console.log('Transformed Comp:\n', rw.transformedCode);
      assert(rw.transformedCode.includes('baseReset'), 'baseReset must be retained in static styles array');
      assert(rw.transformedCode.includes('theme'), 'theme must be retained in static styles array');
      assert(rw.transformedCode.includes('_fused_'), 'Fused sheet must be prepended');
    }
    console.log('✔ Scenario 1 Passed: non-css elements preserved in static styles array');
  }

  // Scenario 2: Multiple CSS templates in single array
  {
    const multiA = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';

      export class MultiA extends LitElement {
        static styles = [
          baseReset,
          css\`:host { margin: 0; padding: 0; }\`,
          css\`:host { color: green; }\`
        ];
      }
    `;

    const multiB = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';

      export class MultiB extends LitElement {
        static styles = [
          baseReset,
          css\`:host { margin: 0; padding: 0; }\`,
          css\`:host { color: green; }\`
        ];
      }
    `;

    const f1 = path.join(testDir, 'multi-compA.ts');
    const f2 = path.join(testDir, 'multi-compB.ts');
    fs.writeFileSync(f1, multiA);
    fs.writeFileSync(f2, multiB);

    const res = cssFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2);

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('baseReset'), 'baseReset must be retained in multi-css array');
      assert(rw.transformedCode.includes('_fused_'), 'Fused sheet must be prepended');
    }
    console.log('✔ Scenario 2 Passed: multiple css templates in array properly handled');
  }

  // Scenario 3: Static getter styles array
  {
    const getA = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';

      export class GetA extends LitElement {
        static get styles() {
          return [baseReset, css\`:host { box-sizing: border-box; }\`];
        }
      }
    `;

    const getB = `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';

      export class GetB extends LitElement {
        static get styles() {
          return [baseReset, css\`:host { box-sizing: border-box; }\`];
        }
      }
    `;

    const f1 = path.join(testDir, 'get-compA.ts');
    const f2 = path.join(testDir, 'get-compB.ts');
    fs.writeFileSync(f1, getA);
    fs.writeFileSync(f2, getB);

    const res = cssFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2);

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('static get styles()'), 'Getter signature preserved');
      assert(rw.transformedCode.includes('baseReset'), 'baseReset preserved in getter return array');
      assert(rw.transformedCode.includes('_fused_'), 'Fused sheet prepended in getter return array');
    }
    console.log('✔ Scenario 3 Passed: getter styles array preserves non-css elements');
  }

  // ==========================================
  // PART 2: HTML-FUSE NAMESPACE, ISOLATION, SCOPING
  // ==========================================
  console.log('\nTesting HTML-FUSE Namespace, Isolation, and Lexical Scoping...');

  // Scenario 4: Lit.html under namespace import
  {
    const nsA = `
      import * as Lit from 'lit';
      export class NsCompA extends Lit.LitElement {
        render() {
          return Lit.html\`
            <div class="ns-header">
              <svg viewBox="0 0 12 12"><path d="M0 0 L12 12"/></svg>
              <span>\${this.title}</span>
            </div>
          \`;
        }
      }
    `;

    const nsB = `
      import * as Lit from 'lit';
      export class NsCompB extends Lit.LitElement {
        render() {
          return Lit.html\`
            <div class="ns-footer">
              <svg viewBox="0 0 12 12"><path d="M0 0 L12 12"/></svg>
              <span>\${this.footer}</span>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'ns-compA.ts');
    const f2 = path.join(testDir, 'ns-compB.ts');
    fs.writeFileSync(f1, nsA);
    fs.writeFileSync(f2, nsB);

    const res = htmlFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 1, 'Lit.html shared SVG must produce 1 fused template');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files using Lit.html namespace must be rewritten');

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('virtual:html-fuse/'), 'Virtual import must be added');
      assert(!rw.transformedCode.includes('<path d="M0 0 L12 12"/>'), 'Raw SVG replaced by cluster reference');
    }
    console.log('✔ Scenario 4 Passed: Lit.html namespace correctly extracted and rewritten');
  }

  // Scenario 5: Isolation of foreign namespace calls (Other.html)
  {
    const foreignA = `
      import { html } from 'lit';
      import * as Other from 'other-lib';

      export class ForeignA {
        render() {
          return Other.html\`
            <div class="foreign">
              <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>
            </div>
          \`;
        }
      }
    `;

    const foreignB = `
      import { html } from 'lit';
      import * as Other from 'other-lib';

      export class ForeignB {
        render() {
          return Other.html\`
            <div class="foreign">
              <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'foreign-compA.ts');
    const f2 = path.join(testDir, 'foreign-compB.ts');
    fs.writeFileSync(f1, foreignA);
    fs.writeFileSync(f2, foreignB);

    const res = htmlFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 0, 'Other.html must NEVER create fused templates');
    assert.strictEqual(res.rewrittenFiles.length, 0, 'Other.html must NEVER cause file rewrites');
    console.log('✔ Scenario 5 Passed: Other.html foreign namespace strictly isolated');
  }

  // Scenario 6: Local variable shadowing in html-fuse
  {
    const shadowA = `
      import { html } from 'lit';

      export function createComponent() {
        // Shadowed local html function
        const html = (strings, ...values) => 'shadowed';
        return html\`
          <div class="shadowed-box">
            <svg viewBox="0 0 20 20"><rect width="20" height="20"/></svg>
          </div>
        \`;
      }
    `;

    const shadowB = `
      import { html } from 'lit';

      export function createComponentB() {
        const html = (strings, ...values) => 'shadowed';
        return html\`
          <div class="shadowed-box">
            <svg viewBox="0 0 20 20"><rect width="20" height="20"/></svg>
          </div>
        \`;
      }
    `;

    const f1 = path.join(testDir, 'shadow-compA.ts');
    const f2 = path.join(testDir, 'shadow-compB.ts');
    fs.writeFileSync(f1, shadowA);
    fs.writeFileSync(f2, shadowB);

    const res = htmlFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 0, 'Locally shadowed html must NOT create fused templates');
    assert.strictEqual(res.rewrittenFiles.length, 0, 'Locally shadowed html must NOT rewrite files');
    console.log('✔ Scenario 6 Passed: local variable shadowing correctly recognized and ignored');
  }

  // Scenario 7: Statement coverage (switch, try, while, for) in html-fuse
  {
    const stmtA = `
      import { html } from 'lit';

      export function renderFlow(n) {
        switch (n) {
          case 1:
            return html\`<svg viewBox="0 0 14 14"><polygon points="0,0 14,0 7,14"/></svg>\`;
          default:
            try {
              while (n > 0) {
                return html\`<svg viewBox="0 0 14 14"><polygon points="0,0 14,0 7,14"/></svg>\`;
              }
            } catch (e) {
              for (let i = 0; i < 2; i++) {
                return html\`<svg viewBox="0 0 14 14"><polygon points="0,0 14,0 7,14"/></svg>\`;
              }
            }
        }
      }
    `;

    const stmtB = `
      import { html } from 'lit';

      export function renderFlowB(n) {
        switch (n) {
          case 2:
            return html\`<svg viewBox="0 0 14 14"><polygon points="0,0 14,0 7,14"/></svg>\`;
          default:
            return null;
        }
      }
    `;

    const f1 = path.join(testDir, 'stmt-compA.ts');
    const f2 = path.join(testDir, 'stmt-compB.ts');
    fs.writeFileSync(f1, stmtA);
    fs.writeFileSync(f2, stmtB);

    const res = htmlFuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 1, 'Should find shared polygon SVG across control flow structures');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files should be rewritten');

    const rwA = res.rewrittenFiles.find((f) => f.filePath === f1);
    assert(rwA.transformedCode.includes('switch (n)'), 'switch statement preserved');
    assert(rwA.transformedCode.includes('try {'), 'try block preserved');
    assert(rwA.transformedCode.includes('while (n > 0)'), 'while loop preserved');
    assert(rwA.transformedCode.includes('for (let i = 0; i < 2; i++)'), 'for loop preserved');
    assert(!rwA.transformedCode.includes('<polygon points="0,0 14,0 7,14"/>'), 'SVG replaced in all control flow statements');
    console.log('✔ Scenario 7 Passed: statement traversal across switch, try, while, for loops verified');
  }

  console.log('\n--- ALL EMPIRICAL CHALLENGER SUITE TESTS PASSED SUCCESSFULLY! ---');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
