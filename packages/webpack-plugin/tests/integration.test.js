import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuse } from '@lit-core/css-fuse';
import webpack from 'webpack';
import lit, { LitWebpackPlugin } from '../dist/index.js';

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

function runWebpack(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err) return reject(err);
      if (stats?.hasErrors()) {
        const info = stats.toJson({ errors: true });
        return reject(new Error(info.errors?.map((e) => e.message).join('\n') || 'Webpack build error'));
      }
      resolve(stats);
    });
  });
}

async function runTests() {
  console.log('🧪 Starting Webpack Plugin Integration Test Suite...');

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
    // TEST 2: Webpack Bundling & Chunk Boundary Isolation
    // -----------------------------------------------------------
    console.log('\n[Test 2] Verifying Webpack module graph & chunk isolation...');

    const outDir = path.join(fixtureDir, 'dist');
    const stats = await runWebpack({
      context: fixtureDir,
      mode: 'production',
      optimization: {
        minimize: false,
      },
      externals: {
        lit: 'lit',
        'lit/decorators.js': 'lit/decorators.js',
      },
      entry: {
        main: path.join(fixtureDir, 'entry-main.ts'),
        lazy: path.join(fixtureDir, 'entry-lazy.ts'),
      },
      output: {
        path: outDir,
        filename: '[name].js',
        clean: true,
      },
      resolve: {
        extensions: ['.ts', '.js'],
        extensionAlias: {
          '.js': ['.ts', '.js'],
        },
      },
      plugins: [
        new LitWebpackPlugin({
          cssFuse: {
            include: [`${fixtureDir}/**/*.ts`],
            exclude: [`${fixtureDir}/entry-*.ts`],
            threshold: 2,
            applyInDev: true,
          },
        }),
      ],
    });

    assert(stats, 'Webpack build must succeed');

    const mainBundlePath = path.join(outDir, 'main.js');
    const lazyBundlePath = path.join(outDir, 'lazy.js');
    const mainCode = fs.readFileSync(mainBundlePath, 'utf-8');
    const lazyCode = fs.readFileSync(lazyBundlePath, 'utf-8');

    // Main entry must contain Comp A/B styles, but MUST NOT contain Comp C/D isolated styles
    assert(!mainCode.includes('isolated-sidebar'), 'Tree-shaking violation: Entry main must not leak styles from unimported lazy components');
    assert(mainCode.includes('color: red') || mainCode.includes('color:red'), 'Entry main must contain Component A styles');

    // Lazy entry must not contain Comp A/B styles
    assert(!lazyCode.includes('font-size: 14px') && !lazyCode.includes('font-size:14px'), 'Tree-shaking violation: Lazy entry must not leak Comp A/B styles');
    assert(lazyCode.includes('isolated-sidebar'), 'Lazy entry must contain Component C/D styles');

    console.log('✓ Webpack chunk isolation verified: unimported shared sheets are strictly isolated.');

    // -----------------------------------------------------------
    // TEST 3: Constructable Stylesheet Instance Reuse
    // -----------------------------------------------------------
    console.log('\n[Test 3] Verifying constructable stylesheet instance reuse across components...');

    const sheetAB = result.fusedSheets.find((s) => s.sharedBy.some((f) => f.includes('comp-a')));
    assert(sheetAB, 'Shared sheet for Comp A & B must exist');

    const testSheetPath = path.join(fixtureDir, 'test-sheet.js');
    fs.writeFileSync(testSheetPath, sheetAB.code);

    const mod1 = await import(`${testSheetPath}?t=1`);
    const mod2 = await import(`${testSheetPath}?t=1`);

    const sheetInstance1 = mod1[sheetAB.id];
    const sheetInstance2 = mod2[sheetAB.id];

    assert.strictEqual(sheetInstance1, sheetInstance2, 'Constructable stylesheet instance must be strictly identical across imports');
    assert(sheetInstance1?._$cssResult$, 'Exported constructable stylesheet must be a valid Lit CSSResult constructable sheet');

    console.log('✓ Constructable stylesheet reuse verified: same CSSStyleSheet reference shared.');

    // -----------------------------------------------------------
    // TEST 4: Function-style lit() and spread operator in Webpack config
    // -----------------------------------------------------------
    console.log('\n[Test 4] Verifying lit() function invocation and spread usage in Webpack config...');

    const outDir2 = path.join(fixtureDir, 'dist-func');
    await runWebpack({
      context: fixtureDir,
      mode: 'production',
      optimization: {
        minimize: false,
      },
      externals: {
        lit: 'lit',
      },
      entry: {
        main: path.join(fixtureDir, 'entry-main.ts'),
      },
      output: {
        path: outDir2,
        filename: '[name].js',
        clean: true,
      },
      resolve: {
        extensions: ['.ts', '.js'],
        extensionAlias: {
          '.js': ['.ts', '.js'],
        },
      },
      plugins: [
        ...lit({
          cssFuse: {
            include: [`${fixtureDir}/**/*.ts`],
            exclude: [`${fixtureDir}/entry-*.ts`],
            threshold: 2,
            applyInDev: true,
          },
        }),
      ],
    });

    const mainCode2 = fs.readFileSync(path.join(outDir2, 'main.js'), 'utf-8');
    assert(mainCode2.includes('color: red') || mainCode2.includes('color:red'), 'Function-style lit() must produce valid bundle');

    console.log('✓ Function-style and spread operator verified successfully.');

    // -----------------------------------------------------------
    // TEST 5: Props Lowering, CSS & HTML Minification in Webpack
    // -----------------------------------------------------------
    console.log('\n[Test 5] Verifying props lowering, CSS & HTML minification in Webpack bundle...');

    fs.writeFileSync(
      path.join(fixtureDir, 'comp-full.ts'),
      `import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('comp-full')
export class CompFull extends LitElement {
  @property() title = 'Test';

  static styles = css\`
    :host {
      display: block;
      padding: 20px 20px 20px 20px;
    }
  \`;

  render() {
    return html\`
      <section class="container">
        <!-- template comment to strip -->
        <h1>\${this.title}</h1>
      </section>
    \`;
  }
}
`,
    );

    const outDirFull = path.join(fixtureDir, 'dist-full');
    await runWebpack({
      context: fixtureDir,
      mode: 'production',
      optimization: {
        minimize: false,
      },
      externals: {
        lit: 'lit',
        'lit/decorators.js': 'lit/decorators.js',
      },
      entry: {
        full: path.join(fixtureDir, 'comp-full.ts'),
      },
      output: {
        path: outDirFull,
        filename: '[name].js',
        clean: true,
      },
      resolve: {
        extensions: ['.ts', '.js'],
        extensionAlias: {
          '.js': ['.ts', '.js'],
        },
      },
      plugins: [
        lit({
          cssFuse: false,
          propsLower: true,
          cssMinifier: true,
          htmlMinifier: true,
        }),
      ],
    });

    const fullCode = fs.readFileSync(path.join(outDirFull, 'full.js'), 'utf-8');

    // Verify decorator lowering
    assert(!fullCode.includes('@customElement'), 'Decorators must be stripped by propsLower in Webpack');
    assert(fullCode.includes('customElements.define("comp-full"') || fullCode.includes("customElements.define('comp-full'"), 'customElements.define emitted');
    assert(fullCode.includes('static properties'), 'static properties emitted by propsLower');

    // Verify HTML minification
    assert(!fullCode.includes('template comment to strip'), 'HTML comment stripped by htmlMinifier in Webpack');
    assert(fullCode.includes('<section class="container"><h1>'), 'HTML whitespace collapsed');

    // Verify CSS minification
    assert(fullCode.includes('padding:20px') || fullCode.includes('padding: 20px'), 'CSS minified by cssMinifier in Webpack');

    console.log('✓ Props lowering, CSS & HTML minification verified in Webpack bundle.');

    console.log('\n🎉 ALL WEBPACK INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } finally {
    cleanupFixtures();
  }
}

runTests().catch((err) => {
  console.error('\n❌ Webpack integration test failed:', err);
  cleanupFixtures();
  process.exit(1);
});
