import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, '.challenger-retry2-css');

fs.mkdirSync(testDir, { recursive: true });

try {
  console.log('--- Running Challenger Retry 2 End-to-End Stress Suite for @lit-core/css-fuse ---');

  // Test 1: Array styles preservation with partial & complete rule subtraction
  {
    console.log('1. Testing array styles preservation with partial and complete rule subtraction...');
    const f1 = path.join(testDir, 'card1.ts');
    const f2 = path.join(testDir, 'card2.ts');

    fs.writeFileSync(
      f1,
      `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';
      import { theme } from './theme.js';

      export class CardOne extends LitElement {
        static styles = [
          baseReset,
          theme,
          css\`:host { color: red; margin: 12px; }\`
        ];
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { LitElement, css } from 'lit';
      import { baseReset } from './reset.js';

      export class CardTwo extends LitElement {
        static styles = [
          baseReset,
          css\`:host { color: red; }\`
        ];
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedSheets.length, 1, 'Should create 1 fused stylesheet for :host { color: red; }');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both files should be rewritten');

    const rw1 = res.rewrittenFiles.find((r) => r.filePath === f1);
    const rw2 = res.rewrittenFiles.find((r) => r.filePath === f2);

    // CardOne checks:
    assert(rw1.transformedCode.includes('baseReset'), 'CardOne must preserve baseReset');
    assert(rw1.transformedCode.includes('theme'), 'CardOne must preserve theme');
    assert(rw1.transformedCode.includes('margin: 12px;'), 'CardOne must preserve remaining CSS margin: 12px');
    assert(rw1.transformedCode.includes('virtual:css-fuse/'), 'CardOne prepends virtual import');

    // CardTwo checks:
    assert(rw2.transformedCode.includes('baseReset'), 'CardTwo must preserve baseReset');
    assert(!rw2.transformedCode.includes('css``'), 'CardTwo omits empty css template');
    assert(rw2.transformedCode.includes('virtual:css-fuse/'), 'CardTwo prepends virtual import');

    console.log('   ✔ Array styles elements preserved, non-css elements intact, remaining rules retained');
  }

  // Test 2: Static getter array styles preservation
  {
    console.log('2. Testing static getter array styles preservation...');
    const f1 = path.join(testDir, 'getter1.ts');
    const f2 = path.join(testDir, 'getter2.ts');

    fs.writeFileSync(
      f1,
      `
      import { LitElement, css } from 'lit';
      import { globalReset } from './reset.js';

      export class GetterOne extends LitElement {
        static get styles() {
          return [
            globalReset,
            css\`:host { display: flex; align-items: center; }\`
          ];
        }
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { LitElement, css } from 'lit';
      import { globalReset } from './reset.js';

      export class GetterTwo extends LitElement {
        static get styles() {
          return [
            globalReset,
            css\`:host { display: flex; align-items: center; }\`
          ];
        }
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedSheets.length, 1, 'Creates fused sheet');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both rewritten');

    for (const rw of res.rewrittenFiles) {
      assert(rw.transformedCode.includes('static get styles()'), 'Getter signature preserved');
      assert(rw.transformedCode.includes('globalReset'), 'globalReset preserved in getter return');
      assert(rw.transformedCode.includes('virtual:css-fuse/'), 'Virtual import prepended');
    }
    console.log('   ✔ Static getter array styles preserved');
  }

  // Test 3: Multiple components in one file with distinct array styles
  {
    console.log('3. Testing multi-component file with distinct array styles...');
    const f1 = path.join(testDir, 'multi-comp.ts');
    const f2 = path.join(testDir, 'other-comp.ts');

    fs.writeFileSync(
      f1,
      `
      import { LitElement, css } from 'lit';
      import { resetA, resetB } from './resets.js';

      export class A extends LitElement {
        static styles = [resetA, css\`:host { font-family: sans-serif; }\`];
      }

      export class B extends LitElement {
        static styles = [resetB, css\`:host { font-family: sans-serif; }\`];
      }
    `,
    );

    fs.writeFileSync(
      f2,
      `
      import { LitElement, css } from 'lit';
      import { resetC } from './resets.js';

      export class C extends LitElement {
        static styles = [resetC, css\`:host { font-family: sans-serif; }\`];
      }
    `,
    );

    const res = fuse({ files: [f1, f2], threshold: 2, virtualImports: true });
    assert.strictEqual(res.fusedSheets.length, 1, 'Creates fused sheet for font-family');
    assert.strictEqual(res.rewrittenFiles.length, 2, 'Both rewritten');

    const multi = res.rewrittenFiles.find((r) => r.filePath === f1);
    assert(multi.transformedCode.includes('resetA'), 'Class A keeps resetA');
    assert(multi.transformedCode.includes('resetB'), 'Class B keeps resetB');
    console.log('   ✔ Multi-component file array styles correctly scoped and preserved');
  }

  console.log('All Challenger Retry 2 stress tests for @lit-core/css-fuse PASSED.');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
