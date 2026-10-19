import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { lit as viteLit } from '../dist/index.js';
import { transformHtmlWithSsr } from '../dist/plugins/ssr.js';

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
  }

  setHeader(name, value) {
    if (this.headersSent) {
      throw new Error(`ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent to the client`);
    }
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  write(chunk) {
    this.headersSent = true;
    if (this.finished) {
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

  getBodyString() {
    return Buffer.concat(this.bodyChunks).toString('utf-8');
  }
}

/**
 * Mock Vite dev server request object.
 */
class MockIncomingMessage extends EventEmitter {
  constructor(url = '/', method = 'GET', headers = { accept: 'text/html' }) {
    super();
    this.url = url;
    this.method = method;
    this.headers = headers;
  }
}

async function runEmpiricalChallenges() {
  console.log('⚡ Starting empirical challenge suite for @lit-core/vite-plugin SSR...\n');

  const results = {
    passed: 0,
    failed: 0,
    findings: [],
  };

  function recordFinding(challenge, name, details, severity = 'high') {
    results.failed++;
    results.findings.push({ challenge, name, details, severity });
    console.log(`  ❌ [FAIL] ${challenge}: ${name}`);
    console.log(`     Details: ${details}\n`);
  }

  function recordPass(challenge, name) {
    results.passed++;
    console.log(`  ✓ [PASS] ${challenge}: ${name}`);
  }

  // =========================================================================
  // CHALLENGE 1: PRERENDERING ROUTE TOPOLOGIES & QUERY PARAMS
  // =========================================================================
  console.log('--- Challenge 1: Prerendering route topologies and query params ---');

  // Helper to execute generateBundle hook with specified routes
  async function testPrerenderRoutes(routes, mockBundle = {}) {
    const plugins = viteLit({
      ssr: {
        prerender: { routes },
      },
    });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin, 'lit-ssr plugin must exist');

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
        code: '<my-element>Hello</my-element>',
      },
      ...mockBundle,
    };

    await ssrPlugin.generateBundle.call(mockContext, {}, bundle);
    return emitted;
  }

  // 1.1 Deep nested routes
  try {
    const emitted = await testPrerenderRoutes(['/docs/api/v1/endpoints/get-user']);
    if (emitted['docs/api/v1/endpoints/get-user.html']) {
      recordPass('1.1', 'Emits deep nested route to docs/api/v1/endpoints/get-user.html');
    } else {
      recordFinding('1.1', 'Deep nested route pathing', `Expected docs/api/v1/endpoints/get-user.html, got ${Object.keys(emitted)}`);
    }
  } catch (err) {
    recordFinding('1.1', 'Deep nested route exception', err.message);
  }

  // 1.2 Trailing slashes
  try {
    const emitted = await testPrerenderRoutes(['/about/', '/blog/post-1/']);
    if (emitted['about.html'] && emitted['blog/post-1.html']) {
      recordPass('1.2', 'Normalizes trailing slash routes to about.html and blog/post-1.html');
    } else {
      recordFinding('1.2', 'Trailing slash normalization', `Got files: ${Object.keys(emitted).join(', ')}`);
    }
  } catch (err) {
    recordFinding('1.2', 'Trailing slash exception', err.message);
  }

  // 1.3 Empty string, root, and multi-slash routes
  try {
    const emitted = await testPrerenderRoutes(['', '/', '///']);
    if (emitted['/.html']) {
      recordFinding(
        '1.3',
        'Multi-slash route produces invalid path /.html',
        `Route '///' was sanitized to '/.html' instead of 'index.html'. Output keys: ${Object.keys(emitted).join(', ')}`,
        'medium',
      );
    } else if (emitted['index.html']) {
      recordPass('1.3', 'Empty string and root route normalize cleanly to index.html');
    } else {
      recordFinding('1.3', 'Root route normalization failure', `Got keys: ${Object.keys(emitted).join(', ')}`);
    }
  } catch (err) {
    recordFinding('1.3', 'Root route exception', err.message);
  }

  // 1.4 Routes ending in .html (e.g. /index.html or /about.html)
  try {
    const emitted = await testPrerenderRoutes(['/index.html', '/about.html']);
    if (emitted['index.html.html'] || emitted['about.html.html']) {
      recordFinding('1.4', 'Route ending in .html results in double extension .html.html', `Emitted files: ${Object.keys(emitted).join(', ')}`, 'medium');
    } else if (emitted['index.html'] && emitted['about.html']) {
      recordPass('1.4', 'Routes ending in .html maintain single .html extension');
    } else {
      recordFinding('1.4', 'HTML route normalization', `Got: ${Object.keys(emitted).join(', ')}`);
    }
  } catch (err) {
    recordFinding('1.4', 'HTML route exception', err.message);
  }

  // 1.5 Non-string routes in configuration array (null / undefined / number)
  try {
    let crashed = false;
    try {
      await testPrerenderRoutes(['/valid', null, undefined]);
    } catch (err) {
      crashed = true;
      recordFinding('1.5', 'Unsanitized non-string route in prerender array crashes build', `Calling split on non-string route throws uncaught exception: ${err.message}`, 'high');
    }
    if (!crashed) {
      recordPass('1.5', 'Non-string routes handled without crashing');
    }
  } catch (err) {
    recordFinding('1.5', 'Non-string routes test harness error', err.message);
  }

  // =========================================================================
  // CHALLENGE 2: COMPLEX ISLAND TOPOLOGIES & AST TRANSFORMATIONS
  // =========================================================================
  console.log('\n--- Challenge 2: Complex island topologies and AST transformations ---');

  // 2.1 Nested island tags in HTML
  try {
    const nestedHtml = '<parent-island><child-island>Click me</child-island></parent-island>';
    const transformed = transformHtmlWithSsr(nestedHtml, { islands: true });

    const parentHasDsd = transformed.includes('<parent-island>') && transformed.includes('<template shadowrootmode="open">');
    // Check if child-island ALSO got its Declarative Shadow DOM template
    const childHasDsd = /<child-island[^>]*>\s*<template shadowrootmode="open">/.test(transformed);

    if (parentHasDsd && childHasDsd) {
      recordPass('2.1', 'Nested island tags both receive Declarative Shadow DOM templates');
    } else {
      recordFinding(
        '2.1',
        'Nested custom element tags do not receive Declarative Shadow DOM templates',
        `Outer tag was transformed but inner <child-island> was skipped because regex does not recurse. Output: ${transformed}`,
        'high',
      );
    }
  } catch (err) {
    recordFinding('2.1', 'Nested island exception', err.message);
  }

  // 2.2 Deeply nested custom elements (3 levels)
  try {
    const deepHtml = '<grand-card><mid-panel><inner-btn>Label</inner-btn></mid-panel></grand-card>';
    const transformed = transformHtmlWithSsr(deepHtml, { ssr: true });

    const dsdCount = (transformed.match(/<template shadowrootmode="open">/g) || []).length;
    if (dsdCount === 3) {
      recordPass('2.2', 'All 3 levels of nested custom elements receive DSD templates');
    } else {
      recordFinding('2.2', 'Deeply nested custom elements (3 levels) lose DSD templates', `Expected 3 <template shadowrootmode="open"> instances, found ${dsdCount}. Output: ${transformed}`, 'high');
    }
  } catch (err) {
    recordFinding('2.2', 'Deeply nested custom elements exception', err.message);
  }

  // 2.3 Identical nested custom element tags (<card-box><card-box>Inner</card-box></card-box>)
  try {
    const sameTagHtml = '<card-box id="outer"><card-box id="inner">Content</card-box></card-box>';
    const transformed = transformHtmlWithSsr(sameTagHtml, { ssr: true });

    // In a corrupted regex match, the inner closing tag closes the outer tag prematurely
    const outerClosedProperly = transformed.endsWith('</card-box>') && transformed.includes('id="outer"');
    const innerClosedProperly = transformed.includes('id="inner"') && transformed.indexOf('</card-box>') !== transformed.lastIndexOf('</card-box>');

    if (outerClosedProperly && innerClosedProperly) {
      recordPass('2.3', 'Identical nested custom element tags maintain valid structure');
    } else {
      recordFinding(
        '2.3',
        'Identical nested custom element tags corrupt tag closure structure',
        `Non-greedy regex prematurely matches inner closing tag as outer closing tag. Output: ${transformed}`,
        'high',
      );
    }
  } catch (err) {
    recordFinding('2.3', 'Identical nested tags exception', err.message);
  }

  // 2.4 Multiple island classes in a single source file
  try {
    const multiIslandSource = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('island-first')
      export class IslandFirst extends LitElement {
        render() { return html\`<div>First</div>\`; }
      }

      @customElement('island-second')
      export class IslandSecond extends LitElement {
        render() { return html\`<div>Second</div>\`; }
      }
    `;

    const plugins = viteLit({ ssr: { islands: true } });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin?.transform, 'SSR transform hook must exist');

    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, multiIslandSource, '/src/multi-islands.ts');
    assert(result?.code, 'Transform must return code');

    const islandCount = (result.code.match(/static __isIsland = true;/g) || []).length;
    if (islandCount === 2) {
      recordPass('2.4', 'Both IslandFirst and IslandSecond in same file tagged with static __isIsland = true');
    } else {
      recordFinding(
        '2.4',
        'Only first class in multi-component file tagged as island',
        `Expected 2 'static __isIsland = true' markers, found ${islandCount} because regex lacks /g flag. Code:\n${result.code}`,
        'high',
      );
    }
  } catch (err) {
    recordFinding('2.4', 'Multi-island file exception', err.message);
  }

  // 2.5 Island include list targeting non-first class in a file
  try {
    const mixedSource = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('regular-widget')
      export class RegularWidget extends LitElement {
        render() { return html\`<div>Static</div>\`; }
      }

      @customElement('target-island')
      export class TargetIsland extends LitElement {
        render() { return html\`<button>Interactive</button>\`; }
      }
    `;

    const plugins = viteLit({
      ssr: {
        islands: {
          include: ['target-island'],
        },
      },
    });
    const ssrPlugin = plugins.find((p) => p.name === 'lit-ssr');
    assert(ssrPlugin?.transform, 'SSR transform hook must exist');

    const result = await ssrPlugin.transform.call({ error() {}, warn() {} }, mixedSource, '/src/mixed-islands.ts');

    if (result?.code) {
      const regularTagged = result.code.includes('class RegularWidget extends LitElement {\n  static __isIsland = true;');
      const targetTagged = result.code.includes('class TargetIsland extends LitElement {\n  static __isIsland = true;');

      if (regularTagged && !targetTagged) {
        recordFinding(
          '2.5',
          'Include list targeting second component erroneously tags first component instead',
          `Target was 'target-island' but 'RegularWidget' was tagged because replace matched the first class in file! Code:\n${result.code}`,
          'high',
        );
      } else if (!regularTagged && targetTagged) {
        recordPass('2.5', 'Include list correctly targets only the specified component');
      } else {
        recordFinding('2.5', 'Unexpected island tagging result', `Result code:\n${result.code}`);
      }
    } else {
      recordFinding('2.5', 'Transform returned null when target-island was in include list', 'No code returned');
    }
  } catch (err) {
    recordFinding('2.5', 'Island include targeting exception', err.message);
  }

  // 2.6 Webpack SSR loader: island include targeting non-first component in file
  try {
    const { default: litWebpackLoader } = await import('@lit-core/webpack-plugin/loader');
    const webpackMixedSource = `
      import { LitElement, html } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('regular-widget')
      export class RegularWidget extends LitElement {
        render() { return html\`<div>Static</div>\`; }
      }

      @customElement('target-island')
      export class TargetIsland extends LitElement {
        render() { return html\`<button>Interactive</button>\`; }
      }
    `;

    const webpackResult = await new Promise((resolve, reject) => {
      const ctx = {
        resourcePath: '/src/webpack-mixed.ts',
        getOptions: () => ({
          options: {
            ssr: {
              islands: {
                include: ['target-island'],
              },
            },
          },
        }),
        async: () => (err, code) => {
          if (err) reject(err);
          else resolve(code);
        },
      };
      litWebpackLoader.call(ctx, webpackMixedSource);
    });

    if (webpackResult) {
      const regularTagged = webpackResult.includes('class RegularWidget extends LitElement {\n  static __isIsland = true;');
      const targetTagged = webpackResult.includes('class TargetIsland extends LitElement {\n  static __isIsland = true;');

      if (regularTagged && !targetTagged) {
        recordFinding(
          '2.6',
          'Webpack SSR loader include list erroneously tags first component instead of target island',
          `Target was 'target-island' but 'RegularWidget' was tagged because replace matched the first class in file! Code:\n${webpackResult}`,
          'high',
        );
      } else if (!regularTagged && targetTagged) {
        recordPass('2.6', 'Webpack SSR loader correctly targets only the specified component');
      } else {
        recordFinding('2.6', 'Unexpected Webpack island tagging result', `Result code:\n${webpackResult}`);
      }
    } else {
      recordFinding('2.6', 'Webpack loader returned null/empty for island transform', 'No code');
    }
  } catch (err) {
    recordFinding('2.6', 'Webpack loader island test exception', err.message);
  }

  // =========================================================================
  // CHALLENGE 3: VITE DEV SERVER SSR MIDDLEWARE CONCURRENCY & STREAMING
  // =========================================================================
  console.log('\n--- Challenge 3: Vite dev server SSR middleware concurrency and streaming ---');

  // Helper to setup mock dev server with middleware
  function setupDevServer(options = {}) {
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
    assert(registeredMiddleware, 'SSR middleware must be registered');

    return registeredMiddleware;
  }

  // 3.1 Concurrency stress: 100 concurrent requests to default middleware
  try {
    const middleware = setupDevServer({ resumable: true, domPaths: true });
    const concurrentCount = 100;
    const requests = Array.from({ length: concurrentCount }, (_, i) => ({
      req: new MockIncomingMessage(`/page-${i}`, 'GET', { accept: 'text/html' }),
      res: new MockServerResponse(),
    }));

    await Promise.all(
      requests.map(
        ({ req, res }) =>
          new Promise((resolve, reject) => {
            middleware(req, res, (err) => {
              if (err) reject(err);
              else resolve();
            })
              .then(() => resolve())
              .catch(reject);
          }),
      ),
    );

    const allFinished = requests.every(({ res }) => res.finished && res.statusCode === 200);
    const allHaveDsd = requests.every(({ res }) => res.getBodyString().includes('<div id="app"></div>'));

    if (allFinished && allHaveDsd) {
      recordPass('3.1', `Successfully served ${concurrentCount} concurrent requests without error or starvation`);
    } else {
      recordFinding('3.1', 'Concurrency stress failure', `Not all 100 requests finished with status 200. Finished: ${allFinished}`);
    }
  } catch (err) {
    recordFinding('3.1', 'Concurrency stress exception', err.message);
  }

  // 3.2 Streaming concurrency stress: 50 concurrent requests with ReadableStream chunks
  try {
    const mockModule = {
      render(url) {
        const encoder = new TextEncoder();
        return new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`<!DOCTYPE html><html><body><stream-route>${url}</stream-route>`));
            controller.enqueue(encoder.encode('<p>Chunk 2</p>'));
            controller.enqueue(encoder.encode('</body></html>'));
            controller.close();
          },
        });
      },
    };

    const middleware = setupDevServer({ entry: '/src/entry-server.ts', streaming: true, mockModule });
    const concurrentCount = 50;
    const streamRequests = Array.from({ length: concurrentCount }, (_, i) => ({
      req: new MockIncomingMessage(`/stream-item-${i}`, 'GET', { accept: 'text/html' }),
      res: new MockServerResponse(),
    }));

    await Promise.all(
      streamRequests.map(
        ({ req, res }) =>
          new Promise((resolve, reject) => {
            middleware(req, res, (err) => {
              if (err) reject(err);
              else resolve();
            })
              .then(() => resolve())
              .catch(reject);
          }),
      ),
    );

    const allStreamFinished = streamRequests.every(({ res }, idx) => {
      const body = res.getBodyString();
      const hasChunked = res.getHeader('Transfer-Encoding') === 'chunked';
      const hasRoute = body.includes(`/stream-item-${idx}`);
      const hasClosing = body.includes('</body></html>');
      return res.finished && hasChunked && hasRoute && hasClosing;
    });

    if (allStreamFinished) {
      recordPass('3.2', `Successfully streamed ${concurrentCount} concurrent ReadableStream responses with chunked encoding`);
    } else {
      recordFinding('3.2', 'Streaming concurrency failure', 'Some stream responses did not finish or missed chunks');
    }
  } catch (err) {
    recordFinding('3.2', 'Streaming concurrency exception', err.message);
  }

  // 3.3 Mid-stream error handling (stream reader error after headers sent)
  try {
    const faultyModule = {
      render() {
        const encoder = new TextEncoder();
        let count = 0;
        return new ReadableStream({
          pull(controller) {
            if (count === 0) {
              controller.enqueue(encoder.encode('<div>Initial chunk</div>'));
              count++;
            } else {
              controller.error(new Error('Simulated database timeout mid-stream'));
            }
          },
        });
      },
    };

    const middleware = setupDevServer({ entry: '/src/entry-server.ts', streaming: true, mockModule: faultyModule });
    const req = new MockIncomingMessage('/faulty', 'GET', { accept: 'text/html' });
    const res = new MockServerResponse();

    let nextError = null;
    await middleware(req, res, (err) => {
      nextError = err;
    });

    // In mid-stream error: headers were already sent!
    if (res.headersSent && nextError) {
      recordFinding(
        '3.3',
        'Mid-stream error calls next(err) after HTTP headers were already sent',
        `Headers were sent (${res.headersSent}), then middleware called next(err) with '${nextError.message}'. In Express/Connect this causes ERR_HTTP_HEADERS_SENT or hangs the client connection.`,
        'high',
      );
    } else {
      recordPass('3.3', 'Mid-stream error handled safely');
    }
  } catch (err) {
    recordFinding('3.3', 'Mid-stream error uncaught exception', err.message);
  }

  // 3.4 URL matching with dots in query string or path segment (e.g. /release/v1.0 or /search?domain=foo.com)
  try {
    const middleware = setupDevServer({ resumable: true });
    const urlsWithDots = ['/release/v1.0', '/user/john.doe', '/search?ref=google.com'];

    let skippedCount = 0;
    for (const url of urlsWithDots) {
      const req = new MockIncomingMessage(url, 'GET', { accept: 'text/html' });
      const res = new MockServerResponse();

      let passedToNext = false;
      await middleware(req, res, () => {
        passedToNext = true;
      });

      if (passedToNext && !res.finished) {
        skippedCount++;
      }
    }

    if (skippedCount > 0) {
      recordFinding(
        '3.4',
        'url.includes(".") blindly bypasses SSR middleware for non-static routes and query parameters',
        `URLs with dots (${urlsWithDots.join(', ')}) were bypassed (${skippedCount}/${urlsWithDots.length}) because middleware checks url.includes('.') instead of path.extname.`,
        'high',
      );
    } else {
      recordPass('3.4', 'URLs with dots handled properly by SSR middleware');
    }
  } catch (err) {
    recordFinding('3.4', 'URL matching exception', err.message);
  }

  // =========================================================================
  // SUMMARY AND VERDICT
  // =========================================================================
  console.log('\n=======================================================');
  console.log(`Results: ${results.passed} PASSED, ${results.failed} FAILED / FINDINGS`);
  console.log('=======================================================\n');

  return results;
}

runEmpiricalChallenges()
  .then((res) => {
    if (res.failed > 0) {
      console.log(`Empirical challenge found ${res.failed} issues.`);
      process.exit(1);
    } else {
      console.log('All empirical challenges passed.');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('Fatal harness error:', err);
    process.exit(2);
  });
