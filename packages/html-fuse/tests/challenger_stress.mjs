import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, '.challenger-html-stress');

fs.mkdirSync(testDir, { recursive: true });

try {
  console.log('Running Challenger M2 Stress Tests for @lit-core/html-fuse...');

  // Test 1: Arbitrary custom element tags & multiline templates & complex comments
  {
    console.log('  Testing arbitrary custom elements, comments, and multiline templates...');
    const comp1 = `
      import { html, LitElement } from 'lit';
      export class ArbitraryComp1 extends LitElement {
        render() {
          return html\`
            <!-- standard comment -->
            <!--! bang comment --!>
            <!-- -- nested dashes -- in comment -- -->
            <quantum-enterprise-container class="modal-box" data-id="123">
              <svg viewBox="0 0 24 24" class="custom-icon"><circle cx="12" cy="12" r="10"/></svg>
              <span>\${this.title}</span>
            </quantum-enterprise-container>
          \`;
        }
      }
    `;

    const comp2 = `
      import { html, LitElement } from 'lit';
      export class ArbitraryComp2 extends LitElement {
        render() {
          return html\`
            <!--! bang comment --!>
            <div class="wrapper">
              <svg viewBox="0 0 24 24" class="custom-icon"><circle cx="12" cy="12" r="10"/></svg>
              <span>\${this.description}</span>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'arb-comp1.ts');
    const f2 = path.join(testDir, 'arb-comp2.ts');
    fs.writeFileSync(f1, comp1);
    fs.writeFileSync(f2, comp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 1, 'Should extract shared SVG template despite complex comments');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both components should be rewritten');
    console.log('  ✔ Complex comments, multiline templates, and custom tags handled');
  }

  // Test 2: Unrelated third-party html imports (hyperhtml, uhtml)
  {
    console.log('  Testing unrelated third-party html imports isolation...');
    const unrelated1 = `
      import { html } from 'hyperhtml';
      export class HyperComp1 {
        render() {
          return html\`
            <div class="card">
              <svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>
            </div>
          \`;
        }
      }
    `;

    const unrelated2 = `
      import { html } from 'hyperhtml';
      export class HyperComp2 {
        render() {
          return html\`
            <div class="card">
              <svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'hyper-comp1.ts');
    const f2 = path.join(testDir, 'hyper-comp2.ts');
    fs.writeFileSync(f1, unrelated1);
    fs.writeFileSync(f2, unrelated2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 0, 'Unrelated hyperhtml files must NOT be rewritten');
    assert.strictEqual(res.fusedTemplates.length, 0, 'No fused templates should be created from hyperhtml');
    console.log('  ✔ Third-party html imports correctly ignored');
  }

  // Test 3: Namespace import from Lit: `import * as Lit from 'lit'`
  {
    console.log('  Testing namespace import from Lit (import * as Lit from "lit")...');
    const nsComp1 = `
      import * as Lit from 'lit';
      export class NsComp1 extends Lit.LitElement {
        render() {
          return Lit.html\`
            <div class="common-bar">
              <svg viewBox="0 0 8 8"><polygon points="0,0 8,0 4,8"/></svg>
              <span>\${this.val}</span>
            </div>
          \`;
        }
      }
    `;

    const nsComp2 = `
      import * as Lit from 'lit';
      export class NsComp2 extends Lit.LitElement {
        render() {
          return Lit.html\`
            <div class="other-bar">
              <svg viewBox="0 0 8 8"><polygon points="0,0 8,0 4,8"/></svg>
              <span>\${this.val}</span>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'ns-comp1.ts');
    const f2 = path.join(testDir, 'ns-comp2.ts');
    fs.writeFileSync(f1, nsComp1);
    fs.writeFileSync(f2, nsComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    console.log('  Namespace import test result: fusedTemplates =', res.fusedTemplates.length, ', rewrittenFiles =', res.rewrittenFiles.length);
  }

  // Test 4: False positive check: unrelated namespace import `import * as Other from 'other'`
  {
    console.log('  Testing false positive check with unrelated namespace import...');
    const fakeComp1 = `
      import { html } from 'lit';
      import * as Other from 'other-lib';
      export class FakeComp1 {
        render() {
          return Other.html\`
            <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>
          \`;
        }
      }
    `;

    const fakeComp2 = `
      import { html } from 'lit';
      import * as Other from 'other-lib';
      export class FakeComp2 {
        render() {
          return Other.html\`
            <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'fake-comp1.ts');
    const f2 = path.join(testDir, 'fake-comp2.ts');
    fs.writeFileSync(f1, fakeComp1);
    fs.writeFileSync(f2, fakeComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    console.log('  Unrelated namespace call Other.html test result: fusedTemplates =', res.fusedTemplates.length, ', rewrittenFiles =', res.rewrittenFiles.length);
  }

  // Test 5: Clean bailouts on files with no shared templates
  {
    console.log('  Testing clean bailouts on unique templates...');
    const u1 = `
      import { html, LitElement } from 'lit';
      export class U1 extends LitElement {
        render() {
          return html\`<div class="unique-one"><p>Alpha</p></div>\`;
        }
      }
    `;
    const u2 = `
      import { html, LitElement } from 'lit';
      export class U2 extends LitElement {
        render() {
          return html\`<div class="unique-two"><p>Beta</p></div>\`;
        }
      }
    `;

    const f1 = path.join(testDir, 'u1.ts');
    const f2 = path.join(testDir, 'u2.ts');
    fs.writeFileSync(f1, u1);
    fs.writeFileSync(f2, u2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 0, 'No files should be rewritten when templates are unique');
    assert.strictEqual(res.fusedTemplates.length, 0, 'No fused templates should be created');
    console.log('  ✔ Clean bailout verified when no clusters apply');
  }

  // Test 6: AST integrity, TypeScript annotations, and multiple quasi replacements
  {
    console.log('  Testing AST integrity with TypeScript annotations and multiple subtrees in one quasi...');
    const tsComp1 = `
      import { html, LitElement, TemplateResult } from 'lit';
      import { customElement, property } from 'lit/decorators.js';

      @customElement('ts-html-comp1')
      export class TsHtmlComp1<T extends Record<string, unknown>> extends LitElement {
        @property({ type: String })
        accessor titleText: string = 'Hello';

        render(): TemplateResult {
          return html\`
            <div class="panel">
              <svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>
              <span>\${this.titleText}</span>
              <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>
            </div>
          \`;
        }
      }
    `;

    const tsComp2 = `
      import { html, LitElement, TemplateResult } from 'lit';
      import { customElement, property } from 'lit/decorators.js';

      @customElement('ts-html-comp2')
      export class TsHtmlComp2<T extends Record<string, unknown>> extends LitElement {
        @property({ type: String })
        accessor titleText: string = 'World';

        render(): TemplateResult {
          return html\`
            <div class="panel-alt">
              <svg viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>
              <span>\${this.titleText}</span>
              <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>
            </div>
          \`;
        }
      }
    `;

    const f1 = path.join(testDir, 'ts-html-comp1.ts');
    const f2 = path.join(testDir, 'ts-html-comp2.ts');
    fs.writeFileSync(f1, tsComp1);
    fs.writeFileSync(f2, tsComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 2, 'Should create 2 fused templates for the two shared SVGs');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both TypeScript components should be rewritten');

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('class TsHtmlComp'), 'Preserves class declaration');
      assert(rw.transformedCode.includes('accessor titleText'), 'Preserves accessor property');
      assert(rw.transformedCode.includes('render(): TemplateResult'), 'Preserves return type annotation');
      assert(!rw.transformedCode.includes('<path d="M0 0 L10 10"/>'), 'First SVG replaced');
      assert(!rw.transformedCode.includes('<circle cx="10" cy="10" r="5"/>'), 'Second SVG replaced');
    }
    console.log('  ✔ AST integrity, TypeScript annotations, and multiple subtrees verified');
  }

  console.log('All @lit-core/html-fuse tests finished.');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
