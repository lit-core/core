import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, '.challenger-retry2-html');

fs.mkdirSync(testDir, { recursive: true });

try {
  console.log('--- Running Challenger Retry 2 End-to-End Stress Suite for @lit-core/html-fuse ---');

  // Test 1: Canonical namespace import `import * as Lit from 'lit'`
  {
    console.log('1. Testing namespace import Lit.html clustering and virtual module emission...');
    const f1 = path.join(testDir, 'ns-btn1.ts');
    const f2 = path.join(testDir, 'ns-btn2.ts');

    fs.writeFileSync(
      f1,
      `
      import * as Lit from 'lit';
      export class NsBtn1 extends Lit.LitElement {
        render() {
          return Lit.html\`
            <button class="ns-btn">
              <svg viewBox="0 0 16 16" class="icon"><path d="M0 0 L16 16"/></svg>
              <span>\${this.title}</span>
            </button>
          \`;
        }
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import * as Lit from 'lit';
      export class NsBtn2 extends Lit.LitElement {
        render() {
          return Lit.html\`
            <div class="ns-btn-alt">
              <svg viewBox="0 0 16 16" class="icon"><path d="M0 0 L16 16"/></svg>
              <span>\${this.label}</span>
            </div>
          \`;
        }
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 1, 'Should extract 1 shared SVG cluster from Lit.html');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files should be rewritten');
    assert(res.rewrittenFiles[0].transformedCode.includes('virtual:html-fuse/'), 'Prepends virtual import');
    assert(!res.rewrittenFiles[0].transformedCode.includes('<path d="M0 0 L16 16"/>'), 'Replaced SVG with fused token');
    console.log('   ✔ Lit.html successfully extracted, clustered, and rewritten');
  }

  // Test 2: Foreign namespace `Other.html` isolation
  {
    console.log('2. Testing foreign namespace Other.html isolation with simultaneous Lit import...');
    const f1 = path.join(testDir, 'foreign1.ts');
    const f2 = path.join(testDir, 'foreign2.ts');

    fs.writeFileSync(
      f1,
      `
      import { html } from 'lit';
      import * as Other from 'canvas-renderer';
      export class Hybrid1 {
        renderLit() { return html\`<div class="unique1">Hello</div>\`; }
        renderForeign() { return Other.html\`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10"/></svg>\`; }
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { html } from 'lit';
      import * as Other from 'canvas-renderer';
      export class Hybrid2 {
        renderLit() { return html\`<div class="unique2">World</div>\`; }
        renderForeign() { return Other.html\`<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="10"/></svg>\`; }
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 0, 'Foreign Other.html MUST NOT be clustered');
    assert.strictEqual(res.rewrittenFiles.length, 0, 'No files should be rewritten');
    console.log('   ✔ Other.html strictly ignored by semantic symbol verification');
  }

  // Test 3: Local variable shadowing isolation
  {
    console.log('3. Testing local variable shadowing of html tag...');
    const f1 = path.join(testDir, 'shadow1.ts');
    const f2 = path.join(testDir, 'shadow2.ts');

    fs.writeFileSync(
      f1,
      `
      import { html } from 'lit';
      export function realLit() {
        return html\`<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\`;
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { html } from 'lit';
      export function fakeLit() {
        const html = (s) => "custom";
        return html\`<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\`;
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    // Threshold is 2, and fakeLit is shadowed so only 1 real Lit template exists => no cluster formed!
    assert.strictEqual(res.fusedTemplates.length, 0, 'Shadowed template must not contribute to cluster count');
    assert.strictEqual(res.rewrittenFiles.length, 0, 'Files remain untouched');
    console.log('   ✔ Lexical scope shadowing respected: 0 clusters formed');
  }

  // Test 4: Control flow traversal (switch, try-catch, loops) across multiple files
  {
    console.log('4. Testing control flow constructs traversal across multiple files...');
    const f1 = path.join(testDir, 'ctrl1.ts');
    const f2 = path.join(testDir, 'ctrl2.ts');

    fs.writeFileSync(
      f1,
      `
      import { html } from 'lit';
      export function ctrlOne(val: number) {
        switch (val) {
          case 1:
            return html\`<svg viewBox="0 0 10 10" class="ctrl-icon"><line x1="0" y1="0" x2="10" y2="10"/></svg>\`;
          default:
            return null;
        }
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { html } from 'lit';
      export function ctrlTwo(items: string[]) {
        try {
          for (const item of items) {
            const t = html\`<svg viewBox="0 0 10 10" class="ctrl-icon"><line x1="0" y1="0" x2="10" y2="10"/></svg>\`;
          }
        } catch (e) {
          while (true) { break; }
        }
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedTemplates.length, 1, 'Should fuse shared SVG across switch and try-loop');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files rewritten');

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('virtual:html-fuse/'), 'Has virtual import');
      assert(!rw.transformedCode.includes('<line x1="0" y1="0" x2="10" y2="10"/>'), 'SVG replaced');
    }
    console.log('   ✔ Control flow AST traversal validated end-to-end');
  }

  console.log('All Challenger Retry 2 stress tests for @lit-core/html-fuse PASSED.');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
