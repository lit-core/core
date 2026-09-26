import assert from 'node:assert';
import litDefault, { lit, litCore, cssFuse, litCssFuse, propsLower, litPropsLower } from './dist/index.js';

console.log('Testing @lit-core/vite-plugin hooks and exports...');

assert.strictEqual(typeof lit, 'function', 'lit must be a function');
assert.strictEqual(lit, litDefault, 'default export must be lit');
assert.strictEqual(lit, litCore, 'litCore must be an alias for lit');
assert.strictEqual(typeof cssFuse, 'function', 'cssFuse must be a function');
assert.strictEqual(typeof litCssFuse, 'function', 'litCssFuse must be an alias');
assert.strictEqual(typeof propsLower, 'function', 'propsLower must be a function');
assert.strictEqual(typeof litPropsLower, 'function', 'litPropsLower must be an alias');

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

// Test lit({ 'props-lower': true }): kebab-case option
const kebabPlugins = lit({ cssFuse: false, 'props-lower': true });
assert.strictEqual(kebabPlugins.length, 1);
assert.strictEqual(kebabPlugins[0].name, 'props-lower');

// Test lit with both active
const bothPlugins = lit({ propsLower: true });
assert.strictEqual(bothPlugins.length, 2);
assert.strictEqual(bothPlugins[0].name, 'css-fuse');
assert.strictEqual(bothPlugins[1].name, 'props-lower');

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

