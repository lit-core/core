import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, '.challenger-css-stress');

fs.mkdirSync(testDir, { recursive: true });

try {
  console.log('Running Challenger M2 Stress Tests for @lit-core/css-fuse...');

  // Test 1: Arbitrary library prefixes (single letter, long prefix, numbers, BEM)
  {
    console.log('  Testing arbitrary library prefixes...');
    const comp1 = `
      import { LitElement, css } from 'lit';
      export class MyBtn1 extends LitElement {
        static styles = css\`
          .c-btn { display: inline-flex; align-items: center; }
          .quantum-enterprise-system-modal__header--active { z-index: 100; opacity: 1; }
          .ui2-card { border-radius: 4px; padding: 16px; }
          .plain { margin: 0; }
        \`;
      }
    `;

    const comp2 = `
      import { LitElement, css } from 'lit';
      export class MyBtn2 extends LitElement {
        static styles = css\`
          .c-btn { display: inline-flex; align-items: center; }
          .quantum-enterprise-system-modal__header--active { z-index: 100; opacity: 1; }
          .ui2-card { border-radius: 4px; padding: 16px; }
          .plain { margin: 0; }
        \`;
      }
    `;

    const f1 = path.join(testDir, 'prefix-comp1.ts');
    const f2 = path.join(testDir, 'prefix-comp2.ts');
    fs.writeFileSync(f1, comp1);
    fs.writeFileSync(f2, comp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both components with arbitrary prefixes should be rewritten');
    assert(res.fusedSheets.length >= 1, 'Should create fused sheets for identical rules with arbitrary prefixes');
    console.log('  ✔ Arbitrary library prefixes handled without error');
  }

  // Test 2: Unrelated third-party css imports (styled-components, emotion)
  {
    console.log('  Testing unrelated third-party css imports isolation...');
    const unrelatedComp1 = `
      import { css } from 'styled-components';
      export class StyledComp1 {
        styles = css\`
          :host { display: block; box-sizing: border-box; }
        \`;
      }
    `;

    const unrelatedComp2 = `
      import { css } from 'styled-components';
      export class StyledComp2 {
        styles = css\`
          :host { display: block; box-sizing: border-box; }
        \`;
      }
    `;

    const f1 = path.join(testDir, 'unrelated-comp1.ts');
    const f2 = path.join(testDir, 'unrelated-comp2.ts');
    fs.writeFileSync(f1, unrelatedComp1);
    fs.writeFileSync(f2, unrelatedComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 0, 'Unrelated styled-components files must NOT be rewritten');
    assert.strictEqual(res.fusedSheets.length, 0, 'No fused sheets should be created from styled-components');
    console.log('  ✔ Third-party css imports correctly ignored');
  }

  // Test 3: Mixed Lit and third-party imports in same file + local shadowing
  {
    console.log('  Testing mixed imports and local variable shadowing...');
    const mixedComp1 = `
      import { css } from 'lit';
      import { css as styledCss } from 'styled-components';
      export class MixedComp1 {
        static styles = css\`
          :host { color: green; font-size: 16px; }
        \`;
        otherStyles = styledCss\`
          :host { color: green; font-size: 16px; }
        \`;
      }
    `;

    const mixedComp2 = `
      import { css } from 'lit';
      import { css as styledCss } from 'styled-components';
      export class MixedComp2 {
        static styles = css\`
          :host { color: green; font-size: 16px; }
        \`;
        otherStyles = styledCss\`
          :host { color: green; font-size: 16px; }
        \`;
      }
    `;

    const f1 = path.join(testDir, 'mixed-comp1.ts');
    const f2 = path.join(testDir, 'mixed-comp2.ts');
    fs.writeFileSync(f1, mixedComp1);
    fs.writeFileSync(f2, mixedComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Mixed files should rewrite only Lit styles');
    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('styledCss`'), 'styledCss must remain untouched');
    }
    console.log('  ✔ Mixed Lit and non-Lit imports correctly distinguished');
  }

  // Test 4: Clean bailouts when no clusters apply or on untouched files
  {
    console.log('  Testing clean bailouts on unique styles...');
    const uniqueComp1 = `
      import { css } from 'lit';
      export class Unique1 {
        static styles = css\` :host { color: purple; } \`;
      }
    `;
    const uniqueComp2 = `
      import { css } from 'lit';
      export class Unique2 {
        static styles = css\` :host { background: yellow; } \`;
      }
    `;

    const f1 = path.join(testDir, 'unique1.ts');
    const f2 = path.join(testDir, 'unique2.ts');
    fs.writeFileSync(f1, uniqueComp1);
    fs.writeFileSync(f2, uniqueComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 0, 'No files should be rewritten when rules are unique');
    assert.strictEqual(res.fusedSheets.length, 0, 'No fused sheets should be created');
    console.log('  ✔ Clean bailout verified when no clusters apply');
  }

  // Test 5: AST integrity, TypeScript annotations, and multiline formatting
  {
    console.log('  Testing AST integrity with TypeScript annotations and multiline templates...');
    const tsComp1 = `
      import { LitElement, css, CSSResultGroup } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('ts-comp1')
      export class TsComp1<T extends object> extends LitElement {
        #privateField: number = 42;
        static override styles: CSSResultGroup = css\`
          /* Complex comment with { braces } and "quotes" */
          :host {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 16px;
          }
          ::slotted(*) {
            box-sizing: border-box;
          }
        \`;
      }
    `;

    const tsComp2 = `
      import { LitElement, css, CSSResultGroup } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('ts-comp2')
      export class TsComp2<T extends object> extends LitElement {
        #privateField: number = 42;
        static override styles: CSSResultGroup = css\`
          /* Complex comment with { braces } and "quotes" */
          :host {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 16px;
          }
          ::slotted(*) {
            box-sizing: border-box;
          }
        \`;
      }
    `;

    const f1 = path.join(testDir, 'ts-comp1.ts');
    const f2 = path.join(testDir, 'ts-comp2.ts');
    fs.writeFileSync(f1, tsComp1);
    fs.writeFileSync(f2, tsComp2);

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both TypeScript components should be rewritten');
    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('static override styles'), 'Preserves static override keywords');
      assert(rw.transformedCode.includes('#privateField'), 'Preserves private fields');
      assert(rw.transformedCode.includes('TsComp'), 'Preserves class name');
    }
    console.log('  ✔ AST integrity and TypeScript annotations preserved');
  }

  console.log('All @lit-core/css-fuse challenger stress tests PASSED successfully!');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
