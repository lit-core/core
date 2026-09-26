import assert from 'node:assert';
import litDefault, { cssFuse, htmlMinifier, lit, litCore, litCssFuse, litHtmlMinifier, litPropsLower, propsLower } from './dist/index.js';

console.log('Testing @lit-core/vite-plugin hooks and exports...');

assert.strictEqual(typeof lit, 'function', 'lit must be a function');
assert.strictEqual(lit, litDefault, 'default export must be lit');
assert.strictEqual(lit, litCore, 'litCore must be an alias for lit');
assert.strictEqual(typeof cssFuse, 'function', 'cssFuse must be a function');
assert.strictEqual(typeof litCssFuse, 'function', 'litCssFuse must be an alias');
assert.strictEqual(typeof propsLower, 'function', 'propsLower must be a function');
assert.strictEqual(typeof litPropsLower, 'function', 'litPropsLower must be an alias');
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

console.log('✓ Vite plugin hooks and options verified successfully.');
