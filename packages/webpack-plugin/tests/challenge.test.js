import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import lit, { LitWebpackPlugin, litWebpackLoader } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const fixtureDir = path.join(__dirname, 'challenge-fixtures');

function setupFixtures() {
  fs.mkdirSync(fixtureDir, { recursive: true });
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
      resolve(stats);
    });
  });
}

function executeLoader(context, source) {
  return new Promise((resolve, reject) => {
    const loaderCtx = {
      ...context,
      async() {
        return (err, code, map) => {
          if (err) reject(err);
          else resolve({ code, map });
        };
      },
    };
    litWebpackLoader.call(loaderCtx, source);
  });
}

async function runChallenge() {
  console.log('⚡ Starting empirical challenge suite for Webpack plugin and loader...\n');
  setupFixtures();

  try {
    // =========================================================================
    // Challenge 1: Loader transform error propagation for all 12 transforms
    // =========================================================================
    console.log('[Challenge 1] Testing loader error propagation across all transforms on invalid inputs...');

    const transformCases = [
      {
        name: 'propsLower',
        options: { propsLower: { sourcemap: 'invalid' } },
        source: `import { property } from 'lit/decorators.js'; class C { @property() p = 1; }`,
        expectedPlugin: 'props-lower',
      },
      {
        name: 'elemProxy',
        options: { elemProxy: { sourcemap: 'invalid' } },
        source: `import { customElement } from 'lit/decorators.js'; @customElement('elem-el') class C {}`,
        expectedPlugin: 'elem-proxy',
      },
      {
        name: 'native',
        options: { native: { sourcemap: 'invalid' } },
        source: `import { LitElement } from 'lit'; class C extends LitElement {}`,
        expectedPlugin: 'native',
      },
      {
        name: 'eventHoist',
        options: { eventHoist: { sourcemap: 'invalid' } },
        source: 'html`<button @click=${fn}>x</button>`;',
        expectedPlugin: 'event-hoist',
      },
      {
        name: 'dirtyMask',
        options: { dirtyMask: { sourcemap: 'invalid' } },
        source: 'html`<div>${x}</div>`;',
        expectedPlugin: 'dirty-mask',
      },
      {
        name: 'domPaths',
        options: { domPaths: { sourcemap: 'invalid' } },
        source: 'html`<div>${x}</div>`;',
        expectedPlugin: 'dom-paths',
      },
      {
        name: 'memoize',
        options: { memoize: { sourcemap: 'invalid' } },
        source: 'class C { render() { return 1; } }',
        expectedPlugin: 'memoize',
      },
      {
        name: 'directives',
        options: { directives: { sourcemap: 'invalid' } },
        source: `import { ifDefined } from 'lit/directives/if-defined.js';`,
        expectedPlugin: 'directives',
      },
      {
        name: 'cssMinifier',
        options: { cssMinifier: { sourcemap: 'invalid' } },
        source: 'const s = css` :host { color: red; } `;',
        expectedPlugin: 'css-minifier',
      },
      {
        name: 'htmlAot',
        options: { htmlAot: { sourcemap: 'invalid' } },
        source: 'const t = html`<div>hello</div>`;',
        expectedPlugin: 'html-aot',
      },
      {
        name: 'htmlMinifier',
        options: { htmlMinifier: { sourcemap: 'invalid' } },
        source: 'const t = html`<div>hello</div>`;',
        expectedPlugin: 'html-minifier',
      },
      {
        name: 'tagShake',
        options: { tagShake: { sourcemap: 'invalid' } },
        source: `customElements.define('my-tag', MyTag);`,
        expectedPlugin: 'tag-shake',
      },
    ];

    for (const tc of transformCases) {
      let thrownError = null;
      try {
        await executeLoader(
          {
            resourcePath: `/src/comp-${tc.name}.ts`,
            getOptions: () => ({ options: tc.options }),
          },
          tc.source,
        );
      } catch (err) {
        thrownError = err;
      }

      assert(thrownError instanceof Error, `Loader must pass an Error to callback when ${tc.name} transform fails`);
      assert(thrownError.message.includes('[lit-webpack-loader]'), `Error message must identify [lit-webpack-loader] prefix for ${tc.name}`);
      assert(thrownError.message.includes(tc.expectedPlugin), `Error message must identify failing transform ${tc.expectedPlugin} (got: ${thrownError.message})`);
      assert(thrownError.message.includes(`/src/comp-${tc.name}.ts`), `Error message must identify resource path /src/comp-${tc.name}.ts`);
      assert.strictEqual(thrownError.plugin, tc.expectedPlugin, `Error object must preserve plugin metadata property '${tc.expectedPlugin}'`);
      console.log(`  ✓ ${tc.name}: callback(err) received Error identifying ${tc.expectedPlugin}`);
    }

    // =========================================================================
    // Challenge 2: Plugin beforeCompile and virtual resource hook error handling
    // =========================================================================
    console.log('\n[Challenge 2] Testing Webpack plugin beforeCompile and virtual hook failure modes...');

    // 2.1: beforeCompile cssFuse error
    {
      const failingPlugin = new LitWebpackPlugin({
        cssFuse: { include: 123 },
      });
      let beforeCompileErr = null;
      const compiler = {
        options: { mode: 'production', module: { rules: [] } },
        getInfrastructureLogger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
        hooks: {
          beforeCompile: {
            tapAsync: (_name, fn) => {
              fn({}, (err) => {
                beforeCompileErr = err;
              });
            },
          },
          compilation: { tap: () => {} },
          normalModuleFactory: { tap: () => {} },
          shutdown: { tap: () => {} },
        },
      };
      failingPlugin.apply(compiler);
      assert(beforeCompileErr instanceof Error, 'beforeCompile must invoke callback with Error on cssFuse failure');
      assert(beforeCompileErr.message.includes('[css-fuse] Optimization pass failed'), `Error must identify css-fuse optimization failure (got: ${beforeCompileErr.message})`);
      console.log('  ✓ beforeCompile halts with Error on cssFuse failure');
    }

    // 2.2: beforeCompile htmlFuse error
    {
      const failingPlugin = new LitWebpackPlugin({
        cssFuse: false,
        htmlFuse: { include: 123 },
      });
      let beforeCompileErr = null;
      const compiler = {
        options: { mode: 'production', module: { rules: [] } },
        getInfrastructureLogger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
        hooks: {
          beforeCompile: {
            tapAsync: (_name, fn) => {
              fn({}, (err) => {
                beforeCompileErr = err;
              });
            },
          },
          compilation: { tap: () => {} },
          normalModuleFactory: { tap: () => {} },
          shutdown: { tap: () => {} },
        },
      };
      failingPlugin.apply(compiler);
      assert(beforeCompileErr instanceof Error, 'beforeCompile must invoke callback with Error on htmlFuse failure');
      assert(beforeCompileErr.message.includes('[html-fuse] Optimization pass failed'), `Error must identify html-fuse optimization failure (got: ${beforeCompileErr.message})`);
      console.log('  ✓ beforeCompile halts with Error on htmlFuse failure');
    }

    // 2.3: virtual resource hook failure modes
    {
      let virtualResourceHook = null;
      const mockCompiler = {
        options: { mode: 'production', module: { rules: [] } },
        getInfrastructureLogger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
        hooks: {
          beforeCompile: { tapAsync: () => {} },
          compilation: {
            tap: (_n, cb) => cb({}),
          },
          normalModuleFactory: { tap: () => {} },
          shutdown: { tap: () => {} },
        },
        webpack: {
          NormalModule: {
            getCompilationHooks: () => ({
              readResourceForScheme: {
                for: () => ({
                  tapPromise: (_n, fn) => {
                    virtualResourceHook = fn;
                  },
                }),
              },
            }),
          },
        },
      };
      const plugin = lit({ cssFuse: true });
      plugin.apply(mockCompiler);

      await assert.rejects(() => virtualResourceHook('virtual:lit-core/nonexistent-helper'), /\[virtual\] Virtual resource not found/i, 'virtual hook must throw on unknown lit-core resource');

      await assert.rejects(
        () => virtualResourceHook('virtual:lit-html-fuse/missing-template.js'),
        /\[html-fuse\] Virtual shared template not found/i,
        'virtual hook must throw on unknown html-fuse template',
      );

      await assert.rejects(() => virtualResourceHook('virtual:css-fuse/missing-sheet.js'), /\[virtual\] Virtual resource not found/i, 'virtual hook must throw on unknown css-fuse sheet');
      console.log('  ✓ virtual resource hook throws on nonexistent virtual paths');
    }

    // =========================================================================
    // Challenge 3: Real Webpack build halts on transform error
    // =========================================================================
    console.log('\n[Challenge 3] Verifying real Webpack compilation halts when loader transform fails...');

    const brokenCompPath = path.join(fixtureDir, 'broken-comp.ts');
    fs.writeFileSync(
      brokenCompPath,
      `import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
export class BrokenComp extends LitElement {
  @property() title = 'Broken';
}
`,
    );

    const outDirErr = path.join(fixtureDir, 'dist-error');
    const statsErr = await runWebpack({
      context: fixtureDir,
      mode: 'production',
      entry: {
        broken: brokenCompPath,
      },
      output: {
        path: outDirErr,
        filename: '[name].js',
        clean: true,
      },
      resolve: {
        extensions: ['.ts', '.js'],
      },
      plugins: [
        lit({
          cssFuse: false,
          propsLower: { sourcemap: 'invalid' },
        }),
      ],
    });

    assert(statsErr.hasErrors(), 'Webpack build MUST record errors when transform fails');
    const errorJson = statsErr.toJson({ errors: true });
    assert(errorJson.errors && errorJson.errors.length > 0, 'Webpack error collection must not be empty');

    const errMessages = errorJson.errors.map((e) => e.message).join('\n');
    assert(errMessages.includes('[lit-webpack-loader]'), `Webpack compilation error must contain [lit-webpack-loader] (got: ${errMessages})`);
    assert(errMessages.includes('props-lower'), `Webpack compilation error must contain failing transform props-lower (got: ${errMessages})`);
    assert(errMessages.includes('broken-comp.ts'), `Webpack compilation error must identify failing source file broken-comp.ts (got: ${errMessages})`);
    console.log('  ✓ Real Webpack compilation halts with compilation error on loader transform failure');

    // =========================================================================
    // Challenge 4: Canonical design system components verification
    // =========================================================================
    console.log('\n[Challenge 4] Verifying canonical design system components through loader pipeline...');

    const canonicalComponents = [
      {
        name: 'Carbon (cds-button)',
        path: path.resolve(rootDir, 'node_modules/@carbon/web-components/es/components/button/button.js'),
      },
      {
        name: 'Spectrum (sp-button)',
        path: path.resolve(rootDir, 'node_modules/@spectrum-web-components/button/sp-button.js'),
      },
      {
        name: 'Web Awesome (wa-button)',
        path: path.resolve(rootDir, 'node_modules/@awesome.me/webawesome/dist/components/button/button.js'),
      },
      {
        name: 'Google Material (md-filled-button)',
        path: path.resolve(rootDir, 'node_modules/@material/web/button/filled-button.js'),
      },
      {
        name: 'Cisco Momentum (mdc-button)',
        path: path.resolve(rootDir, 'node_modules/@momentum-design/components/dist/components/button/button.component.js'),
      },
    ];

    for (const comp of canonicalComponents) {
      assert(fs.existsSync(comp.path), `Canonical component file must exist: ${comp.path}`);
      const rawSource = fs.readFileSync(comp.path, 'utf-8');

      const result = await executeLoader(
        {
          resourcePath: comp.path,
          getOptions: () => ({
            options: {
              propsLower: true,
              htmlMinifier: true,
              cssMinifier: true,
              directives: true,
              dirtyMask: true,
              domPaths: true,
            },
          }),
        },
        rawSource,
      );

      assert(result.code, `Loader must return non-empty code for ${comp.name}`);
      assert.strictEqual(typeof result.code, 'string', `Loader output must be string for ${comp.name}`);
      assert(result.code.length > 0, `Loader output must have length > 0 for ${comp.name}`);
      console.log(`  ✓ ${comp.name} processed successfully (${result.code.length} bytes output)`);
    }

    // =========================================================================
    // Challenge 5: Benign non-matches pass through unmodified without error
    // =========================================================================
    console.log('\n[Challenge 5] Verifying benign non-matching inputs pass through without error...');

    const benignPlainTs = `export function computeTotal(items: number[]): number {
  return items.reduce((sum, n) => sum + n, 0);
}
`;
    const resPlain = await executeLoader(
      {
        resourcePath: '/src/math.ts',
        getOptions: () => ({
          options: {
            propsLower: true,
            htmlMinifier: true,
            cssMinifier: true,
            elemProxy: true,
          },
        }),
      },
      benignPlainTs,
    );
    assert.strictEqual(resPlain.code, benignPlainTs, 'Plain TS utility must pass through completely unmodified');
    console.log('  ✓ Plain non-Lit TS code passes through unmodified');

    const resEmpty = await executeLoader(
      {
        resourcePath: '/src/empty.ts',
        getOptions: () => ({
          options: {
            propsLower: true,
            htmlMinifier: true,
          },
        }),
      },
      '',
    );
    assert.strictEqual(resEmpty.code, '', 'Empty file must pass through as empty string');
    console.log('  ✓ Empty file passes through unmodified');

    console.log('\n🎉 ALL EMPIRICAL CHALLENGES PASSED! VERDICT: APPROVE\n');
  } finally {
    cleanupFixtures();
  }
}

runChallenge().catch((err) => {
  console.error('\n❌ Challenge failed:', err);
  cleanupFixtures();
  process.exit(1);
});
