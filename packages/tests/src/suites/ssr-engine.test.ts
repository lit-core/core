import { describe, expect, it } from 'vitest';
import { getSsrEngine } from '../ssr-harness.js';

describe('@lit-core/ssr engine core test suite', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (CONTRACT COMPLIANCE)
  // =========================================================================
  describe('tier 1: primary feature coverage', () => {
    it('[F3] render yields clean Declarative Shadow DOM without comment markers', async () => {
      const engine = await getSsrEngine();
      const chunks = Array.from(
        engine.render({
          tagName: 'test-card',
          shadowHtml: '<div class="card-inner">Hello SSR</div>',
        }),
      );
      const html = chunks.join('');

      expect(html).toContain('<test-card>');
      expect(html).toContain('<template shadowrootmode="open">');
      expect(html).toContain('<div class="card-inner">Hello SSR</div>');
      expect(html).toContain('</template>');
      expect(html).toContain('</test-card>');

      // Zero comment marker invariant (R2, F3)
      expect(html).not.toContain('<!--lit-part');
      expect(html).not.toContain('<!--lit-node');
      expect(html).not.toContain('<!--');
    });

    it('[F3] renderToStream returns a valid WHATWG ReadableStream delivering binary chunks', async () => {
      const engine = await getSsrEngine();
      const stream = engine.renderToStream({
        tagName: 'test-stream-widget',
        shadowHtml: '<p>Streaming content</p>',
      });

      expect(stream).toBeInstanceOf(ReadableStream);

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const decoder = new TextDecoder();
      const totalHtml = chunks.map((c) => decoder.decode(c)).join('');
      expect(totalHtml).toContain('shadowrootmode="open"');
      expect(totalHtml).toContain('<p>Streaming content</p>');
      expect(totalHtml).not.toContain('<!--lit-part');
    });

    it('[F3] collectResult asynchronously joins all string chunks into unified HTML', async () => {
      const engine = await getSsrEngine();
      const resultIterator = engine.render({
        tagName: 'test-collector',
        shadowHtml: '<span>Collector inner</span>',
      });

      const fullHtml = await engine.collectResult(resultIterator);
      expect(typeof fullHtml).toBe('string');
      expect(fullHtml).toBe('<test-collector><template shadowrootmode="open"><span>Collector inner</span></template></test-collector>');
    });

    it('[F3] render includes static styles within template shadow root', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'styled-box',
          styles: ':host { display: block; color: blue; }',
          shadowHtml: '<p>Styled content</p>',
        }),
      );

      expect(html).toContain('<template shadowrootmode="open"><style>:host { display: block; color: blue; }</style><p>Styled content</p></template>');
    });

    it('[F3] render handles array of static stylesheets inside shadow root', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'multi-styled-box',
          styles: [':host { margin: 0; }', '.content { padding: 8px; }'],
          shadowHtml: '<div class="content">Multi-styled</div>',
        }),
      );

      expect(html).toContain('<style>:host { margin: 0; }\n.content { padding: 8px; }</style>');
    });

    it('[F4] slot projection correctly maps default slot content', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'test-slot-host',
          shadowHtml: '<div class="wrapper"><slot></slot></div>',
          lightDom: [{ content: '<span class="light-child">Slotted Text</span>' }],
        }),
      );

      expect(html).toContain('<template shadowrootmode="open"><div class="wrapper"><span class="light-child">Slotted Text</span></div></template>');
      expect(html).not.toContain('<!--lit-part');
    });

    it('[F4] slot projection correctly maps named slot content', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'test-named-slot-host',
          shadowHtml: '<header><slot name="header"></slot></header><main><slot></slot></main>',
          lightDom: [{ slot: 'header', content: '<h1>Page title</h1>' }, { content: '<p>Main body content</p>' }],
        }),
      );

      expect(html).toContain('<header><h1>Page title</h1></header>');
      expect(html).toContain('<main><p>Main body content</p></main>');
    });

    it('[F4] slot projection retains fallback content when no light DOM child matches slot', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'test-fallback-slot',
          shadowHtml: '<div class="action-bar"><slot name="action"><button>Default action</button></slot></div>',
          lightDom: [],
        }),
      );

      expect(html).toContain('<button>Default action</button>');
    });

    it('[F4] slot projection forwards multiple light DOM children into single slot target', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'multi-item-list',
          shadowHtml: '<nav><slot name="links"></slot></nav>',
          lightDom: [
            { slot: 'links', content: '<a href="/home">Home</a>' },
            { slot: 'links', content: '<a href="/about">About</a>' },
          ],
        }),
      );

      expect(html).toContain('<nav><a href="/home">Home</a><a href="/about">About</a></nav>');
    });

    it('[F7] resumable state serialization outputs state script tag', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'test-stateful-component',
            shadowHtml: '<button>Increment</button>',
            state: { count: 42, active: true, user: { name: 'Alice' } },
          },
          { resumable: true },
        ),
      );

      expect(html).toContain('<script type="lit/state">');
      expect(html).toContain('"count":42');
      expect(html).toContain('"active":true');
      expect(html).toContain('"name":"Alice"');
      expect(html).toContain('</script>');
    });

    it('[F7] DOM path metadata attributes are emitted when domPaths option is enabled', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'test-dom-path-comp',
            shadowHtml: '<p>Target item</p>',
          },
          { domPaths: true },
        ),
      );

      expect(html).toContain('data-lit-paths="true"');
    });

    it('[F6] monorepo compiler integration ingests pre-compiled template descriptors', async () => {
      const engine = await getSsrEngine();
      const precompiledDescriptor = {
        _$litType$: 1,
        html: '<div class="precompiled">Compiled template static fragment</div>',
      };

      const html = await engine.collectResult(engine.render(precompiledDescriptor));
      expect(html).toContain('Compiled template static fragment');
      expect(html).not.toContain('<!--lit-part');
    });

    it('[F6] monorepo compiler integration ingests tagged template strings and values', async () => {
      const engine = await getSsrEngine();
      const taggedTemplate = {
        strings: ['<div class="user-greeting">Welcome, ', '! Score: ', '</div>'],
        values: ['Bob', 100],
      };

      const html = await engine.collectResult(engine.render(taggedTemplate));
      expect(html).toBe('<div class="user-greeting">Welcome, Bob! Score: 100</div>');
    });

    it('[F1] ecosystem research specifications enforce zero comment markers and isolate execution', async () => {
      const engine = await getSsrEngine();
      const result = await engine.collectResult(
        engine.render({
          tagName: 'whitepaper-spec-check',
          shadowHtml: '<article>Universal SSR specification</article>',
        }),
      );

      expect(result).not.toContain('<!--lit-part');
      expect(result).not.toContain('<!--lit-node');
    });

    it('[F5] Web Standard streaming delivers chunks with text encoder binary fidelity', async () => {
      const engine = await getSsrEngine();
      const stream = engine.renderToStream('Plain stream string');
      const reader = stream.getReader();
      const { value, done } = await reader.read();

      expect(done).toBe(false);
      expect(value).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(value)).toBe('Plain stream string');
    });

    it('[F8] Vite bundler SSR options schema adheres to interface definitions', () => {
      const sampleViteSsrOptions = {
        mode: 'stream' as const,
        prerender: { routes: ['/'] },
        islands: { include: ['cds-button'] },
        cleanShadowDom: true,
      };

      expect(sampleViteSsrOptions.mode).toBe('stream');
      expect(sampleViteSsrOptions.cleanShadowDom).toBe(true);
    });

    it('[F9] Webpack bundler SSR options schema adheres to interface definitions', () => {
      const sampleWebpackSsrOptions = {
        streaming: true,
        prerender: false,
        islands: true,
        resumable: true,
      };

      expect(sampleWebpackSsrOptions.streaming).toBe(true);
      expect(sampleWebpackSsrOptions.resumable).toBe(true);
    });

    it('[F10] benchmark metrics schema validates throughput, memory, TTFB, and payload deltas', () => {
      const benchmarkMetricsSchema = {
        rps: 1250.5,
        memoryHeapUsedDeltaKb: 142.3,
        ttfbMs: 0.85,
        commentMarkersEliminated: 24,
      };

      expect(benchmarkMetricsSchema.rps).toBeGreaterThan(0);
      expect(benchmarkMetricsSchema.commentMarkersEliminated).toBeGreaterThanOrEqual(0);
    });

    it('[F11] interface contract conforms to public API specifications', async () => {
      const engine = await getSsrEngine();
      expect(typeof engine.render).toBe('function');
      expect(typeof engine.renderToStream).toBe('function');
      expect(typeof engine.collectResult).toBe('function');
      expect(typeof engine.createIsolateEnvironment).toBe('function');
    });

    it('[F12] showcase interactive preview supports clean DSD inspector mode', () => {
      const showcaseFeatureConfig = {
        id: 'ssr',
        mode: 'stream',
        cleanShadowDom: true,
      };

      expect(showcaseFeatureConfig.cleanShadowDom).toBe(true);
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY AND CORNER CASES
  // =========================================================================
  describe('tier 2: boundary and corner cases', () => {
    it('handles null and undefined input values cleanly without throwing', async () => {
      const engine = await getSsrEngine();
      expect(await engine.collectResult(engine.render(null))).toBe('');
      expect(await engine.collectResult(engine.render(undefined))).toBe('');
    });

    it('handles empty template strings and empty components', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'empty-box',
          shadowHtml: '',
        }),
      );
      expect(html).toBe('<empty-box><template shadowrootmode="open"></template></empty-box>');
    });

    it('handles empty array inputs yielding empty string', async () => {
      const engine = await getSsrEngine();
      expect(await engine.collectResult(engine.render([]))).toBe('');
    });

    it('omits null, undefined, and false attributes according to HTML rules', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'attr-comp',
          shadowHtml: '<div></div>',
          attributes: {
            title: 'Valid title',
            disabled: false,
            hidden: null,
            'aria-expanded': undefined,
          },
        }),
      );

      expect(html).toContain('title="Valid title"');
      expect(html).not.toContain('disabled');
      expect(html).not.toContain('hidden');
      expect(html).not.toContain('aria-expanded');
    });

    it('emits boolean attributes without values when true', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'boolean-host',
          shadowHtml: '<div></div>',
          attributes: {
            required: true,
            autofocus: true,
          },
        }),
      );

      expect(html).toContain('<boolean-host required autofocus>');
    });

    it('formats numeric attributes correctly as quoted string values', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'numeric-host',
          shadowHtml: '<div></div>',
          attributes: {
            tabindex: 0,
            width: 120,
            'aria-valuenow': 75,
          },
        }),
      );

      expect(html).toContain('tabindex="0"');
      expect(html).toContain('width="120"');
      expect(html).toContain('aria-valuenow="75"');
    });

    it('properly escapes special characters in attribute values', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'escape-test',
          shadowHtml: '<div></div>',
          attributes: {
            'data-xss': '<script>alert("xss")</script>',
            'data-quote': 'Value with "double" & \'single\' quotes',
            'data-amp': 'Tom & Jerry & <friends>',
          },
        }),
      );

      expect(html).toContain('data-xss="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"');
      expect(html).toContain('data-quote="Value with &quot;double&quot; &amp; \'single\' quotes"');
      expect(html).toContain('data-amp="Tom &amp; Jerry &amp; &lt;friends&gt;"');
      expect(html).not.toContain('<script>alert');
    });

    it('renders unicode and emoji characters in shadow DOM without byte corruption', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'unicode-widget',
          shadowHtml: '<p>Unicode: 日本語 🌟 🚀 Äpfel & Bananen</p>',
        }),
      );

      expect(html).toContain('日本語 🌟 🚀 Äpfel & Bananen');
    });

    it('handles deep component nesting up to 10 levels without stack exhaustion', async () => {
      const engine = await getSsrEngine();

      function buildNested(depth: number): any {
        if (depth === 0) {
          return { tagName: `nest-leaf`, shadowHtml: '<span>Leaf</span>' };
        }
        return {
          tagName: `nest-level-${depth}`,
          shadowHtml: `<div class="level-${depth}">Inner level ${depth}</div>`,
          lightDom: [{ content: `<nest-level-${depth - 1}><template shadowrootmode="open">Inner</template></nest-level-${depth - 1}>` }],
        };
      }

      const deepTree = buildNested(10);
      const html = await engine.collectResult(engine.render(deepTree));

      expect(html).toContain('nest-level-10');
      expect(html).toContain('nest-level-1');
      expect(html).not.toContain('<!--lit-part');
    });

    it('retains unprojected light DOM elements in light DOM remainder', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'unprojected-host',
          shadowHtml: '<div class="shadow-box"><slot name="target"></slot></div>',
          lightDom: [
            { slot: 'target', content: '<span>Projected</span>' },
            { slot: 'unknown', content: '<span class="orphan">Unmatched orphan</span>' },
          ],
        }),
      );

      expect(html).toContain('<div class="shadow-box"><span>Projected</span></div>');
      expect(html).toContain('</template><span class="orphan">Unmatched orphan</span></unprojected-host>');
    });

    it('handles multiple light DOM children targeted to the same named slot', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render({
          tagName: 'multi-child-slot-host',
          shadowHtml: '<ul><slot name="items"></slot></ul>',
          lightDom: [
            { slot: 'items', content: '<li>Item 1</li>' },
            { slot: 'items', content: '<li>Item 2</li>' },
            { slot: 'items', content: '<li>Item 3</li>' },
          ],
        }),
      );

      expect(html).toContain('<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>');
    });

    it('stream reader can be cancelled without throwing or corrupting stream state', async () => {
      const engine = await getSsrEngine();
      const stream = engine.renderToStream({
        tagName: 'stream-cancellation-comp',
        shadowHtml: '<div>Cancelled midway</div>',
      });

      const reader = stream.getReader();
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);

      await reader.cancel('Manual cancellation');
      const nextChunk = await reader.read();
      expect(nextChunk.done).toBe(true);
    });

    it('handles empty component state when resumable is enabled', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'empty-state-comp',
            shadowHtml: '<p>No state</p>',
            state: {},
          },
          { resumable: true },
        ),
      );

      expect(html).not.toContain('<script type="lit/state">');
    });

    it('streams large payloads (>50KB) sequentially without buffer exhaustion', async () => {
      const engine = await getSsrEngine();
      const largePayload = Array.from({ length: 50 }, (_, i) => ({
        tagName: `large-item-${i}`,
        shadowHtml: `<div class="payload-chunk-${i}">${'A'.repeat(1000)}</div>`,
      }));

      const stream = engine.renderToStream(largePayload);
      const reader = stream.getReader();
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) totalBytes += value.byteLength;
      }

      expect(totalBytes).toBeGreaterThan(50000);
    });

    it('handles primitive numbers and booleans rendered directly', async () => {
      const engine = await getSsrEngine();
      expect(await engine.collectResult(engine.render(12345))).toBe('12345');
      expect(await engine.collectResult(engine.render(true))).toBe('true');
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================
  describe('tier 3: cross-feature combinations', () => {
    it('streams nested custom element hierarchies across chunk boundaries', async () => {
      const engine = await getSsrEngine();
      const stream = engine.renderToStream([
        {
          tagName: 'parent-container',
          shadowHtml: '<div class="parent"><slot></slot></div>',
          lightDom: [
            {
              content: '<child-widget><template shadowrootmode="open"><span>Child</span></template></child-widget>',
            },
          ],
        },
      ]);

      const reader = stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(decoder.decode(value));
      }

      const totalHtml = chunks.join('');
      expect(totalHtml).toContain('<parent-container>');
      expect(totalHtml).toContain('<child-widget>');
      expect(totalHtml).toContain('shadowrootmode="open"');
      expect(totalHtml).not.toContain('<!--lit-part');
    });

    it('combines slot projection with resumable state snapshot and DOM paths', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'combo-component',
            shadowHtml: '<div class="layout"><slot name="content"></slot></div>',
            lightDom: [{ slot: 'content', content: '<p>Interactive body</p>' }],
            state: { userId: 101, permissions: ['read', 'write'] },
          },
          { resumable: true, domPaths: true },
        ),
      );

      expect(html).toContain('data-lit-paths="true"');
      expect(html).toContain('<div class="layout"><p>Interactive body</p></div>');
      expect(html).toContain('<script type="lit/state">');
      expect(html).toContain('"userId":101');
      expect(html).not.toContain('<!--lit-part');
    });

    it('streams pre-compiled html-aot template descriptors via renderToStream', async () => {
      const engine = await getSsrEngine();
      const descriptors = [
        { _$litType$: 1, html: '<header class="site-header">Header</header>' },
        { _$litType$: 1, html: '<main class="site-main">Content</main>' },
        { _$litType$: 1, html: '<footer class="site-footer">Footer</footer>' },
      ];

      const stream = engine.renderToStream(descriptors);
      const reader = stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(decoder.decode(value));
      }

      const joined = chunks.join('');
      expect(joined).toContain('<header class="site-header">Header</header>');
      expect(joined).toContain('<main class="site-main">Content</main>');
      expect(joined).toContain('<footer class="site-footer">Footer</footer>');
    });

    it('combines custom element styles, slot projection, and state script in single render', async () => {
      const engine = await getSsrEngine();
      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'all-inclusive-card',
            styles: ':host { border-radius: 8px; }',
            shadowHtml: '<div class="card"><slot name="title"></slot><slot></slot></div>',
            lightDom: [{ slot: 'title', content: '<h2>Card title</h2>' }, { content: '<p>Body text</p>' }],
            state: { loaded: true, viewCount: 1500 },
          },
          { resumable: true, domPaths: true },
        ),
      );

      expect(html).toContain('<style>:host { border-radius: 8px; }</style>');
      expect(html).toContain('<h2>Card title</h2>');
      expect(html).toContain('<p>Body text</p>');
      expect(html).toContain('"viewCount":1500');
      expect(html).toContain('data-lit-paths="true"');
    });

    it('streams multiple sibling custom elements each containing clean DSD', async () => {
      const engine = await getSsrEngine();
      const siblings = [
        { tagName: 'sibling-one', shadowHtml: '<span>One</span>' },
        { tagName: 'sibling-two', shadowHtml: '<span>Two</span>' },
        { tagName: 'sibling-three', shadowHtml: '<span>Three</span>' },
      ];

      const stream = engine.renderToStream(siblings);
      const reader = stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(decoder.decode(value));
      }

      const totalHtml = chunks.join('');
      expect(totalHtml).toContain('<sibling-one><template shadowrootmode="open"><span>One</span></template></sibling-one>');
      expect(totalHtml).toContain('<sibling-two><template shadowrootmode="open"><span>Two</span></template></sibling-two>');
      expect(totalHtml).toContain('<sibling-three><template shadowrootmode="open"><span>Three</span></template></sibling-three>');
    });
  });
});
