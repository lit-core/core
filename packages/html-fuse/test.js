import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, auditTemplates, fuse } from './src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Testing @lit-core/html-fuse native addon...');

// Test 1: Basic static SVG fragment deduplication across components
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-1');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `
    import { html, LitElement } from 'lit';
    export class CompA extends LitElement {
      render() {
        return html\`
          <div class="card">
            <svg class="chevron" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
            <span>\${this.title}</span>
          </div>
        \`;
      }
    }
  `;

  const compB = `
    import { html, LitElement } from 'lit';
    export class CompB extends LitElement {
      render() {
        return html\`
          <button class="btn">
            <svg class="chevron" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>
            <slot></slot>
          </button>
        \`;
      }
    }
  `;

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    virtualImports: true,
  });

  assert.strictEqual(res.fusedTemplates.length, 1, 'Should create 1 shared fused template for identical SVG');
  const fused = res.fusedTemplates[0];
  assert(fused.code.includes('export const _fused_svg_'), 'Should export _fused_svg_ constant');
  assert(fused.code.includes('<svg class="chevron" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>'), 'Should preserve canonical SVG markup');

  assert.strictEqual(res.rewrittenFiles.length, 2, 'Should rewrite both components');
  for (const rewritten of res.rewrittenFiles) {
    assert(rewritten.transformedCode.includes(`import { ${fused.id} } from 'virtual:html-fuse/${fused.id}.js';`), 'Should import shared virtual template');
    assert(rewritten.transformedCode.includes(`\${${fused.id}}`), 'Should replace inline SVG with interpolation of shared template');
    assert(!rewritten.transformedCode.includes('<svg class="chevron"'), 'Should remove duplicate raw SVG subtree');
  }

  assert.strictEqual(res.stats.componentsRewritten, 2);
  assert.strictEqual(res.stats.fusedTemplatesCreated, 1);
  assert(res.stats.bytesSaved > 0, 'Should record bytes saved');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Basic static SVG fragment deduplication across components');
}

// Test 2: Full static template clustering (e.g. <slot></slot>)
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-2');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `
    import { html, LitElement } from 'lit';
    export class CompA extends LitElement {
      renderDefault() {
        return html\`<slot></slot>\`;
      }
    }
  `;

  const compB = `
    import { html, LitElement } from 'lit';
    export class CompB extends LitElement {
      renderDefault() {
        return html\`<slot></slot>\`;
      }
    }
  `;

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    minFragmentLength: 10,
    virtualImports: true,
  });

  assert(res.fusedTemplates.length >= 1, 'Should create shared template for identical static template');
  assert.strictEqual(res.rewrittenFiles.length, 2, 'Should rewrite both components');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Full static template clustering');
}

// Test 3: Formatting and whitespace tolerance in subtrees
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-3');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `
    import { html } from 'lit';
    const t1 = html\`
      <div class="wrapper-a">
        <slot name="decorator" slot="decorator"></slot>
      </div>
    \`;
  `;

  const compB = `
    import { html } from 'lit';
    const t2 = html\`
      <div class="wrapper-b">
        <slot 
          name="decorator" 
          slot="decorator"></slot>
      </div>
    \`;
  `;

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    minFragmentLength: 15,
  });

  assert.strictEqual(res.fusedTemplates.length, 1, 'Should normalize whitespace differences to same cluster');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Formatting and whitespace tolerance in subtrees');
}

// Test 4: Template diagnostics and audit
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-4');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = 'import { html } from \'lit\'; export const a = html`<span class="common-badge">badge</span>`;';
  const compB = 'import { html } from \'lit\'; export const b = html`<span class="common-badge">badge</span>`;';

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const diags = auditTemplates({
    files: [fileA, fileB],
    minFragmentLength: 15,
  });

  assert(diags.length >= 1, 'Audit should identify duplicate static fragments');
  assert.strictEqual(diags[0].code, 'DUPLICATE_STATIC_FRAGMENT');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Template diagnostics and audit');
}

// Test 5: General-purpose HTML element subtree deduplication (no SVG, no slot, no hardcoded heuristics)
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-5');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `
    import { html, LitElement } from 'lit';
    export class CompA extends LitElement {
      render() {
        return html\`
          <section class="user-panel">
            <div class="card-item"><button type="button" class="action-btn">Confirm</button></div>
            <span>\${this.userName}</span>
          </section>
        \`;
      }
    }
  `;

  const compB = `
    import { html, LitElement } from 'lit';
    export class CompB extends LitElement {
      render() {
        return html\`
          <section class="admin-panel">
            <div class="card-item"><button type="button" class="action-btn">Confirm</button></div>
            <span>\${this.adminRole}</span>
          </section>
        \`;
      }
    }
  `;

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    virtualImports: true,
  });

  assert.strictEqual(res.fusedTemplates.length, 1, 'Should create 1 shared fused template for identical generic HTML');
  const fused = res.fusedTemplates[0];
  assert(fused.code.includes('export const _fused_html_'), 'Should export _fused_html_ constant');
  assert(fused.code.includes('<div class="card-item"><button type="button" class="action-btn">Confirm</button></div>'), 'Should preserve canonical HTML markup');

  assert.strictEqual(res.rewrittenFiles.length, 2, 'Should rewrite both components');
  for (const rewritten of res.rewrittenFiles) {
    assert(rewritten.transformedCode.includes(`\${${fused.id}}`), 'Should replace inline HTML with interpolation of shared template');
    assert(!rewritten.transformedCode.includes('<div class="card-item"><button'), 'Should remove duplicate raw HTML subtree');
  }

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ General-purpose HTML element subtree deduplication');
}

console.log('\nAll html-fuse tests passed successfully!\n');
