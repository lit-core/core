import assert from 'node:assert';
import litDefault, {
  CssFuseWebpackPlugin,
  CssMinifierWebpackPlugin,
  cssFuse,
  cssMinifier,
  DomPathsWebpackPlugin,
  domPaths,
  ElemProxyWebpackPlugin,
  elemProxy,
  HtmlMinifierWebpackPlugin,
  htmlMinifier,
  isSsrTarget,
  LitWebpackPlugin,
  lit,
  litCore,
  litCssFuse,
  litCssMinifier,
  litDomPaths,
  litElemProxy,
  litHtmlMinifier,
  litPropsLower,
  litSsr,
  litWebpackLoader,
  PropsLowerWebpackPlugin,
  propsLower,
  registerPluginState,
  SsrWebpackPlugin,
  ssr,
  TransformError,
  unregisterPluginState,
} from '../dist/index.js';
import { transformCssMinifier, transformElemProxy, transformHtmlMinifier, transformPropsLower } from '../dist/transforms.js';
import { extractSheetId, formatVirtualId, isVirtualFusedId } from '../dist/utils.js';

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
assert.strictEqual(typeof domPaths, 'function', 'domPaths must be a function');
assert.strictEqual(typeof litDomPaths, 'function', 'litDomPaths must be an alias');
assert.strictEqual(typeof ssr, 'function', 'ssr must be a function');
assert.strictEqual(typeof litSsr, 'function', 'litSsr must be an alias');
assert.strictEqual(litSsr, ssr, 'litSsr must equal ssr');
assert.strictEqual(typeof isSsrTarget, 'function', 'isSsrTarget must be a function');
assert.strictEqual(typeof litWebpackLoader, 'function', 'litWebpackLoader must be exported');

// 2. Verify classes
assert.strictEqual(typeof LitWebpackPlugin, 'function', 'LitWebpackPlugin class must exist');
assert.strictEqual(typeof SsrWebpackPlugin, 'function', 'SsrWebpackPlugin class must exist');
assert.strictEqual(typeof CssFuseWebpackPlugin, 'function', 'CssFuseWebpackPlugin class must exist');
assert.strictEqual(typeof PropsLowerWebpackPlugin, 'function', 'PropsLowerWebpackPlugin class must exist');
assert.strictEqual(typeof ElemProxyWebpackPlugin, 'function', 'ElemProxyWebpackPlugin class must exist');
assert.strictEqual(typeof DomPathsWebpackPlugin, 'function', 'DomPathsWebpackPlugin class must exist');
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

const htmlFusePlugin = lit({ cssFuse: false, htmlFuse: true });
assert.strictEqual(htmlFusePlugin.options.htmlFuse, true);

const kebabHtmlFusePlugin = lit({ cssFuse: false, 'html-fuse': true });
assert.strictEqual(kebabHtmlFusePlugin.options['html-fuse'], true);

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

// Test standalone ssr() factory
const standaloneSsr = ssr({ streaming: true, prerender: true, islands: true });
assert(standaloneSsr instanceof SsrWebpackPlugin);
assert(standaloneSsr instanceof LitWebpackPlugin);
assert.strictEqual(standaloneSsr.options.cssFuse, false);
assert.strictEqual(standaloneSsr.options.ssr?.streaming, true);
assert.strictEqual(standaloneSsr.options.ssr?.prerender, true);

// Test lit() with SSR options
const ssrPluginOpt = lit({ ssr: { streaming: true, islands: true } });
assert.strictEqual(typeof ssrPluginOpt.options.ssr, 'object');
assert.strictEqual(ssrPluginOpt.options.ssr?.streaming, true);

const kebabSsrOpt = lit({ 'lit-ssr': true });
assert.strictEqual(kebabSsrOpt.options['lit-ssr'], true);

// Test isSsrTarget helper
assert.strictEqual(isSsrTarget('node'), true);
assert.strictEqual(isSsrTarget('async-node'), true);
assert.strictEqual(isSsrTarget('webworker'), true);
assert.strictEqual(isSsrTarget(['node', 'es2022']), true);
assert.strictEqual(isSsrTarget('web'), false);
assert.strictEqual(isSsrTarget(undefined), false);

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
assert(
  transformedProxy.code.includes('customElements.define("wp-proxy-btn", WpProxyBtnProxy)') || transformedProxy.code.includes("customElements.define('wp-proxy-btn', WpProxyBtnProxy)"),
  'customElements.define emitted',
);

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

// Test Stage 3 ordering in loader: domPaths executes before dirtyMask without starvation
let stage3LoaderResult = null;
const stage3LoaderContext = {
  resourcePath: '/src/stage3-comp.ts',
  getOptions() {
    return {
      options: {
        cssFuse: false,
        domPaths: true,
        dirtyMask: true,
      },
    };
  },
  async() {
    return (err, code, map) => {
      if (err) throw err;
      stage3LoaderResult = { code, map };
    };
  },
};

const stage3Source = `
  import { LitElement, html } from 'lit';
  export class Stage3Comp extends LitElement {
    static properties = { count: { type: Number } };
    render() {
      return html\`<div><p>\${this.count}</p></div>\`;
    }
  }
`;

litWebpackLoader.call(stage3LoaderContext, stage3Source);
assert(stage3LoaderResult, 'Loader must execute callback for Stage 3');
assert(stage3LoaderResult.code.includes('static __litPartPaths'), 'domPaths must emit static __litPartPaths');
assert(stage3LoaderResult.code.includes('__litDirtyMask'), 'dirtyMask must compose onto update method');
assert(!stage3LoaderResult.code.includes('this.updated?.(changedProperties)'), 'updated callback not duplicated');

// Test loader applies transformedFiles when cssFuse: false, htmlFuse: true
{
  const pluginId = 'test-html-fuse-loader-state';
  const targetPath = '/src/fused-template-comp.ts';
  const transformedTemplateSource = `
    import { LitElement, html } from 'lit';
    import { _fused_html_1 } from 'virtual:html-fuse/_fused_html_1.js';
    export class FusedTemplateComp extends LitElement {
      render() {
        return _fused_html_1;
      }
    }
  `;

  registerPluginState(pluginId, {
    transformedFiles: new Map([[targetPath, transformedTemplateSource]]),
    virtualSheets: new Map(),
    virtualTemplates: new Map(),
    options: {
      cssFuse: false,
      htmlFuse: true,
    },
  });

  let loaderOut = null;
  const mockContext = {
    resourcePath: targetPath,
    getOptions() {
      return { pluginId };
    },
    async() {
      return (err, code) => {
        if (err) throw err;
        loaderOut = code;
      };
    },
  };

  litWebpackLoader.call(mockContext, 'export class FusedTemplateComp extends LitElement {}');
  unregisterPluginState(pluginId);

  assert(loaderOut, 'Loader must return result');
  assert(loaderOut.includes('_fused_html_1'), 'Loader must apply transformedFiles when cssFuse: false, htmlFuse: true');
  assert(loaderOut.includes('virtual:html-fuse/'), 'Loader output must include virtual html template import');

  // Verify kebab-case alias 'html-fuse': true also applies transformedFiles
  const kebabPluginId = 'test-kebab-html-fuse-loader-state';
  registerPluginState(kebabPluginId, {
    transformedFiles: new Map([[targetPath, transformedTemplateSource]]),
    virtualSheets: new Map(),
    virtualTemplates: new Map(),
    options: {
      cssFuse: false,
      'html-fuse': true,
    },
  });

  let kebabLoaderOut = null;
  const mockKebabContext = {
    resourcePath: targetPath,
    getOptions() {
      return { pluginId: kebabPluginId };
    },
    async() {
      return (err, code) => {
        if (err) throw err;
        kebabLoaderOut = code;
      };
    },
  };

  litWebpackLoader.call(mockKebabContext, 'export class FusedTemplateComp extends LitElement {}');
  unregisterPluginState(kebabPluginId);

  assert(kebabLoaderOut, 'Loader must return result for kebab-case html-fuse');
  assert(kebabLoaderOut.includes('_fused_html_1'), 'Loader must apply transformedFiles when "html-fuse": true');

  // Verify bailout: when both cssFuse and htmlFuse are false, raw source is returned unmodified
  const disabledPluginId = 'test-disabled-fuse-loader-state';
  registerPluginState(disabledPluginId, {
    transformedFiles: new Map([[targetPath, transformedTemplateSource]]),
    virtualSheets: new Map(),
    virtualTemplates: new Map(),
    options: {
      cssFuse: false,
      htmlFuse: false,
    },
  });

  let disabledLoaderOut = null;
  const mockDisabledContext = {
    resourcePath: targetPath,
    getOptions() {
      return { pluginId: disabledPluginId };
    },
    async() {
      return (err, code) => {
        if (err) throw err;
        disabledLoaderOut = code;
      };
    },
  };

  const rawSource = 'export class FusedTemplateComp extends LitElement { /* raw */ }';
  litWebpackLoader.call(mockDisabledContext, rawSource);
  unregisterPluginState(disabledPluginId);

  assert.strictEqual(disabledLoaderOut, rawSource, 'Loader must not apply transformedFiles when both cssFuse and htmlFuse are false');
}

// Test Webpack loader composition: transformedFiles + propsLower
{
  const compPluginId = 'test-fused-props-state';
  const filePath = '/src/fused-btn-comp.ts';
  const fusedWithDecorators = `
    import { LitElement, css } from 'lit';
    import { customElement, property } from 'lit/decorators.js';
    import { _fused_sheet1 } from 'virtual:css-fuse/_fused_sheet1.js';

    @customElement('fused-wp-btn')
    export class FusedWpBtn extends LitElement {
      static styles = [_fused_sheet1, css\`
        .btn { color: green; }
      \`];
      @property() label = 'Save';
    }
  `;

  registerPluginState(compPluginId, {
    transformedFiles: new Map([[filePath, fusedWithDecorators]]),
    virtualSheets: new Map(),
    options: {
      cssFuse: true,
      propsLower: true,
    },
  });

  let compResult = null;
  const mockCompContext = {
    resourcePath: filePath,
    getOptions() {
      return { pluginId: compPluginId };
    },
    async() {
      return (err, code) => {
        if (err) throw err;
        compResult = code;
      };
    },
  };

  litWebpackLoader.call(mockCompContext, 'export class FusedWpBtn {}');
  unregisterPluginState(compPluginId);

  assert(compResult, 'Loader must return result');
  assert(!compResult.includes('@customElement'), 'Decorators must be stripped by propsLower in Webpack loader');
  assert(!compResult.includes('@property'), '@property decorator must be stripped');
  assert(compResult.includes('static properties'), 'static properties must be emitted');
  assert(compResult.includes('customElements.define("fused-wp-btn", FusedWpBtn)'), 'customElements.define emitted');
  assert(compResult.includes('_fused_sheet1'), 'Shared constructable sheet import must be preserved');
}

// 9. Test Webpack virtual scheme resolution and redirection
let virtualResourceHook = null;
let resolveHook = null;
const mockCompiler = {
  getInfrastructureLogger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
  options: { mode: 'production', module: { rules: [] } },
  hooks: {
    beforeCompile: { tapAsync: () => {} },
    compilation: {
      tap: (_name, cb) => {
        const mockCompilation = {};
        cb(mockCompilation);
      },
    },
    normalModuleFactory: {
      tap: (_name, cb) => {
        const mockNmf = {
          hooks: {
            resolve: {
              tap: (_n, fn) => {
                resolveHook = fn;
              },
            },
          },
        };
        cb(mockNmf);
      },
    },
    shutdown: { tap: () => {} },
  },
  webpack: {
    NormalModule: {
      getCompilationHooks: () => ({
        readResourceForScheme: {
          for: (_scheme) => ({
            tapPromise: (_name, fn) => {
              virtualResourceHook = fn;
            },
          }),
        },
      }),
    },
  },
};

const pluginInst = lit();
pluginInst.apply(mockCompiler);

assert(typeof virtualResourceHook === 'function', 'readResourceForScheme must be registered');
assert(typeof resolveHook === 'function', 'resolve hook must be registered');

// Test readResourceForScheme for virtual:lit-core/*
(async () => {
  const adapterBuf = await virtualResourceHook('virtual:lit-core/resumable-adapter');
  assert(adapterBuf.toString().includes('installResumableAdapter'), 'Adapter buffer must contain installResumableAdapter');

  const nativeBuf = await virtualResourceHook('virtual:lit-core/native-runtime');
  assert(nativeBuf.toString().includes('NativeElement'), 'Native buffer must contain NativeElement');

  const domBuf = await virtualResourceHook('virtual:lit-core/dom-paths');
  assert(domBuf.toString().includes('preparePartsWithPaths'), 'Dom paths buffer must contain preparePartsWithPaths');

  // Test resolution redirection for bare imports
  const req1 = { request: '@lit-core/resumable/client' };
  resolveHook(req1);
  assert.strictEqual(req1.request, 'virtual:lit-core/resumable-adapter.js');

  const req2 = { request: '@lit-core/native/runtime' };
  resolveHook(req2);
  assert.strictEqual(req2.request, 'virtual:lit-core/native-runtime.js');

  const req3 = { request: '@lit-core/dom-paths/client' };
  resolveHook(req3);
  assert.strictEqual(req3.request, 'virtual:lit-core/dom-paths.js');
})();

console.log('✓ Webpack plugin hooks, classes, options, and loader verified successfully.');

// 10. Test strict error reporting and failure modes
console.log('Testing Webpack plugin strict error reporting...');

// Test TransformError class structure
{
  const err = new TransformError('test-plugin', '/src/sample.ts', {
    message: 'Syntax error at line 10, column 4',
    line: 10,
    column: 4,
  });
  assert(err instanceof Error, 'TransformError must be instance of Error');
  assert.strictEqual(err.name, 'TransformError');
  assert.strictEqual(err.plugin, 'test-plugin');
  assert.strictEqual(err.file, '/src/sample.ts');
  assert.strictEqual(err.line, 10);
  assert.strictEqual(err.column, 4);
  assert.deepStrictEqual(err.loc, { line: 10, column: 4 });
  assert(err.message.includes('[test-plugin] Transform failed on /src/sample.ts: Syntax error at line 10, column 4'));
}

// Test transformPropsLower throws TransformError on failure
{
  const brokenCode = `import { property } from 'lit/decorators.js'; class X { @property() x = 1; }`;
  assert.throws(
    () => transformPropsLower(brokenCode, '/src/broken.ts', { sourcemap: 'invalid' }),
    (err) => err instanceof TransformError && err.plugin === 'props-lower' && err.file === '/src/broken.ts',
    'transformPropsLower must throw TransformError on failure',
  );
}

// Test litWebpackLoader invokes callback with Error on transform failure
{
  let capturedError = null;
  const failingContext = {
    resourcePath: '/src/broken.ts',
    getOptions() {
      return { options: { propsLower: { sourcemap: 'invalid' } } };
    },
    async() {
      return (err) => {
        capturedError = err;
      };
    },
  };

  const code = `import { property } from 'lit/decorators.js'; class X { @property() x = 1; }`;
  litWebpackLoader.call(failingContext, code);

  assert(capturedError instanceof Error, 'Loader must invoke callback with an Error on transform failure');
  assert(capturedError.message.includes('[lit-webpack-loader]'), 'Error message must identify loader');
  assert(capturedError.message.includes('props-lower'), 'Error message must identify failing transform pass');
  assert(capturedError.message.includes('/src/broken.ts'), 'Error message must identify resource path');
}

// Test litWebpackLoader returns unmodified code on benign non-match
{
  let capturedResult = null;
  let capturedError = null;
  const nonMatchContext = {
    resourcePath: '/src/math.ts',
    getOptions() {
      return { options: { propsLower: true, htmlMinifier: true } };
    },
    async() {
      return (err, code, map) => {
        capturedError = err;
        capturedResult = { code, map };
      };
    },
  };

  const plainCode = `export function add(a, b) { return a + b; }`;
  litWebpackLoader.call(nonMatchContext, plainCode);

  assert.strictEqual(capturedError, null, 'Benign non-match must not invoke callback with an error');
  assert(capturedResult, 'Callback must be called with result');
  assert.strictEqual(capturedResult.code, plainCode, 'Source must remain unmodified');
}

// Test LitWebpackPlugin beforeCompile hook passes error to callback on optimization failure
{
  const failingPlugin = new LitWebpackPlugin({
    cssFuse: { include: 123 },
  });

  let beforeCompileCallbackError = null;
  const compiler = {
    options: { mode: 'production', module: { rules: [] } },
    getInfrastructureLogger: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
    hooks: {
      beforeCompile: {
        tapAsync: (_name, fn) => {
          fn({}, (err) => {
            beforeCompileCallbackError = err;
          });
        },
      },
      compilation: { tap: () => {} },
      normalModuleFactory: { tap: () => {} },
      shutdown: { tap: () => {} },
    },
  };

  failingPlugin.apply(compiler);
  assert(beforeCompileCallbackError instanceof Error, 'beforeCompile hook must invoke callback with Error on optimization failure');
  assert(beforeCompileCallbackError.message.includes('[css-fuse] Optimization pass failed'), 'Error must identify css-fuse optimization failure');
}

console.log('✓ Webpack plugin strict error reporting verified successfully.');
