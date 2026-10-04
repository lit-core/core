import assert from 'node:assert';
import litDefault, {
  cssFuse,
  dirtyMask,
  domPaths,
  elemProxy,
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
  propsLower,
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
const allPlugins = lit({ propsLower: true, htmlMinifier: true });
assert.strictEqual(allPlugins.length, 3);
assert.strictEqual(allPlugins[0].name, 'css-fuse');
assert.strictEqual(allPlugins[1].name, 'props-lower');
assert.strictEqual(allPlugins[2].name, 'html-minifier');

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

// Test standalone domPaths transform hook
const domPathsInstance = domPaths();
assert.strictEqual(domPathsInstance.name, 'dom-paths');
assert.strictEqual(domPathsInstance.enforce, 'pre');
assert.strictEqual(typeof domPathsInstance.transform, 'function');

const sampleDomPathsTemplate = `
  import { LitElement, html } from 'lit';
  export class TestComp extends LitElement {
    render() {
      return html\`<div><p>Count: \${this.count}</p><button @click=\${this.inc}>+</button></div>\`;
    }
  }
`;
const transformedDomPaths = domPathsInstance.transform.call({}, sampleDomPathsTemplate, 'test-comp.ts');
assert(transformedDomPaths, 'domPaths transform should return result');
assert(transformedDomPaths.code.includes('static __litPartPaths = ['), 'static __litPartPaths emitted on class');
assert(/\[\s*0,\s*0,\s*1\s*\]/.test(transformedDomPaths.code), 'path to count child part computed');
assert(transformedDomPaths.code.includes('[0, 1]') || /\[\s*0,\s*1\s*\]/.test(transformedDomPaths.code), 'path to button attribute computed');

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

console.log('✓ Vite plugin hooks and options verified successfully.');
