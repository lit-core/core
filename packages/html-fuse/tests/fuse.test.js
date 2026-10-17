import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTemplates, fuse } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('Testing @lit-core/html-fuse native addon and full static template deduplication...');

// Test 1: Full static template clustering and rewriting across components
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-1');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `import { html, LitElement } from 'lit';
export class CompA extends LitElement {
  renderDefault() {
    return html\`<slot name="decorator"></slot>\`;
  }
}
`;

  const compB = `import { html, LitElement } from 'lit';
export class CompB extends LitElement {
  renderDefault() {
    return html\`<slot name="decorator"></slot>\`;
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

  assert.strictEqual(res.fusedTemplates.length, 1, 'should create 1 shared template for identical static template');
  const fused = res.fusedTemplates[0];
  assert.ok(fused.code.includes("import { html } from 'lit'"), 'should import html from lit');
  assert.ok(fused.code.includes(`export const ${fused.id} = html\``), 'should export const identifier with html tag');
  assert.ok(fused.code.includes(`export default ${fused.id}`), 'should export default identifier');
  assert.ok(fused.code.includes('<slot name="decorator"></slot>'), 'should preserve static markup');

  assert.strictEqual(res.rewrittenFiles.length, 2, 'should rewrite both components');
  for (const rewritten of res.rewrittenFiles) {
    assert.ok(rewritten.transformedCode.includes(`import { ${fused.id} } from 'virtual:html-fuse/${fused.id}.js';`), 'should import shared virtual template');
    assert.ok(rewritten.transformedCode.includes(`return ${fused.id};`), 'should replace entire static template expression with imported identifier');
  }

  assert.strictEqual(res.stats.componentsRewritten, 2);
  assert.strictEqual(res.stats.fusedTemplatesCreated, 1);

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Full static HTML template clustering and clean replacement');
}

// Test 2: Full static SVG template clustering
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-2');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `import { svg, LitElement } from 'lit';
export class IconA extends LitElement {
  renderIcon() {
    return svg\`<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>\`;
  }
}
`;

  const compB = `import { svg, LitElement } from 'lit';
export class IconB extends LitElement {
  renderIcon() {
    return svg\`<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>\`;
  }
}
`;

  const fileA = path.join(fixtureDir, 'icon-a.ts');
  const fileB = path.join(fixtureDir, 'icon-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    minFragmentLength: 15,
    virtualImports: true,
  });

  assert.strictEqual(res.fusedTemplates.length, 1, 'should create 1 shared template for identical static SVG template');
  const fused = res.fusedTemplates[0];
  assert.ok(fused.code.includes("import { svg } from 'lit'"), 'should import svg from lit');
  assert.ok(fused.code.includes(`export const ${fused.id} = svg\``), 'should export const identifier with svg tag');

  assert.strictEqual(res.rewrittenFiles.length, 2, 'should rewrite both SVG components');
  for (const rewritten of res.rewrittenFiles) {
    assert.ok(rewritten.transformedCode.includes(`return ${fused.id};`), 'should replace entire static SVG template expression with imported identifier');
  }

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Full static SVG template clustering');
}

// Test 3: Unimported global identifier guessing removed (bailout verification)
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-3');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const fileUnimported = path.join(fixtureDir, 'unimported.js');
  fs.writeFileSync(fileUnimported, 'const t = html`<div>unimported global template</div>`;', 'utf8');

  const res = fuse({
    files: [fileUnimported],
    threshold: 1,
    minFragmentLength: 5,
  });

  assert.strictEqual(res.fusedTemplates.length, 0, 'unimported global identifier must not be extracted');
  assert.strictEqual(res.rewrittenFiles.length, 0, 'unimported global template must remain untouched');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Unimported global identifier bailout verified');
}

// Test 4: Template diagnostics and audit
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-4');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `import { html } from 'lit'; export const a = html\`<span class="common-badge">badge</span>\`;`;
  const compB = `import { html } from 'lit'; export const b = html\`<span class="common-badge">badge</span>\`;`;

  const fileA = path.join(fixtureDir, 'comp-a.ts');
  const fileB = path.join(fixtureDir, 'comp-b.ts');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const diags = auditTemplates({
    files: [fileA, fileB],
    minFragmentLength: 15,
  });

  assert.ok(diags.length >= 1, 'audit should identify duplicate static fragments');
  assert.strictEqual(diags[0].code, 'DUPLICATE_STATIC_FRAGMENT');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Template diagnostics and audit');
}

// Test 5: Aliased import semantic resolution (html aliased as svg classified as html)
{
  const fixtureDir = path.join(__dirname, '.test-fixtures-5');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const compA = `import { html as svg } from 'lit';
export const a = svg\`<div class="banner"><span>Title</span></div>\`;
`;
  const compB = `import { html as svg } from 'lit';
export const b = svg\`<div class="banner"><span>Title</span></div>\`;
`;

  const fileA = path.join(fixtureDir, 'comp-a.js');
  const fileB = path.join(fixtureDir, 'comp-b.js');
  fs.writeFileSync(fileA, compA);
  fs.writeFileSync(fileB, compB);

  const res = fuse({
    files: [fileA, fileB],
    threshold: 2,
    minFragmentLength: 10,
    virtualImports: true,
  });

  assert.strictEqual(res.fusedTemplates.length, 1);
  const fused = res.fusedTemplates[0];
  assert.strictEqual(fused.kind, 'html', 'aliased html import must be classified as html regardless of local name');
  assert.ok(fused.code.includes("import { html } from 'lit'"), 'fused template must import html from lit');

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  console.log('  ✔ Aliased import semantic resolution (html aliased as svg)');
}

console.log('\nAll @lit-core/html-fuse tests passed successfully.\n');
