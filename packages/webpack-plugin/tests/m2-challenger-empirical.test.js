import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import lit, { LitWebpackPlugin, litWebpackLoader } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _rootDir = path.resolve(__dirname, '../../..');
const testTmpDir = path.join(__dirname, 'm2-empirical-temp');

function setup() {
  fs.mkdirSync(testTmpDir, { recursive: true });
}

function cleanup() {
  if (fs.existsSync(testTmpDir)) {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  }
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

function _runWebpack(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((err, stats) => {
      if (err) return reject(err);
      resolve(stats);
    });
  });
}

async function runEmpiricalSuite() {
  console.log('🔬 STARTING EMPIRICAL ADVERSARIAL CHALLENGE SUITE FOR MILESTONE 2\n');
  setup();

  const results = {
    passed: [],
    failed: [],
  };

  function record(name, status, details) {
    if (status === 'PASS') {
      results.passed.push({ name, details });
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      results.failed.push({ name, details });
      console.log(`  ❌ [FAIL] ${name}: ${details}`);
    }
  }

  // =========================================================================
  // GROUP 1: Webpack loader SSR transform on malformed syntax and non-standard JS
  // =========================================================================
  console.log('--- GROUP 1: Webpack loader SSR transform: syntax edge cases & non-standard JS ---');

  // Test 1.1: Valid JS code with relational operators (e.g. for-loop with '<')
  {
    const name = '1.1: Valid minified JS for-loop with relational operator (i<len;)';
    const validCode = `import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  render() {
    for(let i=0;i<len;i++) { console.log(i); }
    return html\`<div>Done</div>\`;
  }
}`;
    try {
      const _res = await executeLoader(
        {
          resourcePath: '/src/comp-relational.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        validCode,
      );
      record(name, 'PASS', 'Loader accepted valid relational for-loop');
    } catch (err) {
      record(name, 'FAIL', `Loader falsely threw on valid relational operator: ${err.message}`);
    }
  }

  // Test 1.2: Valid TypeScript generic syntax Foo<Bar>;
  {
    const name = '1.2: Valid TypeScript generic syntax (type X = List<Item>;)';
    const tsCode = `import { LitElement, html } from 'lit';
type X = List<Item>;
export class Comp extends LitElement {
  render() { return html\`<div>\${1}</div>\`; }
}`;
    try {
      const _res = await executeLoader(
        {
          resourcePath: '/src/comp-generic.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        tsCode,
      );
      record(name, 'PASS', 'Loader accepted TypeScript generic');
    } catch (err) {
      record(name, 'FAIL', `Loader falsely threw on TypeScript generic: ${err.message}`);
    }
  }

  // Test 1.3: Relational comparison without spaces (const a=x<y;)
  {
    const name = '1.3: Relational comparison without spaces (const a=x<y;)';
    const compCode = `import { LitElement, html } from 'lit';
export class Comp extends LitElement {
  check() { const a=x<y; return a; }
  render() { return html\`<span>test</span>\`; }
}`;
    try {
      const _res = await executeLoader(
        {
          resourcePath: '/src/comp-comp.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        compCode,
      );
      record(name, 'PASS', 'Loader accepted valid comparison without spaces');
    } catch (err) {
      record(name, 'FAIL', `Loader falsely threw on valid comparison: ${err.message}`);
    }
  }

  // Test 1.4: Truly malformed template syntax (<broken;)
  {
    const name = '1.4: Truly malformed template syntax (<broken;) properly rejected';
    const brokenCode = `import { LitElement } from 'lit';
export class BrokenComp extends LitElement {
  render() { return <broken; }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/broken.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        brokenCode,
      );
      record(name, 'FAIL', 'Loader should have rejected malformed template syntax <broken;');
    } catch (err) {
      if (err.message.includes('Malformed component template syntax') || err.message.includes('[ssr]')) {
        record(name, 'PASS', 'Loader correctly rejected malformed template');
      } else {
        record(name, 'FAIL', `Unexpected error message: ${err.message}`);
      }
    }
  }

  // Test 1.5: Island tagging on class extending mixin (class MyButton extends Mixin(LitElement))
  {
    const name = '1.5: Island tagging with mixin inheritance (class MyButton extends Mixin(LitElement))';
    const mixinCode = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
@customElement('my-button')
export class MyButton extends Mixin(LitElement) {
  render() { return html\`<button>Click</button>\`; }
}`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/my-button.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['my-button'] } } } }),
        },
        mixinCode,
      );
      if (res.code.includes('static __isIsland = true;')) {
        record(name, 'PASS', 'Island property injected for class with mixin');
      } else {
        record(name, 'FAIL', 'static __isIsland was NOT injected for class extending Mixin(LitElement)');
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw error: ${err.message}`);
    }
  }

  // Test 1.6: Multiple classes in one file (helper class first, island component second)
  {
    const name = '1.6: Multi-class file: island tag injected into component class, not helper';
    const multiCode = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
class InternalHelper extends Object {
  static helper() { return 1; }
}
@customElement('island-widget')
export class IslandWidget extends LitElement {
  render() { return html\`<div>\${InternalHelper.helper()}</div>\`; }
}`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/multi-class.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['island-widget'] } } } }),
        },
        multiCode,
      );
      const helperHasIsland = res.code.includes('class InternalHelper extends Object {\n  static __isIsland = true;');
      const widgetHasIsland = res.code.includes('class IslandWidget extends LitElement {\n  static __isIsland = true;');
      if (widgetHasIsland && !helperHasIsland) {
        record(name, 'PASS', 'Island injected into IslandWidget and NOT InternalHelper');
      } else if (helperHasIsland) {
        record(name, 'FAIL', 'static __isIsland was incorrectly injected into InternalHelper instead of IslandWidget!');
      } else {
        record(name, 'FAIL', 'static __isIsland was not injected into IslandWidget');
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw error: ${err.message}`);
    }
  }

  // Test 1.7: Anonymous default export class (export default class extends LitElement)
  {
    const name = '1.7: Island tagging on anonymous default export (export default class extends LitElement)';
    const anonCode = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
@customElement('anon-widget')
export default class extends LitElement {
  render() { return html\`<div>Anon</div>\`; }
}`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/anon-widget.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['anon-widget'] } } } }),
        },
        anonCode,
      );
      if (res.code.includes('static __isIsland = true;')) {
        record(name, 'PASS', 'Island injected for anonymous class');
      } else {
        record(name, 'FAIL', 'static __isIsland was NOT injected for anonymous default export class');
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw error: ${err.message}`);
    }
  }

  // =========================================================================
  // GROUP 2: Multiple compilation passes & asset emission collisions for ssr-manifest.json
  // =========================================================================
  console.log('\n--- GROUP 2: Multiple compilation passes & asset emission collisions ---');

  // Test 2.1: Duplicate processAssets emission (e.g. incremental build, dual-build merge, or multiple plugin calls)
  {
    const name = '2.1: processAssets asset collision when ssr-manifest.json already exists';
    const plugin = new LitWebpackPlugin({
      ssr: {
        manifest: {
          fileName: 'ssr-manifest.json',
        },
      },
    });

    const _conflictErrorCaught = null;
    let _emissionCount = 0;
    const assetsEmitted = new Map();

    const mockCompilation = {
      outputOptions: { publicPath: '/assets/' },
      chunks: [
        {
          name: 'main',
          files: new Set(['main.js']),
        },
      ],
      getAsset(file) {
        if (file === 'main.js') {
          return {
            source: {
              source: () => `customElements.define('cds-button', class CDSButton extends HTMLElement {});`,
            },
          };
        }
        if (assetsEmitted.has(file)) {
          return { source: assetsEmitted.get(file) };
        }
        return null;
      },
      emitAsset(fileName, source) {
        _emissionCount++;
        if (assetsEmitted.has(fileName)) {
          // Webpack 5 Compilation.emitAsset throws when asset already exists with different content!
          const existingSource = assetsEmitted.get(fileName).source();
          const newSource = source.source();
          if (existingSource !== newSource) {
            throw new Error(`Conflict: Multiple assets emit different content to the same filename ${fileName}`);
          }
        }
        assetsEmitted.set(fileName, source);
      },
      hooks: {
        processAssets: {
          tapPromise(_options, callback) {
            return callback;
          },
        },
      },
    };

    let processAssetsHandler = null;
    const mockCompiler = {
      options: {
        target: 'node',
        module: { rules: [] },
        mode: 'production',
      },
      webpack: {
        Compilation: {
          PROCESS_ASSETS_STAGE_ADDITIONS: 100,
        },
        sources: {
          RawSource: class {
            constructor(val) {
              this.val = val;
            }
            source() {
              return this.val;
            }
          },
        },
      },
      getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
      hooks: {
        beforeCompile: { tapAsync() {} },
        compilation: { tap() {} },
        thisCompilation: {
          tap(_name, cb) {
            mockCompilation.hooks.processAssets.tapPromise = (_opts, fn) => {
              processAssetsHandler = fn;
            };
            cb(mockCompilation);
          },
        },
        normalModuleFactory: { tap() {} },
        shutdown: { tap() {} },
      },
    };

    plugin.apply(mockCompiler);

    try {
      // First pass: emits ssr-manifest.json
      await processAssetsHandler({});
      // Small delay to ensure timestamp changes if new Date().toISOString() is used
      await new Promise((r) => setTimeout(r, 10));
      // Second pass (e.g. watch mode, second compilation pass):
      await processAssetsHandler({});
      record(name, 'PASS', 'Plugin handled second compilation pass without asset collision error');
    } catch (err) {
      record(name, 'FAIL', `Collision error thrown on second compilation pass: ${err.message}`);
    }
  }

  // Test 2.2: Dual compiler setup with both client and server plugins emitting ssr-manifest.json
  {
    const name = '2.2: Multi-compiler (client + server) targeting same output directory with ssr: manifest';
    const clientEntry = path.join(testTmpDir, 'client-comp.js');
    const serverEntry = path.join(testTmpDir, 'server-comp.js');
    fs.writeFileSync(clientEntry, `customElements.define('client-el', class extends HTMLElement {});`);
    fs.writeFileSync(serverEntry, `customElements.define('server-el', class extends HTMLElement {});`);

    const outDir = path.join(testTmpDir, 'dist-multi');

    const multiConfig = [
      {
        name: 'client',
        target: 'web',
        mode: 'production',
        entry: { client: clientEntry },
        output: { path: outDir, filename: '[name].js', clean: false },
        plugins: [
          lit({
            cssFuse: false,
            ssr: { manifest: { fileName: 'ssr-manifest.json' } },
          }),
        ],
      },
      {
        name: 'server',
        target: 'node',
        mode: 'production',
        entry: { server: serverEntry },
        output: { path: outDir, filename: '[name].js', clean: false },
        plugins: [
          lit({
            cssFuse: false,
            ssr: { manifest: { fileName: 'ssr-manifest.json' } },
          }),
        ],
      },
    ];

    try {
      const stats = await new Promise((resolve, reject) => {
        webpack(multiConfig, (err, stats) => {
          if (err) return reject(err);
          resolve(stats);
        });
      });

      if (stats.hasErrors()) {
        const errors = stats.toJson({ errors: true }).errors;
        const errMsg = errors.map((e) => e.message).join('\n');
        if (errMsg.includes('Conflict') || errMsg.includes('Multiple assets emit')) {
          record(name, 'FAIL', `Multi-compiler build failed due to asset collision: ${errMsg}`);
        } else {
          record(name, 'FAIL', `Multi-compiler build failed with errors: ${errMsg}`);
        }
      } else {
        const manifestPath = path.join(outDir, 'ssr-manifest.json');
        if (fs.existsSync(manifestPath)) {
          record(name, 'PASS', 'Multi-compiler completed and emitted ssr-manifest.json');
        } else {
          record(name, 'FAIL', 'ssr-manifest.json was not created on disk');
        }
      }
    } catch (err) {
      record(name, 'FAIL', `Webpack multi-compiler threw: ${err.message}`);
    }
  }

  // =========================================================================
  // GROUP 3: Virtual module resolution integrity under unusual bundler environments
  // =========================================================================
  console.log('\n--- GROUP 3: Virtual module resolution integrity ---');

  // Test 3.1: Resolution of virtual:lit-core/ssr-runtime with query parameters
  {
    const name = '3.1: Resolution of virtual:lit-core/ssr-runtime?ssr query parameter';
    let hookFn = null;
    const mockCompiler = {
      options: { mode: 'production', module: { rules: [] } },
      getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
      hooks: {
        beforeCompile: { tapAsync() {} },
        compilation: {
          tap: (_n, cb) => cb({}),
        },
        normalModuleFactory: { tap() {} },
        shutdown: { tap() {} },
      },
      webpack: {
        NormalModule: {
          getCompilationHooks: () => ({
            readResourceForScheme: {
              for: () => ({
                tapPromise: (_n, fn) => {
                  hookFn = fn;
                },
              }),
            },
          }),
        },
      },
    };

    const plugin = lit({ cssFuse: false, ssr: true });
    plugin.apply(mockCompiler);

    try {
      const buf = await hookFn('virtual:lit-core/ssr-runtime?ssr=1');
      if (buf?.toString().includes('render')) {
        record(name, 'PASS', 'Virtual module resolver stripped query string and resolved ssr-runtime');
      } else {
        record(name, 'FAIL', 'Virtual module resolver returned empty/unexpected content');
      }
    } catch (err) {
      record(name, 'FAIL', `Virtual module resolver threw on query parameter: ${err.message}`);
    }
  }

  // Test 3.2: Resolution of virtual:lit-core/islands-loader and with .js extension
  {
    const name = '3.2: Resolution of virtual:lit-core/islands-loader with and without .js';
    let hookFn = null;
    const mockCompiler = {
      options: { mode: 'production', module: { rules: [] } },
      getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
      hooks: {
        beforeCompile: { tapAsync() {} },
        compilation: {
          tap: (_n, cb) => cb({}),
        },
        normalModuleFactory: { tap() {} },
        shutdown: { tap() {} },
      },
      webpack: {
        NormalModule: {
          getCompilationHooks: () => ({
            readResourceForScheme: {
              for: () => ({
                tapPromise: (_n, fn) => {
                  hookFn = fn;
                },
              }),
            },
          }),
        },
      },
    };

    const plugin = lit({ cssFuse: false, ssr: true });
    plugin.apply(mockCompiler);

    try {
      const buf1 = await hookFn('virtual:lit-core/islands-loader');
      const buf2 = await hookFn('virtual:lit-core/islands-loader.js');
      const hasContent1 = buf1?.toString().includes('hydrate');
      const hasContent2 = buf2?.toString().includes('hydrate');
      if (hasContent1 && hasContent2) {
        record(name, 'PASS', 'Both islands-loader and islands-loader.js resolved correctly');
      } else {
        record(name, 'FAIL', `islands-loader resolution failed: buf1=${hasContent1}, buf2=${hasContent2}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Virtual hook threw on islands-loader: ${err.message}`);
    }
  }

  // Test 3.3: Redirect of @lit-core/ssr/client with query parameter
  {
    const name = '3.3: Redirect of @lit-core/ssr/client?worker in NormalModuleFactory resolve';
    let resolveHook = null;
    const mockCompiler = {
      options: { mode: 'production', module: { rules: [] } },
      getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
      hooks: {
        beforeCompile: { tapAsync() {} },
        compilation: { tap() {} },
        normalModuleFactory: {
          tap: (_n, cb) => {
            const mockNmf = {
              hooks: {
                resolve: {
                  tap: (_name, fn) => {
                    resolveHook = fn;
                  },
                },
              },
            };
            cb(mockNmf);
          },
        },
        shutdown: { tap() {} },
      },
    };

    const plugin = lit({ cssFuse: false, ssr: true });
    plugin.apply(mockCompiler);

    const resolveData = { request: '@lit-core/ssr/client?worker' };
    resolveHook(resolveData);

    if (resolveData.request.startsWith('virtual:lit-core/ssr-runtime')) {
      record(name, 'PASS', `Redirected @lit-core/ssr/client?worker to ${resolveData.request}`);
    } else {
      record(name, 'FAIL', `Did not redirect @lit-core/ssr/client?worker (got: ${resolveData.request})`);
    }
  }

  // Test 3.4: Graceful handling when compiler.webpack is undefined
  {
    const name = '3.4: Graceful behavior when compiler.webpack is missing';
    const mockCompilerNoWebpack = {
      options: { mode: 'production', module: { rules: [] } },
      getInfrastructureLogger: () => ({ info() {}, warn() {}, error() {} }),
      hooks: {
        beforeCompile: { tapAsync() {} },
        compilation: { tap: (_n, cb) => cb({}) },
        normalModuleFactory: { tap: () => {} },
        shutdown: { tap: () => {} },
      },
      // compiler.webpack is undefined
    };

    try {
      const plugin = lit({ cssFuse: false, ssr: true });
      plugin.apply(mockCompilerNoWebpack);
      record(name, 'PASS', 'Plugin apply does not crash when compiler.webpack is undefined');
    } catch (err) {
      record(name, 'FAIL', `Plugin apply crashed without compiler.webpack: ${err.message}`);
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n=========================================================================');
  console.log(`TOTAL TESTS: ${results.passed.length + results.failed.length}`);
  console.log(`PASSED: ${results.passed.length}`);
  console.log(`FAILED: ${results.failed.length}`);
  console.log('=========================================================================');

  cleanup();
  return results;
}

runEmpiricalSuite()
  .then((results) => {
    if (results.failed.length > 0) {
      console.log(`\n❌ EMPIRICAL CHALLENGES DETECTED ${results.failed.length} VULNERABILITIES.`);
      process.exit(1);
    } else {
      console.log('\n🎉 ALL EMPIRICAL CHALLENGES PASSED.');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Suite crashed:', err);
    cleanup();
    process.exit(1);
  });
