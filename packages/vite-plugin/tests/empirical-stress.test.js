import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { transformSsr as webpackTransformSsr } from '../../webpack-plugin/dist/transforms/ssr.js';
import { lit as viteLit } from '../dist/index.js';
import { sanitizePrerenderRoute, transformHtmlWithSsr } from '../dist/plugins/ssr.js';

/**
 * Mock Vite dev server response object.
 */
class MockServerResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = 200;
    this.bodyChunks = [];
    this.finished = false;
    this.writableEnded = false;
    this.headersSent = false;
    this.destroyed = false;
  }

  setHeader(name, value) {
    if (this.headersSent) {
      throw new Error('ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent');
    }
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  write(chunk) {
    this.headersSent = true;
    if (this.finished || this.destroyed) {
      throw new Error('ERR_STREAM_WRITE_AFTER_END: write after end');
    }
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    this.bodyChunks.push(buf);
    return true;
  }

  end(data) {
    this.headersSent = true;
    if (data) {
      const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
      this.bodyChunks.push(buf);
    }
    this.finished = true;
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }

  destroy(err) {
    this.destroyed = true;
    this.finished = true;
    this.writableEnded = true;
    this.emit('close', err);
    return this;
  }

  getBodyString() {
    return Buffer.concat(this.bodyChunks).toString('utf-8');
  }
}

class MockIncomingMessage extends EventEmitter {
  constructor(url = '/', method = 'GET', headers = { accept: 'text/html' }) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
  }
}

async function runEmpiricalStressSuite() {
  console.log('🔬 Starting comprehensive empirical stress suite for @lit-core/ssr...\n');

  const stats = { passed: 0, failed: 0, errors: [] };

  function check(testName, fn) {
    try {
      fn();
      stats.passed++;
      console.log(`  ✓ [PASS] ${testName}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push({ testName, error: err.message, stack: err.stack });
      console.log(`  ❌ [FAIL] ${testName}`);
      console.log(`     Error: ${err.message}\n`);
    }
  }

  async function checkAsync(testName, fn) {
    try {
      await fn();
      stats.passed++;
      console.log(`  ✓ [PASS] ${testName}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push({ testName, error: err.message, stack: err.stack });
      console.log(`  ❌ [FAIL] ${testName}`);
      console.log(`     Error: ${err.message}\n`);
    }
  }

  // =========================================================================
  // SUITE 1: COMPLEX ISLAND TOPOLOGIES IN HTML SSR
  // =========================================================================
  console.log('--- Suite 1: Complex island topologies in HTML SSR ---');

  // 1.1 Deeply nested tree (5 levels)
  check('1.1: 5 levels of deeply nested custom elements', () => {
    const html = '<lvl-one><lvl-two><lvl-three><lvl-four><lvl-five>Deep text</lvl-five></lvl-four></lvl-three></lvl-two></lvl-one>';
    const transformed = transformHtmlWithSsr(html, { islands: true });
    const count = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    assert.strictEqual(count, 5, `Expected 5 DSD templates for 5 nested levels, got ${count}`);
    assert(transformed.includes('Deep text'), 'Preserves innermost content');
    assert(transformed.includes('islands-loader.js'), 'Includes islands loader');
  });

  // 1.2 Branching tree with multiple sibling custom elements at every level
  check('1.2: Branching island tree with siblings at multiple levels', () => {
    const html = `
      <app-shell>
        <nav-bar>
          <brand-logo>Logo</brand-logo>
          <nav-link>Link 1</nav-link>
          <nav-link>Link 2</nav-link>
        </nav-bar>
        <main-layout>
          <sidebar-panel><panel-item>Item</panel-item></sidebar-panel>
          <content-area><data-table>Table</data-table></content-area>
        </main-layout>
      </app-shell>
    `;
    const transformed = transformHtmlWithSsr(html, { islands: true });
    // Total custom elements: app-shell(1), nav-bar(1), brand-logo(1), nav-link(2), main-layout(1), sidebar-panel(1), panel-item(1), content-area(1), data-table(1) = 10
    const count = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    assert.strictEqual(count, 10, `Expected 10 DSD templates in branching tree, got ${count}`);
  });

  // 1.3 Custom element with complex attributes (escaped quotes, HTML entities, angle brackets in attributes)
  check('1.3: Custom elements with complex attributes and angle brackets', () => {
    const html = '<cfg-widget data-json=\'{"condition": "x < y && y > z"}\' title="foo &gt; bar">Content</cfg-widget>';
    const transformed = transformHtmlWithSsr(html, { islands: true });
    assert(transformed.includes('<cfg-widget'), 'Element retained');
    assert(transformed.includes('<template shadowrootmode="open">'), 'DSD template injected');
    assert(transformed.includes('x < y && y > z'), 'Complex attribute preserved');
  });

  // 1.4 Comments and scripts containing custom element markup must be preserved without DSD injection
  check('1.4: Comments and script tags with custom element strings are protected', () => {
    const html = `
      <!-- <hidden-comment-elem>Ignored</hidden-comment-elem> -->
      <script>
        const markup = '<fake-script-elem>Do not touch</fake-script-elem>';
      </script>
      <style>
        fake-style-elem { display: block; }
      </style>
      <live-elem>Live</live-elem>
    `;
    const transformed = transformHtmlWithSsr(html, { islands: true });
    assert(transformed.includes('<!-- <hidden-comment-elem>Ignored</hidden-comment-elem> -->'), 'Comment protected');
    assert(transformed.includes("const markup = '<fake-script-elem>Do not touch</fake-script-elem>';"), 'Script protected');
    assert(transformed.includes('fake-style-elem { display: block; }'), 'Style protected');
    assert(transformed.includes('<live-elem><template shadowrootmode="open">'), 'Live element received DSD');
    assert(!transformed.includes('<hidden-comment-elem><template'), 'Comment elem must not receive DSD');
    assert(!transformed.includes('<fake-script-elem><template'), 'Script elem must not receive DSD');
  });

  // 1.5 Custom elements with mixed case tags
  check('1.5: Custom elements with mixed case normalized correctly', () => {
    const html = '<MY-CARD><INNER-BTN>Button</INNER-BTN></MY-CARD>';
    const transformed = transformHtmlWithSsr(html, { islands: true });
    const count = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    assert.strictEqual(count, 2, `Expected 2 DSD templates for uppercase custom elements, got ${count}`);
  });

  // 1.6 Custom elements combined with domPaths and resumable
  check('1.6: Simultaneous islands, domPaths, and resumable options', () => {
    const html = '<container-view><child-view>View</child-view></container-view>';
    const transformed = transformHtmlWithSsr(html, {
      islands: true,
      domPaths: true,
      resumable: true,
    });
    assert(transformed.includes('data-lit-paths="true"'), 'data-lit-paths added');
    assert(transformed.includes('<script type="lit/state">'), 'Resumable state injected');
    assert(transformed.includes('islands-loader.js'), 'Islands loader injected');
    const dsdCount = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    assert.strictEqual(dsdCount, 2, 'Both custom elements received DSD');
  });

  // 1.7 Stress payload: 100 sibling custom elements
  check('1.7: Scalability: 100 sibling custom elements transformed efficiently', () => {
    const elements = Array.from({ length: 100 }, (_, i) => `<item-elem-${i % 10}>Item ${i}</item-elem-${i % 10}>`).join('\n');
    const html = `<list-container>${elements}</list-container>`;
    const start = performance.now();
    const transformed = transformHtmlWithSsr(html, { islands: true });
    const elapsed = performance.now() - start;
    const count = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    assert.strictEqual(count, 101, `Expected 101 DSD templates, got ${count}`);
    assert(elapsed < 2000, `Transformation took too long: ${elapsed.toFixed(1)}ms`);
  });

  // =========================================================================
  // SUITE 2: AST ISLAND TAGGING STRESS TESTING (VITE & WEBPACK)
  // =========================================================================
  console.log('\n--- Suite 2: AST island tagging stress testing ---');

  const multiClassSource = `
    import { LitElement, html } from 'lit';
    import { customElement } from 'lit/decorators.js';

    export class NonComponentHelper {
      compute() { return 42; }
    }

    @customElement('island-alpha')
    export class IslandAlpha extends LitElement {
      render() { return html\`<p>Alpha</p>\`; }
    }

    @customElement('island-beta')
    export class IslandBeta extends LitElement {
      render() { return html\`<p>Beta</p>\`; }
    }

    @customElement('island-gamma')
    export class IslandGamma extends LitElement {
      render() { return html\`<p>Gamma</p>\`; }
    }

    class AnonymousDefine extends LitElement {}
    customElements.define('island-delta', AnonymousDefine);

    export class IslandPretagged extends LitElement {
      static __isIsland = true;
      render() { return html\`<p>Pretagged</p>\`; }
    }
  `;

  // 2.1 Vite: islands with include and exclude filters
  await checkAsync('2.1: Vite islands with include and exclude filters', async () => {
    const plugins = viteLit({
      ssr: {
        islands: {
          include: ['island-alpha', 'island-gamma'],
          exclude: ['island-beta'],
        },
      },
    });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin?.transform, 'SSR transform hook must exist');

    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, multiClassSource, '/src/multi-test.ts');
    assert(result?.code, 'Must return transformed code');

    assert(result.code.includes('class IslandAlpha extends LitElement {\n  static __isIsland = true;'), 'Alpha tagged');
    assert(!result.code.includes('class IslandBeta extends LitElement {\n  static __isIsland = true;'), 'Beta excluded');
    assert(result.code.includes('class IslandGamma extends LitElement {\n  static __isIsland = true;'), 'Gamma tagged');
    assert(!result.code.includes('class NonComponentHelper {\n  static __isIsland = true;'), 'Helper not tagged');
    // Pretagged has only one static __isIsland
    const pretaggedCount = (result.code.match(/class IslandPretagged extends LitElement \{\s+static __isIsland = true;/g) || []).length;
    assert.strictEqual(pretaggedCount, 1, 'Pretagged not duplicated');
  });

  // 2.2 Webpack: identical filtering behavior
  check('2.2: Webpack SSR transform identical filtering behavior', () => {
    const result = webpackTransformSsr(multiClassSource, '/src/multi-test.ts', {
      islands: {
        include: ['island-alpha', 'island-gamma'],
        exclude: ['island-beta'],
      },
    });
    assert(result?.code, 'Must return transformed code');

    assert(result.code.includes('class IslandAlpha extends LitElement {\n  static __isIsland = true;'), 'Alpha tagged');
    assert(!result.code.includes('class IslandBeta extends LitElement {\n  static __isIsland = true;'), 'Beta excluded');
    assert(result.code.includes('class IslandGamma extends LitElement {\n  static __isIsland = true;'), 'Gamma tagged');
    assert(!result.code.includes('class NonComponentHelper {\n  static __isIsland = true;'), 'Helper not tagged');
  });

  // 2.3 Inheritance hierarchy: class Derived extends Base extends LitElement
  await checkAsync('2.3: Inheritance hierarchy with customElement define', async () => {
    const inheritanceSource = `
      import { LitElement, html } from 'lit';
      export class BaseWidget extends LitElement {}
      export class DerivedWidget extends BaseWidget {}
      customElements.define('derived-widget', DerivedWidget);
    `;

    const plugins = viteLit({
      ssr: {
        islands: {
          include: ['derived-widget'],
        },
      },
    });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, inheritanceSource, '/src/inherit.ts');
    assert(result?.code, 'Must return code');

    assert(result.code.includes('class DerivedWidget extends BaseWidget {\n  static __isIsland = true;'), 'Derived widget tagged');
    assert(!result.code.includes('class BaseWidget extends LitElement {\n  static __isIsland = true;'), 'Base widget not tagged');
  });

  // 2.4 Class expressions: const MyComp = class extends LitElement {}
  await checkAsync('2.4: Class expression island tagging', async () => {
    const classExprSource = `
      import { LitElement } from 'lit';
      const MyComp = class extends LitElement {};
      customElements.define('expr-comp', MyComp);
    `;

    const plugins = viteLit({ ssr: { islands: true } });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, classExprSource, '/src/expr.ts');
    assert(result?.code, 'Must return code');
    assert(result.code.includes('static __isIsland = true;'), 'Class expression tagged with __isIsland');
  });

  // 2.5 TypeScript generics and relational operators in source do not trigger false positive syntax errors
  await checkAsync('2.5: Complex TypeScript generics, interfaces, and relational loops pass validation', async () => {
    const complexTsSource = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';

      interface GenericProps<T extends Record<string, any>> {
        data: T[];
      }

      @customElement('ts-island')
      export class TsIsland<T extends Record<string, any>> extends LitElement {
        items: T[] = [];
        process() {
          for (let i = 0; i < this.items.length; i++) {
            const val = this.items[i];
          }
        }
        render() {
          return html\`<div>\${this.items.length}</div>\`;
        }
      }
    `;

    const plugins = viteLit({ ssr: { islands: true } });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, complexTsSource, '/src/ts-island.ts');
    assert(result?.code, 'Transformed successfully without syntax error');
    assert(result.code.includes('static __isIsland = true;'), 'TsIsland tagged');
  });

  // =========================================================================
  // SUITE 3: PRERENDER ROUTE SANITIZATION & BUNDLE EMISSION EDGE CASES
  // =========================================================================
  console.log('\n--- Suite 3: Prerender route sanitization and bundle emission ---');

  // 3.1 Exhaustive route sanitization matrix
  check('3.1: Exhaustive route sanitization matrix', () => {
    const testCases = [
      { input: '', expected: 'index.html' },
      { input: '/', expected: 'index.html' },
      { input: '///', expected: 'index.html' },
      { input: 'index', expected: 'index.html' },
      { input: '/index', expected: 'index.html' },
      { input: '/index.html', expected: 'index.html' },
      { input: 'index.html', expected: 'index.html' },
      { input: '/about', expected: 'about.html' },
      { input: '/about/', expected: 'about.html' },
      { input: '/about.html', expected: 'about.html' },
      { input: 'about.html', expected: 'about.html' },
      { input: '/docs/api/v1/user', expected: 'docs/api/v1/user.html' },
      { input: '///docs///api///v1///user///', expected: 'docs/api/v1/user.html' },
      { input: '/search?query=lit&page=1', expected: 'search.html' },
      { input: '/home#top', expected: 'home.html' },
      { input: '/product?id=123#reviews', expected: 'product.html' },
      { input: '   /whitespace-padded/   ', expected: 'whitespace-padded.html' },
      { input: null, expected: null },
      { input: undefined, expected: null },
      { input: 12345, expected: null },
      { input: {}, expected: null },
      { input: true, expected: null },
      { input: false, expected: null },
    ];

    for (const { input, expected } of testCases) {
      const actual = sanitizePrerenderRoute(input);
      assert.strictEqual(actual, expected, `Route '${String(input)}' expected '${expected}', got '${actual}'`);
    }
  });

  // 3.2 Duplicate routes and collisions during generateBundle
  await checkAsync('3.2: Duplicate routes do not crash generateBundle asset emission', async () => {
    const plugins = viteLit({
      ssr: {
        prerender: {
          routes: ['/dup-test', '/dup-test/', '/dup-test.html', '///dup-test///'],
        },
      },
    });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin?.generateBundle, 'generateBundle exists');

    const emitted = {};
    const mockContext = {
      emitFile(asset) {
        emitted[asset.fileName] = asset.source;
      },
    };

    const bundle = {
      'entry.js': {
        type: 'chunk',
        isEntry: true,
        fileName: 'entry.js',
        code: '<dup-widget>Dup</dup-widget>',
      },
    };

    await ssrPlugin.generateBundle.call(mockContext, {}, bundle);
    assert(emitted['dup-test.html'], 'dup-test.html was emitted cleanly');
  });

  // =========================================================================
  // SUITE 4: VITE DEV SERVER SSR MIDDLEWARE CONCURRENCY & STREAMING
  // =========================================================================
  console.log('\n--- Suite 4: Vite dev server SSR middleware edge cases ---');

  function setupTestServer(options = {}) {
    const plugins = viteLit({ ssr: options });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin?.configureServer, 'configureServer must exist');

    let registeredMiddleware = null;
    const mockServer = {
      middlewares: {
        use(fn) {
          registeredMiddleware = fn;
        },
      },
      transformIndexHtml(_url, html) {
        return Promise.resolve(html);
      },
      ssrLoadModule(_entry) {
        if (options.mockModule) return Promise.resolve(options.mockModule);
        return Promise.resolve({});
      },
    };

    ssrPlugin.configureServer.call({}, mockServer);
    return registeredMiddleware;
  }

  // 4.1 Non-GET and non-HTML requests pass through immediately to next()
  await checkAsync('4.1: Non-GET and non-HTML requests pass through to next()', async () => {
    const middleware = setupTestServer();

    // POST request
    const postReq = new MockIncomingMessage('/api/submit', 'POST', { accept: 'text/html' });
    const postRes = new MockServerResponse();
    let postNextCalled = false;
    await middleware(postReq, postRes, () => {
      postNextCalled = true;
    });
    assert(postNextCalled, 'POST passed to next()');

    // JSON request
    const jsonReq = new MockIncomingMessage('/data', 'GET', { accept: 'application/json' });
    const jsonRes = new MockServerResponse();
    let jsonNextCalled = false;
    await middleware(jsonReq, jsonRes, () => {
      jsonNextCalled = true;
    });
    assert(jsonNextCalled, 'JSON request passed to next()');
  });

  // 4.2 Known static asset extensions bypass SSR middleware
  await checkAsync('4.2: Static assets across known extensions bypass SSR middleware', async () => {
    const middleware = setupTestServer();
    const staticUrls = [
      '/src/main.js',
      '/styles/app.css',
      '/images/logo.svg',
      '/images/photo.png',
      '/fonts/inter.woff2',
      '/data/config.json',
      '/wasm/module.wasm',
      '/video/clip.mp4',
      '/favicon.ico',
      '/@fs/some/path.js',
      '/__vite_ping',
    ];

    for (const url of staticUrls) {
      const req = new MockIncomingMessage(url, 'GET', { accept: 'text/html' });
      const res = new MockServerResponse();
      let nextCalled = false;
      await middleware(req, res, () => {
        nextCalled = true;
      });
      assert(nextCalled, `Static asset ${url} should bypass SSR middleware`);
    }
  });

  // 4.3 Streaming error handling after headers sent destroys/ends response cleanly without next(err)
  await checkAsync('4.3: Streaming abort destroys response without headersSent crash', async () => {
    const faultyStreamModule = {
      render() {
        const encoder = new TextEncoder();
        let step = 0;
        return new ReadableStream({
          pull(controller) {
            if (step === 0) {
              controller.enqueue(encoder.encode('<div>Start stream</div>'));
              step++;
            } else {
              controller.error(new Error('Simulated socket abort in stream pull'));
            }
          },
        });
      },
    };

    const middleware = setupTestServer({
      entry: '/src/entry-server.ts',
      streaming: true,
      mockModule: faultyStreamModule,
    });

    const req = new MockIncomingMessage('/stream-fail', 'GET', { accept: 'text/html' });
    const res = new MockServerResponse();

    let nextErr = null;
    await middleware(req, res, (err) => {
      nextErr = err;
    });

    assert.strictEqual(nextErr, null, 'Must NOT call next(err) when headers are already sent');
    assert(res.finished || res.destroyed, 'Response must be finished or destroyed cleanly');
  });

  // 4.4 High concurrency: 100 concurrent requests with mock async server module
  await checkAsync('4.4: 100 concurrent async requests served with correct isolation', async () => {
    const mockModule = {
      async render(url) {
        await new Promise((r) => setTimeout(r, 2));
        return `<!DOCTYPE html><html><body><page-id>${url}</page-id></body></html>`;
      },
    };

    const middleware = setupTestServer({
      entry: '/src/entry-server.ts',
      mockModule,
    });

    const total = 100;
    const reqs = Array.from({ length: total }, (_, i) => ({
      req: new MockIncomingMessage(`/tenant-${i}/page`, 'GET', { accept: 'text/html' }),
      res: new MockServerResponse(),
    }));

    await Promise.all(
      reqs.map(
        ({ req, res }) =>
          new Promise((resolve, reject) => {
            middleware(req, res, (err) => {
              if (err) reject(err);
              else resolve();
            })
              .then(resolve)
              .catch(reject);
          }),
      ),
    );

    const allCorrect = reqs.every(({ res }, idx) => {
      const body = res.getBodyString();
      return res.finished && body.includes(`/tenant-${idx}/page`);
    });

    assert(allCorrect, 'All 100 concurrent requests returned matching URLs without cross-talk');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=======================================================');
  console.log(`Stress results: ${stats.passed} PASSED, ${stats.failed} FAILED`);
  console.log('=======================================================\n');

  if (stats.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEmpiricalStressSuite().catch((err) => {
  console.error('Fatal stress harness error:', err);
  process.exit(2);
});
