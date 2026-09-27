import assert from 'node:assert';
import litDefault, {
  CssFuseWebpackPlugin,
  CssMinifierWebpackPlugin,
  cssFuse,
  cssMinifier,
  ElemProxyWebpackPlugin,
  elemProxy,
  HtmlMinifierWebpackPlugin,
  htmlMinifier,
  LitWebpackPlugin,
  lit,
  litCore,
  litCssFuse,
  litCssMinifier,
  litElemProxy,
  litHtmlMinifier,
  litPropsLower,
  litWebpackLoader,
  PropsLowerWebpackPlugin,
  propsLower,
} from './dist/index.js';
import { transformCssMinifier, transformElemProxy, transformHtmlMinifier, transformPropsLower } from './dist/transforms.js';
import { extractSheetId, formatVirtualId, isVirtualFusedId } from './dist/utils.js';

console.log('Testing @lit-core/webpack-plugin exports, classes, and transforms...');

// 1. Verify export signatures
assert.strictEqual(typeof lit, 'function', 'lit must be a function');
assert.strictEqual(lit, litDefault, 'default export must be lit');
assert.strictEqual(lit, litCore, 'litCore must be an alias for lit');
assert.strictEqual(typeof cssFuse, 'function', 'cssFuse must be a function');
assert.strictEqual(typeof litCssFuse, 'function', 'litCssFuse must be an alias');
assert.strictEqual(typeof propsLower, 'function', 'propsLower must be a function');
assert.strictEqual(typeof litPropsLower, 'function', 'litPropsLower must be an alias');
assert.strictEqual(typeof elemProxy, 'function', 'elemProxy must be a function');
assert.strictEqual(typeof litElemProxy, 'function', 'litElemProxy must be an alias');
assert.strictEqual(typeof htmlMinifier, 'function', 'htmlMinifier must be a function');
assert.strictEqual(typeof litHtmlMinifier, 'function', 'litHtmlMinifier must be an alias');
assert.strictEqual(typeof cssMinifier, 'function', 'cssMinifier must be a function');
assert.strictEqual(typeof litCssMinifier, 'function', 'litCssMinifier must be an alias');
assert.strictEqual(typeof litWebpackLoader, 'function', 'litWebpackLoader must be exported');

// 2. Verify classes
assert.strictEqual(typeof LitWebpackPlugin, 'function', 'LitWebpackPlugin class must exist');
assert.strictEqual(typeof CssFuseWebpackPlugin, 'function', 'CssFuseWebpackPlugin class must exist');
assert.strictEqual(typeof PropsLowerWebpackPlugin, 'function', 'PropsLowerWebpackPlugin class must exist');
assert.strictEqual(typeof ElemProxyWebpackPlugin, 'function', 'ElemProxyWebpackPlugin class must exist');
assert.strictEqual(typeof HtmlMinifierWebpackPlugin, 'function', 'HtmlMinifierWebpackPlugin class must exist');
assert.strictEqual(typeof CssMinifierWebpackPlugin, 'function', 'CssMinifierWebpackPlugin class must exist');

// 3. Test lit() default options and class inheritance
const defaultPlugin = lit();
assert(defaultPlugin instanceof LitWebpackPlugin, 'lit() must return LitWebpackPlugin instance');
assert.strictEqual(typeof defaultPlugin.apply, 'function', 'Plugin instance must have apply method');
assert.strictEqual(defaultPlugin.options.cssFuse, true, 'Default cssFuse should be true');

// 4. Test iterable support (spread operator)
const spread = [...lit()];
assert.strictEqual(spread.length, 1, 'Spreading lit() must yield 1 plugin');
assert.strictEqual(spread[0] instanceof LitWebpackPlugin, true, 'Spread element must be LitWebpackPlugin');

// 5. Test options configurations
const disabled = lit({ cssFuse: false });
assert.strictEqual(disabled.options.cssFuse, false);

const propsPlugin = lit({ cssFuse: false, propsLower: true });
assert.strictEqual(propsPlugin.options.propsLower, true);

const kebabPropsPlugin = lit({ cssFuse: false, 'props-lower': true });
assert.strictEqual(kebabPropsPlugin.options['props-lower'], true);

const htmlPlugin = lit({ cssFuse: false, htmlMinifier: true });
assert.strictEqual(htmlPlugin.options.htmlMinifier, true);

const kebabHtmlPlugin = lit({ cssFuse: false, 'html-minifier': true });
assert.strictEqual(kebabHtmlPlugin.options['html-minifier'], true);

const cssMinPlugin = lit({ cssFuse: false, cssMinifier: true });
assert.strictEqual(cssMinPlugin.options.cssMinifier, true);

const kebabCssMinPlugin = lit({ cssFuse: false, 'css-minifier': true });
assert.strictEqual(kebabCssMinPlugin.options['css-minifier'], true);

// 6. Test granular plugin factories
const standaloneFuse = cssFuse({ threshold: 3 });
assert(standaloneFuse instanceof CssFuseWebpackPlugin);
assert(standaloneFuse instanceof LitWebpackPlugin);
assert.strictEqual(standaloneFuse.options.cssFuse?.threshold, 3);
assert.strictEqual(standaloneFuse.options.propsLower, false);

const standaloneProps = propsLower({ sourcemap: false });
assert(standaloneProps instanceof PropsLowerWebpackPlugin);
assert.strictEqual(standaloneProps.options.cssFuse, false);
assert.strictEqual(standaloneProps.options.propsLower?.sourcemap, false);

const standaloneHtml = htmlMinifier({ sourcemap: false });
assert(standaloneHtml instanceof HtmlMinifierWebpackPlugin);
assert.strictEqual(standaloneHtml.options.cssFuse, false);

const standaloneCss = cssMinifier({ sourcemap: true });
assert(standaloneCss instanceof CssMinifierWebpackPlugin);
assert.strictEqual(standaloneCss.options.cssFuse, false);

// 7. Test transformHtmlMinifier
const sampleTemplate = `
  import { html } from 'lit';
  export const tpl = html\`
    <div class="test">
      <!-- comment to remove -->
      <span>Hello Webpack</span>
    </div>
  \`;
`;
const transformedHtml = transformHtmlMinifier(sampleTemplate, '/src/my-comp.ts');
assert(transformedHtml, 'transformHtmlMinifier should return transformed code');
assert(!transformedHtml.code.includes('comment to remove'), 'HTML comments must be stripped');
assert(transformedHtml.code.includes('<div class="test"><span>Hello Webpack</span></div>'), 'Tags whitespace collapsed');

// 8. Test transformPropsLower
const sampleLitDecorators = `
  import { LitElement } from 'lit';
  import { customElement, property } from 'lit/decorators.js';

  @customElement('wp-btn')
  class WpBtn extends LitElement {
    @property() label = 'click';
  }
`;
const transformedProps = transformPropsLower(sampleLitDecorators, '/src/wp-btn.ts');
assert(transformedProps, 'transformPropsLower should return lowered code');
assert(!transformedProps.code.includes('@customElement'), 'Decorators should be stripped');
assert(transformedProps.code.includes('customElements.define("wp-btn", WpBtn)'), 'customElements.define emitted');
assert(transformedProps.code.includes('static properties'), 'static properties emitted');

// 9. Test transformElemProxy
const sampleElemProxy = `
  import { LitElement } from 'lit';
  import { customElement, property } from 'lit/decorators.js';

  @customElement('wp-proxy-btn')
  class WpProxyBtn extends LitElement {
    @property() label = 'click';
  }
`;
const transformedProxy = transformElemProxy(sampleElemProxy, '/src/wp-proxy-btn.ts');
assert(transformedProxy, 'transformElemProxy should return proxied code');
assert(transformedProxy.code.includes('WpProxyBtnProxy'), 'proxy stub emitted');
assert(transformedProxy.code.includes("customElements.define('wp-proxy-btn', WpProxyBtnProxy)"), 'customElements.define emitted');

// 10. Test transformCssMinifier
const sampleLitCss = `
  import { css } from 'lit';
  export const styles = css\`
    :host {
      display: flex;
      margin: 10px 10px 10px 10px;
    }
  \`;
`;
const transformedCss = transformCssMinifier(sampleLitCss, '/src/styles.ts');
assert(transformedCss, 'transformCssMinifier should return minified CSS');
assert(transformedCss.code.includes('margin:10px') || transformedCss.code.includes('margin: 10px'), 'CSS should be minified');

// 10. Test virtual ID utilities
assert(isVirtualFusedId('virtual:css-fuse/_fused_xyz.js'), 'virtual:css-fuse must be virtual ID');
assert(isVirtualFusedId('virtual:lit-css-fuse/_fused_xyz.js'), 'legacy prefix must be virtual ID');
assert(isVirtualFusedId('_fused_xyz'), '_fused_ must be virtual ID');
assert(!isVirtualFusedId('src/components/button.ts'), 'Normal file is not virtual ID');

assert.strictEqual(formatVirtualId('virtual:css-fuse/_fused_123.js'), '\0virtual:css-fuse/_fused_123.js');
assert.strictEqual(extractSheetId('\0virtual:css-fuse/_fused_123.js'), '_fused_123.js');
assert.strictEqual(extractSheetId('virtual:css-fuse/_fused_123.js'), '_fused_123.js');

// 11. Test loader directly with a mock loader context
let loaderResult = null;
const mockLoaderContext = {
  resourcePath: '/src/comp.ts',
  getOptions() {
    return {
      options: {
        propsLower: true,
        htmlMinifier: true,
        cssFuse: false,
      },
    };
  },
  async() {
    return (err, code, map) => {
      if (err) throw err;
      loaderResult = { code, map };
    };
  },
};

const compSource = `
  import { LitElement, html } from 'lit';
  import { customElement, property } from 'lit/decorators.js';

  @customElement('mock-comp')
  export class MockComp extends LitElement {
    @property() count = 0;
    render() {
      return html\`
        <div>
          <!-- comment -->
          <p>Count: \${this.count}</p>
        </div>
      \`;
    }
  }
`;

litWebpackLoader.call(mockLoaderContext, compSource);
assert(loaderResult, 'Loader must execute callback');
assert(!loaderResult.code.includes('@customElement'), 'Loader should lower decorators');
assert(!loaderResult.code.includes('<!-- comment -->'), 'Loader should strip comments');

console.log('✓ Webpack plugin hooks, classes, options, and loader verified successfully.');
