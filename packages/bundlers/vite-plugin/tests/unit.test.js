import assert from 'node:assert';
import litDefault, {
  cssFuse,
  dirtyMask,
  domPaths,
  elemProxy,
  htmlFuse,
  htmlMinifier,
  LitCoreVitePlugin,
  lit,
  litCore,
  litCoreVitePlugin,
  litCssFuse,
  litDirtyMask,
  litDomPaths,
  litElemProxy,
  litHtmlMinifier,
  litPropsLower,
  litSsr,
  propsLower,
  reportTransformError,
  ssr,
  tagShake,
} from '../dist/index.js';

console.log('Testing @lit-core/vite-plugin hooks and exports...');

assert.strictEqual(typeof litCoreVitePlugin, 'function', 'litCoreVitePlugin must be a function');
assert.strictEqual(LitCoreVitePlugin, litCoreVitePlugin, 'LitCoreVitePlugin must be identical to litCoreVitePlugin');
assert.strictEqual(typeof lit, 'function', 'lit must be a function');
assert.strictEqual(lit, litDefault, 'default export must be lit');
assert.strictEqual(lit, litCore, 'litCore must be an alias for lit');
assert.strictEqual(lit, litCoreVitePlugin, 'lit must be an alias for litCoreVitePlugin');

assert.strictEqual(typeof cssFuse, 'function', 'cssFuse must be a function');
assert.strictEqual(typeof litCssFuse, 'function', 'litCssFuse must be an alias');
assert.strictEqual(typeof propsLower, 'function', 'propsLower must be a function');
assert.strictEqual(typeof litPropsLower, 'function', 'litPropsLower must be an alias');
assert.strictEqual(typeof elemProxy, 'function', 'elemProxy must be a function');
assert.strictEqual(typeof litElemProxy, 'function', 'litElemProxy must be an alias');
assert.strictEqual(typeof dirtyMask, 'function', 'dirtyMask must be a function');
assert.strictEqual(typeof litDirtyMask, 'function', 'litDirtyMask must be an alias');
assert.strictEqual(typeof domPaths, 'function', 'domPaths must be a function');
assert.strictEqual(typeof litDomPaths, 'function', 'litDomPaths must be an alias');
assert.strictEqual(typeof htmlMinifier, 'function', 'htmlMinifier must be a function');
assert.strictEqual(typeof litHtmlMinifier, 'function', 'litHtmlMinifier must be an alias');
assert.strictEqual(typeof ssr, 'function', 'ssr must be a function');
assert.strictEqual(typeof litSsr, 'function', 'litSsr must be an alias');
assert.strictEqual(litSsr, ssr, 'litSsr must equal ssr');

// Test lit() default options: includes css-fuse
const defaultPlugins = lit();
assert(Array.isArray(defaultPlugins), 'lit() must return an array of plugins');
assert.strictEqual(defaultPlugins.length, 1, 'lit() by default includes 1 plugin (css-fuse)');
assert.strictEqual(defaultPlugins[0].name, 'css-fuse');

// Test lit({ cssFuse: false }): disables css-fuse
const disabledPlugins = lit({ cssFuse: false });
assert(Array.isArray(disabledPlugins));
assert.strictEqual(disabledPlugins.length, 0, 'lit({ cssFuse: false }) should not include css-fuse');

// Test lit({ propsLower: true }): includes props-lower
const propsPlugins = lit({ cssFuse: false, propsLower: true });
assert.strictEqual(propsPlugins.length, 1);
assert.strictEqual(propsPlugins[0].name, 'props-lower');

// Test lit({ htmlMinifier: true }): includes html-minifier
const minifierPlugins = lit({ cssFuse: false, htmlMinifier: true });
assert.strictEqual(minifierPlugins.length, 1);
assert.strictEqual(minifierPlugins[0].name, 'html-minifier');

// Test lit({ 'html-minifier': true }): kebab-case option
const kebabMinifierPlugins = lit({ cssFuse: false, 'html-minifier': true });
assert.strictEqual(kebabMinifierPlugins.length, 1);
assert.strictEqual(kebabMinifierPlugins[0].name, 'html-minifier');

// Test lit with all active
// Test lit with all active
const allPlugins = lit({ propsLower: true, htmlMinifier: true });
assert.strictEqual(allPlugins.length, 3);
assert.strictEqual(allPlugins[0].name, 'css-fuse');
assert.strictEqual(allPlugins[1].name, 'props-lower');
assert.strictEqual(allPlugins[2].name, 'html-minifier');

// Test Stage 3 ordering: dom-paths before dirty-mask
const stage3Plugins = lit({ cssFuse: false, dirtyMask: true, domPaths: true });
assert.strictEqual(stage3Plugins.length, 2);
assert.strictEqual(stage3Plugins[0].name, 'dom-paths');
assert.strictEqual(stage3Plugins[1].name, 'dirty-mask');
// Test lit({ dirtyMask: true }): includes dirty-mask
const dirtyMaskPlugins = lit({ cssFuse: false, dirtyMask: true });
assert.strictEqual(dirtyMaskPlugins.length, 1);
assert.strictEqual(dirtyMaskPlugins[0].name, 'dirty-mask');

// Test lit({ 'dirty-mask': true }): kebab-case option
const kebabDirtyMaskPlugins = lit({ cssFuse: false, 'dirty-mask': true });
assert.strictEqual(kebabDirtyMaskPlugins.length, 1);
assert.strictEqual(kebabDirtyMaskPlugins[0].name, 'dirty-mask');

// Test lit({ domPaths: true }): includes dom-paths
const domPathsPlugins = lit({ cssFuse: false, domPaths: true });
assert.strictEqual(domPathsPlugins.length, 1);
assert.strictEqual(domPathsPlugins[0].name, 'dom-paths');

// Test lit({ 'dom-paths': true }): kebab-case option
const kebabDomPathsPlugins = lit({ cssFuse: false, 'dom-paths': true });
assert.strictEqual(kebabDomPathsPlugins.length, 1);
assert.strictEqual(kebabDomPathsPlugins[0].name, 'dom-paths');

// Test full pipeline registration ordering
const fullPipelinePlugins = lit({
  propsLower: true,
  elemProxy: true,
  directives: true,
  cssFuse: true,
  domPaths: true,
  dirtyMask: true,
  htmlMinifier: true,
});
const pluginNames = fullPipelinePlugins.map((p) => p.name);
assert(pluginNames.indexOf('css-fuse') < pluginNames.indexOf('props-lower'), 'css-fuse must precede props-lower');
assert(pluginNames.indexOf('props-lower') < pluginNames.indexOf('elem-proxy'), 'props-lower must precede elem-proxy');
assert(pluginNames.indexOf('elem-proxy') < pluginNames.indexOf('directives'), 'elem-proxy must precede directives');
assert(pluginNames.indexOf('directives') < pluginNames.indexOf('dom-paths'), 'directives must precede dom-paths');
assert(pluginNames.indexOf('dom-paths') < pluginNames.indexOf('dirty-mask'), 'dom-paths must precede dirty-mask');
assert(pluginNames.indexOf('dirty-mask') < pluginNames.indexOf('html-minifier'), 'dirty-mask must precede html-minifier');

// Test standalone domPaths transform hook
const domPathsInstance = domPaths();
assert.strictEqual(domPathsInstance.name, 'dom-paths');
assert.strictEqual(domPathsInstance.enforce, 'pre');
assert.strictEqual(typeof domPathsInstance.transform, 'function');

const sampleDomPathsTemplate = `
  import { LitElement, html } from 'lit';
  export class TestComp extends LitElement {
    static properties = { count: { type: Number } };
    render() {
      return html\`<div><p>\${this.count}</p></div>\`;
    }
  }
`;
const transformedDomPaths = domPathsInstance.transform.call({}, sampleDomPathsTemplate, 'test-comp.ts');
assert(transformedDomPaths, 'domPaths transform should return result');
assert(transformedDomPaths.code.includes('static __litPartPaths = ['), 'static __litPartPaths emitted on class');
assert(/\[\s*0,\s*0,\s*0\s*\]/.test(transformedDomPaths.code), 'path to count child part computed');
assert(!transformedDomPaths.code.includes('this.__litDomNodes'), 'instance DOM nodes array not cached on this');
assert(!transformedDomPaths.code.includes('this.updated?.(changedProperties)'), 'lifecycle updated hook not duplicated in update method');

// Verify dead code omission when fast update method cannot be built
const unacceleratedTemplate = `
  import { LitElement, html } from 'lit';
  export class BailoutComp extends LitElement {
    render() {
      return html\`<div><p>Count: \${this.count}</p><button @click=\${this.inc}>+</button></div>\`;
    }
  }
`;
const bailoutRes = domPathsInstance.transform.call({}, unacceleratedTemplate, 'bailout.ts');
assert.strictEqual(bailoutRes, null, 'domPaths should return null when fast update cannot be built');

// Test standalone dirtyMask transform hook
const dirtyMaskInstance = dirtyMask();
assert.strictEqual(dirtyMaskInstance.name, 'dirty-mask');
assert.strictEqual(dirtyMaskInstance.enforce, 'pre');
assert.strictEqual(typeof dirtyMaskInstance.transform, 'function');

const sampleDirtyTemplate = `
  import { LitElement, html } from 'lit';
  import { property } from 'lit/decorators.js';
  export class TestComp extends LitElement {
    @property({ type: Number }) count = 0;
    render() {
      return html\`<div>\${this.count}</div>\`;
    }
  }
`;
const transformedDirty = dirtyMaskInstance.transform.call({}, sampleDirtyTemplate, 'test-comp.ts');
assert(transformedDirty, 'dirtyMask transform should return result');
assert(transformedDirty.code.includes('this.__litDirtyMask & 1'), 'dirty mask short-circuit generated');
assert(transformedDirty.code.includes('noChange'), 'noChange imported and used');

// Test domPaths and dirtyMask composition without starvation
{
  const pDom = domPaths();
  const pDirty = dirtyMask();

  const componentSource = `
    import { LitElement, html } from 'lit';
    export class CounterComp extends LitElement {
      static properties = { count: { type: Number } };
      render() {
        return html\`<div><p>\${this.count}</p></div>\`;
      }
    }
  `;

  // Pipeline order: domPaths executes before dirtyMask
  const domResult = pDom.transform.call({}, componentSource, '/src/counter-comp.ts');
  assert(domResult, 'domPaths must transform qualifying component');
  assert(domResult.code.includes('static __litPartPaths = ['), 'domPaths must emit static __litPartPaths');

  const composedResult = pDirty.transform.call({}, domResult.code, '/src/counter-comp.ts');
  assert(composedResult, 'dirtyMask must transform domPaths output');
  assert(composedResult.code.includes('static __litPartPaths = ['), 'composed output must retain static __litPartPaths');
  assert(composedResult.code.includes('this.__litDirtyMask & 1'), 'composed output must contain __litDirtyMask check');
  assert(composedResult.code.includes('noChange'), 'composed output must import/use noChange');
  assert(!composedResult.code.includes('this.updated?.(changedProperties)'), 'composed output must not duplicate updated callback');

  // Verify reverse order (dirtyMask before domPaths) starves domPaths
  const dirtyFirst = pDirty.transform.call({}, componentSource, '/src/counter-comp.ts');
  assert(dirtyFirst, 'dirtyMask transforms original component');
  const domAfterDirty = pDom.transform.call({}, dirtyFirst.code, '/src/counter-comp.ts');
  assert.strictEqual(domAfterDirty, null, 'domPaths must return null when dirtyMask update() already exists');
}

// Test cssFuse and propsLower composition without decorator lowering erasure
{
  const pProps = propsLower();

  const fusedCode = `
    import { LitElement, css } from 'lit';
    import { customElement, property } from 'lit/decorators.js';
    import { _fused_sheet1 } from 'virtual:css-fuse/_fused_sheet1.js';

    @customElement('fused-btn')
    export class FusedBtn extends LitElement {
      static styles = [_fused_sheet1, css\`
        .btn { color: red; }
      \`];
      @property({ type: String }) label = 'Submit';
    }
  `;

  // In Vite pipeline, propsLower processes code output by cssFuse
  const loweredResult = pProps.transform.call({}, fusedCode, '/src/fused-btn.ts');
  assert(loweredResult, 'propsLower must transform fused code');
  assert(!loweredResult.code.includes('@customElement'), 'decorators must be stripped from fused component');
  assert(!loweredResult.code.includes('@property'), '@property decorator must be lowered');
  assert(loweredResult.code.includes('static properties = {'), 'static properties must be emitted');
  assert(loweredResult.code.includes('customElements.define("fused-btn", FusedBtn)'), 'customElements.define must be emitted');
  assert(loweredResult.code.includes('_fused_sheet1'), 'shared constructable sheet import must be preserved');
  assert(loweredResult.code.includes('static styles = [_fused_sheet1'), 'fused static styles array must remain intact');
}

// Test full multi-stage pipeline chaining (cssFuse -> propsLower -> domPaths -> dirtyMask)
{
  const pProps = propsLower();
  const pDom = domPaths();
  const pDirty = dirtyMask();

  const fusedComponentSource = `
    import { LitElement, html, css } from 'lit';
    import { customElement, property } from 'lit/decorators.js';
    import { _fused_sheet } from 'virtual:css-fuse/_fused_sheet.js';

    @customElement('fused-card')
    export class FusedCard extends LitElement {
      static styles = [_fused_sheet, css\`.card { padding: 8px; }\`];
      @property({ type: Number }) count = 0;
      render() {
        return html\`<div><p>\${this.count}</p></div>\`;
      }
    }
  `;

  // Step 1: propsLower lowers decorators into static properties
  const stage1 = pProps.transform.call({}, fusedComponentSource, '/src/fused-card.ts');
  assert(stage1, 'propsLower must succeed');
  assert(!stage1.code.includes('@property'), 'decorators lowered');
  assert(stage1.code.includes('static properties'), 'static properties emitted');

  // Step 2: domPaths compiles template part indices
  const stage2 = pDom.transform.call({}, stage1.code, '/src/fused-card.ts');
  assert(stage2, 'domPaths must succeed on lowered component');
  assert(stage2.code.includes('static __litPartPaths'), 'static __litPartPaths emitted');

  // Step 3: dirtyMask injects bitmask into update() method
  const stage3 = pDirty.transform.call({}, stage2.code, '/src/fused-card.ts');
  assert(stage3, 'dirtyMask must succeed on domPaths output');
  assert(stage3.code.includes('static __litPartPaths'), 'dom paths preserved');
  assert(stage3.code.includes('this.__litDirtyMask & 1'), 'dirty mask short-circuit emitted');
  assert(stage3.code.includes('customElements.define'), 'customElements.define preserved');
  assert(stage3.code.includes('_fused_sheet'), 'fused sheet preserved');
}

// Test standalone htmlMinifier transform hook
const htmlMinifierInstance = htmlMinifier();
assert.strictEqual(htmlMinifierInstance.name, 'html-minifier');
assert.strictEqual(htmlMinifierInstance.enforce, 'pre');
assert.strictEqual(typeof htmlMinifierInstance.transform, 'function');

const sampleTemplate = `
  import { html } from 'lit';
  export const tpl = html\`
    <div class="test">
      <!-- comment to remove -->
      <span>Hello Lit</span>
    </div>
  \`;
`;
const transformedTpl = htmlMinifierInstance.transform.call({}, sampleTemplate, '/src/my-comp.ts');
assert(transformedTpl, 'transform should return collapsed template code');
assert(!transformedTpl.code.includes('comment to remove'), 'comment should be stripped');
assert(transformedTpl.code.includes('<div class="test"><span>Hello Lit</span></div>'), 'tags whitespace collapsed');

// Test standalone propsLower transform hook
const propsPluginInstance = propsLower();
assert.strictEqual(propsPluginInstance.name, 'props-lower');
assert.strictEqual(propsPluginInstance.enforce, 'pre');
assert.strictEqual(typeof propsPluginInstance.transform, 'function');

const sampleLitDecorators = `
  import { LitElement } from 'lit';
  import { customElement, property } from 'lit/decorators.js';

  @customElement('x-btn')
  class XBtn extends LitElement {
    @property() label = 'click';
  }
`;
const transformed = propsPluginInstance.transform.call({}, sampleLitDecorators, '/src/x-btn.ts');
assert(transformed, 'transform should return lowered code');
assert(!transformed.code.includes('@customElement'), 'decorators should be stripped');
assert(transformed.code.includes('customElements.define("x-btn", XBtn)'), 'customElements.define emitted');
assert(transformed.code.includes('static properties'), 'static properties emitted');

// Test standalone elemProxy transform hook
const elemProxyInstance = elemProxy();
assert.strictEqual(elemProxyInstance.name, 'elem-proxy');
assert.strictEqual(elemProxyInstance.enforce, 'pre');
assert.strictEqual(typeof elemProxyInstance.transform, 'function');

const sampleElemProxy = `
  import { LitElement } from 'lit';
  import { customElement, property } from 'lit/decorators.js';

  @customElement('proxy-btn')
  class ProxyBtn extends LitElement {
    @property({ type: String, attribute: 'btn-label' }) label = 'click';
  }
`;
const transformedProxy = elemProxyInstance.transform.call({}, sampleElemProxy, '/src/proxy-btn.ts');
assert(transformedProxy, 'transform should return proxied code');
assert(transformedProxy.code.includes('ProxyBtnProxy'), 'proxy stub emitted');
assert(transformedProxy.code.includes('__getImpl_ProxyBtn'), 'deferred getter emitted');
assert(
  transformedProxy.code.includes('customElements.define("proxy-btn", ProxyBtnProxy)') || transformedProxy.code.includes("customElements.define('proxy-btn', ProxyBtnProxy)"),
  'customElements.define emitted',
);

// Test standalone cssFuse() plugin
const plugin = cssFuse();
assert.strictEqual(plugin.name, 'css-fuse');
assert.strictEqual(plugin.enforce, 'pre');
assert.strictEqual(typeof plugin.buildStart, 'function');
assert.strictEqual(typeof plugin.resolveId, 'function');
assert.strictEqual(typeof plugin.load, 'function');
assert.strictEqual(typeof plugin.transform, 'function');
assert.strictEqual(typeof plugin.renderChunk, 'function');
assert.strictEqual(typeof plugin.handleHotUpdate, 'function');

// Test resolveId for standard virtual module
const v1 = plugin.resolveId.call({}, 'virtual:css-fuse/_fused_abc.js');
assert.strictEqual(v1, '\0virtual:css-fuse/_fused_abc.js');

// Test resolveId for legacy virtual module
const vLegacy = plugin.resolveId.call({}, 'virtual:lit-css-fuse/_fused_abc.js');
assert.strictEqual(vLegacy, '\0virtual:css-fuse/_fused_abc.js');

// Test resolveId for legacy format
const v2 = plugin.resolveId.call({}, '_fused_abc');
assert.strictEqual(v2, '\0virtual:css-fuse/_fused_abc.js');

const regularResolved = plugin.resolveId.call({}, 'regular-file.ts');
assert.strictEqual(regularResolved, undefined);

// Test virtual:lit-core/* module resolution and loading
const vAdapter = plugin.resolveId.call({}, 'virtual:lit-core/resumable-adapter');
assert.strictEqual(vAdapter, '\0virtual:lit-core/resumable-adapter');
const loadedAdapter = plugin.load.call({}, '\0virtual:lit-core/resumable-adapter');
assert(loadedAdapter?.code.includes('installResumableAdapter'), 'resumable adapter code loaded');

const vNative = plugin.resolveId.call({}, 'virtual:lit-core/native-runtime');
assert.strictEqual(vNative, '\0virtual:lit-core/native-runtime');
const loadedNative = plugin.load.call({}, '\0virtual:lit-core/native-runtime');
assert(loadedNative?.code.includes('NativeElement'), 'native runtime code loaded');

const vDomPaths = plugin.resolveId.call({}, 'virtual:lit-core/dom-paths');
assert.strictEqual(vDomPaths, '\0virtual:lit-core/dom-paths');
const loadedDomPaths = plugin.load.call({}, '\0virtual:lit-core/dom-paths');
assert(loadedDomPaths?.code.includes('preparePartsWithPaths'), 'dom paths code loaded');

// Test bare client/runtime import redirection
const vBareAdapter = plugin.resolveId.call({}, '@lit-core/resumable/client');
assert.strictEqual(vBareAdapter, '\0virtual:lit-core/resumable-adapter.js');
const vBareNative = plugin.resolveId.call({}, '@lit-core/native/runtime');
assert.strictEqual(vBareNative, '\0virtual:lit-core/native-runtime.js');
const vBareDomPaths = plugin.resolveId.call({}, '@lit-core/dom-paths/client');
assert.strictEqual(vBareDomPaths, '\0virtual:lit-core/dom-paths.js');

// Test SSR plugin inclusion via lit({ ssr: true })
const ssrPlugins = lit({ cssFuse: false, ssr: true });
assert.strictEqual(ssrPlugins.length, 1);
assert.strictEqual(ssrPlugins[0].name, 'lit-ssr');

// Test SSR plugin inclusion via kebab-case
const kebabSsrPlugins = lit({ cssFuse: false, 'lit-ssr': true });
assert.strictEqual(kebabSsrPlugins.length, 1);
assert.strictEqual(kebabSsrPlugins[0].name, 'lit-ssr');

// Test standalone ssr() plugin hooks
const standaloneSsr = ssr({ streaming: true, prerender: true, islands: true });
assert.strictEqual(standaloneSsr.name, 'lit-ssr');
assert.strictEqual(typeof standaloneSsr.resolveId, 'function');
assert.strictEqual(typeof standaloneSsr.load, 'function');
assert.strictEqual(typeof standaloneSsr.transform, 'function');
assert.strictEqual(typeof standaloneSsr.transformIndexHtml, 'function');
assert.strictEqual(typeof standaloneSsr.generateBundle, 'function');
assert.strictEqual(typeof standaloneSsr.configureServer, 'function');

// Test virtual:lit-core/ssr-runtime and virtual:lit-core/islands-loader resolution and loading
const vSsr = standaloneSsr.resolveId.call({}, 'virtual:lit-core/ssr-runtime');
assert.strictEqual(vSsr, '\0virtual:lit-core/ssr-runtime.js');
const loadedSsr = standaloneSsr.load.call({}, '\0virtual:lit-core/ssr-runtime.js');
assert(loadedSsr?.code.includes('render'), 'ssr runtime code loaded');

const vIslands = standaloneSsr.resolveId.call({}, 'virtual:lit-core/islands-loader');
assert.strictEqual(vIslands, '\0virtual:lit-core/islands-loader.js');
const loadedIslands = standaloneSsr.load.call({}, '\0virtual:lit-core/islands-loader.js');
assert(loadedIslands?.code.includes('hydrate'), 'islands loader code loaded');

const vBareSsr = standaloneSsr.resolveId.call({}, '@lit-core/ssr/client');
assert.strictEqual(vBareSsr, '\0virtual:lit-core/ssr-runtime.js');

console.log('✓ Vite plugin hooks and options verified successfully.');

// Test strict error reporting and benign non-matches
console.log('Testing Vite plugin strict error reporting...');

// 1. props-lower: transform failure triggers build error with location and file ID
{
  const p = propsLower({ sourcemap: 'invalid' });
  let reportedError = null;
  const mockContext = {
    error(err) {
      reportedError = err;
      const error = new Error(err.message || String(err));
      Object.assign(error, err);
      throw error;
    },
    warn() {},
  };

  const code = `
    import { LitElement } from 'lit';
    import { property } from 'lit/decorators.js';
    class MyComp extends LitElement {
      @property() label = 'hello';
    }
  `;

  assert.throws(
    () => p.transform.call(mockContext, code, '/src/broken-comp.ts'),
    (err) => err.message.includes('[props-lower]') && err.message.includes('/src/broken-comp.ts'),
    'props-lower must throw build error identifying transform and file',
  );
  assert(reportedError, 'error callback on plugin context must be invoked');
  assert.strictEqual(reportedError.id, '/src/broken-comp.ts', 'error payload must contain clean file id');
}

// 2. props-lower: benign non-matching code returns null cleanly
{
  const p = propsLower();
  let errorReported = false;
  const mockContext = {
    error() {
      errorReported = true;
    },
    warn() {},
  };
  const cleanCode = `export function add(a: number, b: number): number { return a + b; }`;
  const result = p.transform.call(mockContext, cleanCode, '/src/math.ts');
  assert.strictEqual(result, null, 'benign non-match must return null');
  assert.strictEqual(errorReported, false, 'benign non-match must not report error');
}

// 3. css-fuse: optimization failure in buildStart invokes this.error
{
  const p = cssFuse({ include: 123 });
  p.configResolved({ command: 'build', logger: { info() {}, error() {}, warn() {} } });
  let reportedError = null;
  const mockContext = {
    error(err) {
      reportedError = err;
      const error = new Error(err.message || String(err));
      Object.assign(error, err);
      throw error;
    },
    warn() {},
  };
  assert.throws(
    () => p.buildStart.call(mockContext),
    (err) => err.message.includes('[css-fuse] Optimization pass failed'),
    'css-fuse must halt build when optimization fails',
  );
  assert(reportedError, 'error callback must be invoked in buildStart');
}

// 4. html-fuse: optimization failure in buildStart invokes this.error
{
  const p = htmlFuse({ include: 123 });
  p.configResolved({ command: 'build', logger: { info() {}, error() {}, warn() {} } });
  let reportedError = null;
  const mockContext = {
    error(err) {
      reportedError = err;
      const error = new Error(err.message || String(err));
      Object.assign(error, err);
      throw error;
    },
    warn() {},
  };
  assert.throws(
    () => p.buildStart.call(mockContext),
    (err) => err.message.includes('[html-fuse] Optimization pass failed'),
    'html-fuse must halt build when optimization fails',
  );
  assert(reportedError, 'error callback must be invoked in buildStart');
}

// 5. extractErrorLocation and reportTransformError: source location extraction
{
  let capturedError = null;
  const mockContext = {
    error(err) {
      capturedError = err;
      const error = new Error(err.message || String(err));
      Object.assign(error, err);
      throw error;
    },
  };

  const syntheticErr = {
    message: 'Parse error at line 42, column 15',
    line: 42,
    column: 15,
  };

  assert.throws(
    () => reportTransformError(mockContext, 'test-plugin', '/src/sample.ts', syntheticErr),
    (err) => err.message.includes('[test-plugin] Transform failed for /src/sample.ts: Parse error at line 42, column 15'),
  );

  assert(capturedError, 'error must be captured');
  assert.strictEqual(capturedError.id, '/src/sample.ts');
  assert.deepStrictEqual(capturedError.loc, { line: 42, column: 15 });

  // Standalone call without context.error throws standard Error
  assert.throws(
    () => reportTransformError({}, 'standalone-plugin', '/src/sample.ts', new Error('boom')),
    (err) => err.message.includes('[standalone-plugin] Transform failed for /src/sample.ts: boom'),
    'must throw fallback error when context.error is not defined',
  );
}

// 6. tag-shake: transform failure invokes reportTransformError
{
  const p = tagShake({ sourcemap: 123 });
  let reportedError = null;
  const mockContext = {
    error(err) {
      reportedError = err;
      const error = new Error(err.message || String(err));
      Object.assign(error, err);
      throw error;
    },
    warn() {},
  };
  assert.throws(
    () => p.transform.call(mockContext, 'customElements.define("x-el", XEl);', '/src/x-el.ts'),
    (err) => err.message.includes('[tag-shake]'),
    'tag-shake must throw on transform error',
  );
  assert(reportedError, 'error callback must be invoked');
  assert.strictEqual(reportedError.id, '/src/x-el.ts');
}

console.log('✓ Vite plugin strict error reporting verified successfully.');
