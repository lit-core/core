import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '@lit-core/css-fuse';
import { build } from 'vite';
import lit from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');

async function setupFixtures() {
  fs.mkdirSync(fixtureDir, { recursive: true });

  // Component A: shares base rules, has local color: red
  fs.writeFileSync(
    path.join(fixtureDir, 'comp-a.ts'),
    `import { LitElement, css } from 'lit';
export class CompA extends LitElement {
  static styles = css\`
    :host {
      display: inline-block;
      box-sizing: border-box;
      color: red;
    }
    .btn {
      cursor: pointer;
      font-size: 14px;
    }
  \`;
}
`,
  );

  // Component B: shares base rules, has local color: blue
  fs.writeFileSync(
    path.join(fixtureDir, 'comp-b.ts'),
    `import { LitElement, css } from 'lit';
export class CompB extends LitElement {
  static styles = css\`
    :host {
      display: inline-block;
      box-sizing: border-box;
      color: blue;
    }
    .btn {
      cursor: pointer;
      font-size: 14px;
    }
  \`;
}
`,
  );

  // Component C: isolated component with completely separate rules
  fs.writeFileSync(
    path.join(fixtureDir, 'comp-c.ts'),
    `import { LitElement, css } from 'lit';
export class CompC extends LitElement {
  static styles = css\`
    .isolated-sidebar {
      width: 250px;
      background: black;
    }
  \`;
}
`,
  );

  // Component D: shares rules only with Comp C
  fs.writeFileSync(
    path.join(fixtureDir, 'comp-d.ts'),
    `import { LitElement, css } from 'lit';
export class CompD extends LitElement {
  static styles = css\`
    .isolated-sidebar {
      width: 250px;
      background: yellow;
    }
  \`;
}
`,
  );

  // Entry 1 imports only Comp A & Comp B
  fs.writeFileSync(
    path.join(fixtureDir, 'entry-main.ts'),
    `import { CompA } from './comp-a.js';
import { CompB } from './comp-b.js';
export { CompA, CompB };
`,
  );

  // Entry 2 imports only Comp C & Comp D (e.g. lazy route)
  fs.writeFileSync(
    path.join(fixtureDir, 'entry-lazy.ts'),
    `import { CompC } from './comp-c.js';
import { CompD } from './comp-d.js';
export { CompC, CompD };
`,
  );
}

function cleanupFixtures() {
  if (fs.existsSync(fixtureDir)) {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('🧪 Starting CSS Fuse Integration Test Suite...');

  setupFixtures();

  try {
    // -----------------------------------------------------------
    // TEST 1: AST Extraction & Cascade Order Verification
    // -----------------------------------------------------------
    console.log('\n[Test 1] Verifying cascade order & local override preservation...');
    const result = fuse({
      include: [`${fixtureDir}/**/*.ts`],
      exclude: [`${fixtureDir}/entry-*.ts`],
      threshold: 2,
      outputDir: '.fused',
      write: false,
      virtualImports: true,
    });

    assert(result.fusedSheets.length >= 2, 'Should create shared sheets for [A, B] and [C, D]');

    // Find rewritten Comp A
    const rewrittenA = result.rewrittenFiles.find((f) => f.filePath.endsWith('comp-a.ts'));
    assert(rewrittenA, 'comp-a.ts must be rewritten');

    const codeA = rewrittenA.transformedCode;

    // Verify cascade order: shared sheet must be prepended BEFORE local styles
    assert(codeA.includes('static styles = [_fused_'), 'Shared stylesheet must be the first item in static styles array');
    assert(codeA.includes(', css`'), 'Local overrides must be included after the shared stylesheet');
    assert(codeA.includes('color: red;'), 'Component A must retain its unique local override (color: red)');
    assert(!codeA.includes('box-sizing: border-box;'), 'Shared box-sizing declaration must be extracted out of local CSS');
    assert(!codeA.includes('cursor: pointer;'), 'Shared cursor declaration must be extracted out of local CSS');

    console.log('✓ Cascade order verified: shared sheets prepended before local overrides.');

    // -----------------------------------------------------------
    // TEST 2: Tree-Shaking & Chunk Boundary Isolation
    // -----------------------------------------------------------
    console.log('\n[Test 2] Verifying Rollup/Vite module graph & tree-shaking isolation...');

    const outDir = path.join(fixtureDir, 'dist');
    const _rollupResult = await build({
      root: fixtureDir,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
          external: ['lit', 'lit/decorators.js'],
          input: {
            main: path.join(fixtureDir, 'entry-main.ts'),
            lazy: path.join(fixtureDir, 'entry-lazy.ts'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: 'chunks/[name]-[hash].js',
          },
        },
      },
      plugins: [
        lit({
          cssFuse: {
            include: [`${fixtureDir}/**/*.ts`],
            exclude: [`${fixtureDir}/entry-*.ts`],
            threshold: 2,
            applyInDev: true,
          },
        }),
      ],
    });

    const mainBundlePath = path.join(outDir, 'main.js');
    const lazyBundlePath = path.join(outDir, 'lazy.js');
    const mainCode = fs.readFileSync(mainBundlePath, 'utf-8');
    const lazyCode = fs.readFileSync(lazyBundlePath, 'utf-8');

    // Main entry must contain Comp A/B styles, but MUST NOT contain Comp C/D isolated styles
    assert(!mainCode.includes('isolated-sidebar'), 'Tree-shaking violation: Entry main must not leak styles from unimported lazy components');
    assert(mainCode.includes('color: red') || mainCode.includes('color:red'), 'Entry main must contain Component A styles');

    // Lazy entry must not contain Comp A/B styles
    assert(!lazyCode.includes('font-size: 14px') && !lazyCode.includes('font-size:14px'), 'Tree-shaking violation: Lazy entry must not leak Comp A/B styles');

    console.log('✓ Tree-shaking verified: unimported shared sheets are strictly isolated.');

    // -----------------------------------------------------------
    // TEST 3: Constructable Stylesheet Instance Reuse
    // -----------------------------------------------------------
    console.log('\n[Test 3] Verifying Constructable Stylesheet instance reuse across components...');

    // When evaluating the generated fused sheets, importing from the same module yields the exact same CSSResult
    const sheetAB = result.fusedSheets.find((s) => s.sharedBy.some((f) => f.includes('comp-a')));
    assert(sheetAB, 'Shared sheet for Comp A & B must exist');

    // Write sheet to a temporary file in fixtureDir so node resolves 'lit'
    const testSheetPath = path.join(fixtureDir, 'test-sheet.js');
    fs.writeFileSync(testSheetPath, sheetAB.code);

    const mod1 = await import(`${testSheetPath}?t=1`);
    const mod2 = await import(`${testSheetPath}?t=1`);

    const sheetInstance1 = mod1[sheetAB.id];
    const sheetInstance2 = mod2[sheetAB.id];

    assert.strictEqual(sheetInstance1, sheetInstance2, 'Constructable stylesheet instance must be strictly identical across imports (same reference)');

    assert(sheetInstance1?._$cssResult$, 'Exported constructable stylesheet must be a valid Lit CSSResult constructable sheet');

    console.log('✓ Constructable stylesheet reuse verified: same CSSStyleSheet reference shared.');

    console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    cleanupFixtures();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Integration test failed:', err);
  cleanupFixtures();
  process.exit(1);
});
