import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lit as viteLit } from '../../vite-plugin/dist/index.js';
import { extractLitCoreVirtualSubpath as viteExtractSubpath } from '../../vite-plugin/dist/utils.js';
import { LitWebpackPlugin, litWebpackLoader } from '../dist/index.js';
import { extractLitCoreVirtualSubpath as webpackExtractSubpath } from '../dist/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testTmpDir = path.join(__dirname, 'm2-stress-temp');

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

async function runAdversarialStressSuite() {
  console.log('⚡ STARTING ADVERSARIAL STRESS CHALLENGE SUITE FOR MILESTONE 2 (ITERATION 2)\n');
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
  // GROUP 1: RELATIONAL LOOPS, BITWISE OPERATORS, AND SYNTAX VALIDATION
  // =========================================================================
  console.log('--- GROUP 1: Relational operators, bitwise operations & syntax validation ---');

  // Test 1.1: Complex for-loop with multiple relational comparisons
  {
    const name = '1.1: Complex for-loop with multiple relational comparisons (i<max&&max>0)';
    const code = `import { LitElement, html } from 'lit';
export class ComplexLoop extends LitElement {
  render() {
    for (let i = 0, max = 100; i < max && max > 0; i++) {
      if (i < 10) continue;
    }
    return html\`<div>Done</div>\`;
  }
}`;
    try {
      const _res = await executeLoader(
        {
          resourcePath: '/src/complex-loop.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        code,
      );
      record(name, 'PASS', 'Loader accepted complex for-loop');
    } catch (err) {
      record(name, 'FAIL', `Threw on complex for-loop: ${err.message}`);
    }
  }

  // Test 1.2: While loop and do-while with relational condition
  {
    const name = '1.2: While loop and do-while with relational condition';
    const code = `import { LitElement, html } from 'lit';
export class WhileLoops extends LitElement {
  render() {
    let x = 0;
    while (x < 10) { x++; }
    do { x--; } while (x > 0);
    return html\`<div>\${x}</div>\`;
  }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/while-loop.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        code,
      );
      record(name, 'PASS', 'Loader accepted while and do-while relational loops');
    } catch (err) {
      record(name, 'FAIL', `Threw on while/do-while: ${err.message}`);
    }
  }

  // Test 1.3: Arrow functions with relational operators and array operations
  {
    const name = '1.3: Arrow functions with relational operators (x => x < 5)';
    const code = `import { LitElement, html } from 'lit';
export class ArrowComp extends LitElement {
  filterItems(arr) {
    return arr.filter(x => x < 5).map(y => y > 2 ? y : 0);
  }
  render() {
    return html\`<div>\${this.filterItems([1, 2, 3])}</div>\`;
  }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/arrow-comp.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        code,
      );
      record(name, 'PASS', 'Loader accepted arrow functions with relational operators');
    } catch (err) {
      record(name, 'FAIL', `Threw on arrow relational operator: ${err.message}`);
    }
  }

  // Test 1.4: Bitwise shifts combined with relational comparison
  {
    const name = '1.4: Bitwise shifts combined with relational comparison ((x << 2) < (y >> 1))';
    const code = `import { LitElement, html } from 'lit';
export class BitwiseComp extends LitElement {
  check(x, y) {
    return (x << 2) < (y >> 1);
  }
  render() { return html\`<span>\${this.check(1, 10)}</span>\`; }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/bitwise-comp.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        code,
      );
      record(name, 'PASS', 'Loader accepted bitwise shifts with relational comparison');
    } catch (err) {
      record(name, 'FAIL', `Threw on bitwise shift comparison: ${err.message}`);
    }
  }

  // Test 1.5: Regex containing angle brackets inside component method
  {
    const name = '1.5: Regex containing angle brackets inside component method';
    const code = `import { LitElement, html } from 'lit';
export class RegexComp extends LitElement {
  cleanTag(str) {
    const re = /<[a-z0-9_-]+>/gi;
    return str.replace(re, '');
  }
  render() { return html\`<div>\${this.cleanTag('<span;>')}</div>\`; }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/regex-comp.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        code,
      );
      record(name, 'PASS', 'Loader accepted regex with angle brackets');
    } catch (err) {
      record(name, 'FAIL', `Threw on regex with angle brackets: ${err.message}`);
    }
  }

  // Test 1.6: Genuine malformed syntax rejection across various defects
  {
    const name = '1.6: Genuine malformed syntax rejection (unclosed braces, invalid token)';
    const brokenCode = `import { LitElement } from 'lit';
export class Broken extends LitElement {
  render( { return 1; }
}`;
    try {
      await executeLoader(
        {
          resourcePath: '/src/syntax-err.ts',
          getOptions: () => ({ options: { ssr: true } }),
        },
        brokenCode,
      );
      record(name, 'FAIL', 'Loader should have rejected unclosed function parameter list');
    } catch (err) {
      if (err.message.includes('Malformed component template syntax') || err.message.includes('[ssr]')) {
        record(name, 'PASS', 'Loader correctly rejected malformed function signature');
      } else {
        record(name, 'FAIL', `Unexpected error message: ${err.message}`);
      }
    }
  }

  // =========================================================================
  // GROUP 2: ISLAND MIXIN TOPOLOGIES, CUSTOM REGISTRATIONS & MULTI-CLASS
  // =========================================================================
  console.log('\n--- GROUP 2: Island mixin topologies & multi-class scoping ---');

  // Test 2.1: Chained mixin inheritance (class extends MixinA(MixinB(LitElement)))
  {
    const name = '2.1: Chained mixin inheritance (class extends MixinA(MixinB(LitElement)))';
    const code = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
@customElement('chained-mixin-btn')
export class ChainedMixinButton extends ThemeMixin(FocusMixin(LitElement)) {
  render() { return html\`<button>Chained</button>\`; }
}`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/chained-mixin.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['chained-mixin-btn'] } } } }),
        },
        code,
      );
      if (res.code.includes('static __isIsland = true;')) {
        record(name, 'PASS', 'static __isIsland injected into chained mixin class');
      } else {
        record(name, 'FAIL', 'static __isIsland was NOT injected for chained mixin');
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw on chained mixin: ${err.message}`);
    }
  }

  // Test 2.2: Mixin inheritance without decorator, registered with customElements.define
  {
    const name = '2.2: Mixin inheritance registered via customElements.define';
    const code = `import { LitElement, html } from 'lit';
export class ImperativeMixinBtn extends MyMixin(LitElement) {
  render() { return html\`<button>Imperative</button>\`; }
}
customElements.define('imperative-mixin-btn', ImperativeMixinBtn);`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/imperative-mixin.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['imperative-mixin-btn'] } } } }),
        },
        code,
      );
      if (res.code.includes('static __isIsland = true;')) {
        record(name, 'PASS', 'static __isIsland injected for imperative customElements.define with mixin');
      } else {
        record(name, 'FAIL', 'static __isIsland was NOT injected for imperative define with mixin');
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw on imperative mixin define: ${err.message}`);
    }
  }

  // Test 2.3: 5-class file: 2 helpers, 2 targeted islands, 1 skipped component
  {
    const name = '2.3: 5-class file: only targeted islands receive static __isIsland';
    const code = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

class LocalHelper {
  static help() { return 'help'; }
}

class BaseUtils extends Object {
  static util() { return 'util'; }
}

@customElement('target-island-a')
export class TargetIslandA extends LitElement {
  render() { return html\`<div>\${LocalHelper.help()}</div>\`; }
}

export class TargetIslandB extends LitElement {
  render() { return html\`<div>\${BaseUtils.util()}</div>\`; }
}
customElements.define('target-island-b', TargetIslandB);

@customElement('skipped-component')
export class SkippedComp extends LitElement {
  render() { return html\`<div>Skipped</div>\`; }
}`;

    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/five-classes.ts',
          getOptions: () => ({
            options: {
              ssr: {
                islands: {
                  include: ['target-island-a', 'target-island-b'],
                },
              },
            },
          }),
        },
        code,
      );

      const helperHasIsland =
        res.code.includes('class LocalHelper {\n  static __isIsland = true;') || (res.code.includes('LocalHelper') && res.code.includes('class LocalHelper {\n  static __isIsland'));
      const utilsHasIsland = res.code.includes('class BaseUtils extends Object {\n  static __isIsland = true;');
      const skippedHasIsland = res.code.includes('class SkippedComp extends LitElement {\n  static __isIsland = true;');
      const aHasIsland = res.code.includes('class TargetIslandA extends LitElement {\n  static __isIsland = true;');
      const bHasIsland = res.code.includes('class TargetIslandB extends LitElement {\n  static __isIsland = true;');

      if (aHasIsland && bHasIsland && !helperHasIsland && !utilsHasIsland && !skippedHasIsland) {
        record(name, 'PASS', 'Only TargetIslandA and TargetIslandB tagged with __isIsland');
      } else {
        record(name, 'FAIL', `Tagging misdirected: a=${aHasIsland}, b=${bHasIsland}, helper=${helperHasIsland}, utils=${utilsHasIsland}, skipped=${skippedHasIsland}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw on 5-class file: ${err.message}`);
    }
  }

  // Test 2.4: Class that already defines static __isIsland = true (idempotence)
  {
    const name = '2.4: Pre-existing static __isIsland is not duplicated';
    const code = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
@customElement('already-island')
export class AlreadyIsland extends LitElement {
  static __isIsland = true;
  render() { return html\`<div>Existing</div>\`; }
}`;
    try {
      const res = await executeLoader(
        {
          resourcePath: '/src/already-island.ts',
          getOptions: () => ({ options: { ssr: { islands: { include: ['already-island'] } } } }),
        },
        code,
      );
      const matches = res.code.match(/static __isIsland/g) || [];
      if (matches.length === 1) {
        record(name, 'PASS', 'static __isIsland remained exactly 1 instance');
      } else {
        record(name, 'FAIL', `Expected 1 static __isIsland, found ${matches.length}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Loader threw on pre-existing island: ${err.message}`);
    }
  }

  // Test 2.5: Parity with Vite plugin SSR transform on chained mixin and multi-class
  {
    const name = '2.5: Vite plugin SSR transform parity on chained mixins';
    const code = `import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
@customElement('vite-chained-btn')
export class ViteChainedBtn extends MixinA(MixinB(LitElement)) {
  render() { return html\`<button>Vite</button>\`; }
}`;
    try {
      const plugins = viteLit({
        ssr: { islands: { include: ['vite-chained-btn'] } },
      });
      const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
      const res = await ssrPlugin.transform.call(
        {
          error(e) {
            throw e;
          },
          warn() {},
        },
        code,
        '/src/vite-chained.ts',
      );
      if (res?.code?.includes('static __isIsland = true;')) {
        record(name, 'PASS', 'Vite SSR plugin correctly tagged chained mixin class');
      } else {
        record(name, 'FAIL', 'Vite SSR plugin failed to tag chained mixin class');
      }
    } catch (err) {
      record(name, 'FAIL', `Vite SSR plugin threw on chained mixin: ${err.message}`);
    }
  }

  // =========================================================================
  // GROUP 3: WEBPACK SSR MANIFEST COLLISIONS, DETERMINISM & BASE PATHS
  // =========================================================================
  console.log('\n--- GROUP 3: Webpack SSR manifest emission, determinism & basePath ---');

  // Test 3.1: Timestamp determinism across compilation passes
  {
    const name = '3.1: Manifest preserves timestamp across compilation passes';
    const plugin = new LitWebpackPlugin({
      ssr: {
        manifest: { fileName: 'ssr-manifest.json' },
      },
    });

    const assetsEmitted = new Map();
    let initialTimestamp = null;
    let secondTimestamp = null;

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
              source: () => `customElements.define('test-el', class extends HTMLElement {});`,
            },
          };
        }
        if (assetsEmitted.has(file)) {
          return { source: assetsEmitted.get(file) };
        }
        return null;
      },
      emitAsset(fileName, source) {
        assetsEmitted.set(fileName, source);
      },
      updateAsset(fileName, source) {
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
      options: { target: 'node', module: { rules: [] }, mode: 'production' },
      webpack: {
        Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: 100 },
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
      // Pass 1
      await processAssetsHandler({});
      const manifest1 = JSON.parse(assetsEmitted.get('ssr-manifest.json').source());
      initialTimestamp = manifest1.metadata.timestamp;

      // Small delay
      await new Promise((r) => setTimeout(r, 20));

      // Pass 2
      await processAssetsHandler({});
      const manifest2 = JSON.parse(assetsEmitted.get('ssr-manifest.json').source());
      secondTimestamp = manifest2.metadata.timestamp;

      if (initialTimestamp && initialTimestamp === secondTimestamp) {
        record(name, 'PASS', `Timestamp deterministically preserved: ${initialTimestamp}`);
      } else {
        record(name, 'FAIL', `Timestamp changed across passes: pass1=${initialTimestamp}, pass2=${secondTimestamp}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Threw during manifest determinism test: ${err.message}`);
    }
  }

  // Test 3.2: Custom basePath configuration (CDN prefix)
  {
    const name = '3.2: Custom manifest.basePath correctly prefixes assets';
    const cdnBase = 'https://cdn.example.org/static/';
    const plugin = new LitWebpackPlugin({
      ssr: {
        manifest: {
          fileName: 'ssr-manifest.json',
          basePath: cdnBase,
        },
      },
    });

    const assetsEmitted = new Map();
    const mockCompilation = {
      outputOptions: { publicPath: '/default/' },
      chunks: [
        {
          name: 'bundle',
          files: new Set(['bundle.js', 'style.css']),
        },
      ],
      getAsset(file) {
        if (file === 'bundle.js') {
          return {
            source: {
              source: () => `customElements.define('cdn-el', class extends HTMLElement {});`,
            },
          };
        }
        return null;
      },
      emitAsset(fileName, source) {
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

    let handler = null;
    const mockCompiler = {
      options: { target: 'node', module: { rules: [] }, mode: 'production' },
      webpack: {
        Compilation: { PROCESS_ASSETS_STAGE_ADDITIONS: 100 },
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
              handler = fn;
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
      await handler({});
      const manifest = JSON.parse(assetsEmitted.get('ssr-manifest.json').source());
      const tagEntry = manifest.tags['cdn-el'];
      const metadataBase = manifest.metadata.basePath;

      if (tagEntry?.file?.startsWith(cdnBase) && metadataBase === cdnBase) {
        record(name, 'PASS', `Manifest correctly prefixed files with ${cdnBase}`);
      } else {
        record(name, 'FAIL', `Failed to prefix: file=${tagEntry?.file}, metadataBase=${metadataBase}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Threw during custom basePath test: ${err.message}`);
    }
  }

  // =========================================================================
  // GROUP 4: VIRTUAL MODULE RESOLUTION WITH QUERY PARAMETERS
  // =========================================================================
  console.log('\n--- GROUP 4: Virtual module resolution with query parameters ---');

  // Test 4.1: Webpack extractLitCoreVirtualSubpath with multiple queries and extensions
  {
    const name = '4.1: Webpack extractLitCoreVirtualSubpath query parameter stripping';
    const testCases = [
      { input: 'virtual:lit-core/ssr-runtime?ssr=1&v=2', expected: 'ssr-runtime' },
      { input: '\0virtual:lit-core/islands-loader.js?worker=true', expected: 'islands-loader' },
      { input: 'virtual:lit-core/resumable-adapter.js?scope=app', expected: 'resumable-adapter' },
      { input: '\0virtual:lit-core/dom-paths.ts?inline=1', expected: 'dom-paths' },
    ];

    let allPassed = true;
    for (const tc of testCases) {
      const actual = webpackExtractSubpath(tc.input);
      if (actual !== tc.expected) {
        allPassed = false;
        record(name, 'FAIL', `For ${tc.input}: expected ${tc.expected}, got ${actual}`);
        break;
      }
    }
    if (allPassed) {
      record(name, 'PASS', 'Webpack extractLitCoreVirtualSubpath stripped queries and extensions correctly');
    }
  }

  // Test 4.2: Vite extractLitCoreVirtualSubpath with multiple queries and extensions
  {
    const name = '4.2: Vite extractLitCoreVirtualSubpath query parameter stripping';
    const testCases = [
      { input: 'virtual:lit-core/ssr-runtime?ssr=1', expected: 'ssr-runtime' },
      { input: '\0virtual:lit-core/islands-loader.js?mode=test', expected: 'islands-loader' },
      { input: 'virtual:lit-core/native-runtime.js?dev=1', expected: 'native-runtime' },
    ];

    let allPassed = true;
    for (const tc of testCases) {
      const actual = viteExtractSubpath(tc.input);
      if (actual !== tc.expected) {
        allPassed = false;
        record(name, 'FAIL', `For ${tc.input}: expected ${tc.expected}, got ${actual}`);
        break;
      }
    }
    if (allPassed) {
      record(name, 'PASS', 'Vite extractLitCoreVirtualSubpath stripped queries and extensions correctly');
    }
  }

  // Test 4.3: Vite plugin resolveId and load hooks with resource queries
  {
    const name = '4.3: Vite plugin resolveId and load hooks with query parameters';
    const plugins = viteLit({ ssr: true });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');

    try {
      const resolvedSsr = ssrPlugin.resolveId('virtual:lit-core/ssr-runtime?ssr=1&chunk=main');
      const loadedSsr = ssrPlugin.load(resolvedSsr);

      const resolvedIslands = ssrPlugin.resolveId('virtual:lit-core/islands-loader?defer=1');
      const loadedIslands = ssrPlugin.load(resolvedIslands);

      const ssrHasContent = loadedSsr?.code?.includes('render');
      const islandsHasContent = loadedIslands?.code?.includes('hydrate');

      if (ssrHasContent && islandsHasContent) {
        record(name, 'PASS', 'Vite plugin resolved and loaded virtual modules with queries');
      } else {
        record(name, 'FAIL', `Vite plugin failed to load: ssr=${ssrHasContent}, islands=${islandsHasContent}`);
      }
    } catch (err) {
      record(name, 'FAIL', `Vite plugin hooks threw: ${err.message}`);
    }
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=========================================================================');
  console.log(`TOTAL ADVERSARIAL TESTS: ${results.passed.length + results.failed.length}`);
  console.log(`PASSED: ${results.passed.length}`);
  console.log(`FAILED: ${results.failed.length}`);
  console.log('=========================================================================');

  cleanup();
  return results;
}

runAdversarialStressSuite()
  .then((results) => {
    if (results.failed.length > 0) {
      console.log(`\n❌ ADVERSARIAL STRESS CHALLENGES DETECTED ${results.failed.length} VULNERABILITIES.`);
      process.exit(1);
    } else {
      console.log('\n🎉 ALL ADVERSARIAL STRESS CHALLENGES PASSED.');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Suite crashed:', err);
    cleanup();
    process.exit(1);
  });
