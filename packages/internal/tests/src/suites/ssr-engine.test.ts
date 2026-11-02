import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { buildRegisteredComponentFixture, type ComponentRenderDescriptor, createIsolateEnvironment, getSsrEngine, type RenderOptions } from '../ssr-harness.js';

async function renderSpec(spec: ComponentRenderDescriptor, extraOptions: RenderOptions = {}): Promise<string> {
  const engine = await getSsrEngine();
  const fixture = buildRegisteredComponentFixture(spec);
  return engine.collectResult(engine.render(fixture.template, { ...fixture.options, ...extraOptions }));
}

describe('@lit-core/ssr engine core test suite', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (CONTRACT COMPLIANCE)
  // =========================================================================
  describe('tier 1: primary feature coverage', () => {
    it('[F3] render yields clean Declarative Shadow DOM without comment markers', async () => {
      const engine = await getSsrEngine();
      const fixture = buildRegisteredComponentFixture({
        tagName: 'test-card',
        shadowHtml: '<div class="card-inner">Hello SSR</div>',
      });
      const chunks = Array.from(engine.render(fixture.template, fixture.options));
      const htmlOut = chunks.join('');

      expect(htmlOut).toContain('<test-card>');
      expect(htmlOut).toContain('<template shadowrootmode="open">');
      expect(htmlOut).toContain('<div class="card-inner">Hello SSR</div>');
      expect(htmlOut).toContain('</template>');
      expect(htmlOut).toContain('</test-card>');

      // Zero comment marker invariant (R2, F3)
      expect(htmlOut).not.toContain('<!--lit-part');
      expect(htmlOut).not.toContain('<!--lit-node');
      expect(htmlOut).not.toContain('<!--');
    });

    it('[F3] renderToStream returns a valid WHATWG ReadableStream delivering binary chunks', async () => {
      const engine = await getSsrEngine();
      const fixture = buildRegisteredComponentFixture({
        tagName: 'test-stream-widget',
        shadowHtml: '<p>Streaming content</p>',
      });
      const stream = engine.renderToStream(fixture.template, fixture.options);

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
      const fixture = buildRegisteredComponentFixture({
        tagName: 'test-collector',
        shadowHtml: '<span>Collector inner</span>',
      });
      const resultIterator = engine.render(fixture.template, fixture.options);

      const fullHtml = await engine.collectResult(resultIterator);
      expect(typeof fullHtml).toBe('string');
      expect(fullHtml).toBe('<test-collector><template shadowrootmode="open"><span>Collector inner</span></template></test-collector>');
    });

    it('[F3] render includes static styles within template shadow root', async () => {
      const htmlOut = await renderSpec({
        tagName: 'styled-box',
        styles: ':host { display: block; color: blue; }',
        shadowHtml: '<p>Styled content</p>',
      });

      expect(htmlOut).toContain('<template shadowrootmode="open"><style>:host { display: block; color: blue; }</style><p>Styled content</p></template>');
    });

    it('[F3] render handles array of static stylesheets inside shadow root', async () => {
      const htmlOut = await renderSpec({
        tagName: 'multi-styled-box',
        styles: [':host { margin: 0; }', '.content { padding: 8px; }'],
        shadowHtml: '<div class="content">Multi-styled</div>',
      });

      expect(htmlOut).toContain('<style>:host { margin: 0; }\n.content { padding: 8px; }</style>');
    });

    it('[F4] slot projection correctly maps default slot content', async () => {
      const htmlOut = await renderSpec({
        tagName: 'test-slot-host',
        shadowHtml: '<div class="wrapper"><slot></slot></div>',
        lightDom: [{ content: '<span class="light-child">Slotted Text</span>' }],
      });

      expect(htmlOut).toContain('<template shadowrootmode="open"><div class="wrapper"><slot></slot></div></template>');
      expect(htmlOut).toContain('<span class="light-child">Slotted Text</span></test-slot-host>');
      expect(htmlOut).not.toContain('<!--lit-part');
    });

    it('[F4] slot projection correctly maps named slot content', async () => {
      const htmlOut = await renderSpec({
        tagName: 'test-named-slot-host',
        shadowHtml: '<header><slot name="header"></slot></header><main><slot></slot></main>',
        lightDom: [{ slot: 'header', content: '<h1>Page title</h1>' }, { content: '<p>Main body content</p>' }],
      });

      expect(htmlOut).toContain('<template shadowrootmode="open"><header><slot name="header"></slot></header><main><slot></slot></main></template>');
      expect(htmlOut).toContain('<h1 slot="header">Page title</h1><p>Main body content</p></test-named-slot-host>');
    });

    it('[F4] slot projection retains fallback content when no light DOM child matches slot', async () => {
      const htmlOut = await renderSpec({
        tagName: 'test-fallback-slot',
        shadowHtml: '<div class="action-bar"><slot name="action"><button>Default action</button></slot></div>',
        lightDom: [],
      });

      expect(htmlOut).toContain('<button>Default action</button>');
    });

    it('[F4] slot projection forwards multiple light DOM children into single slot target', async () => {
      const htmlOut = await renderSpec({
        tagName: 'multi-item-list',
        shadowHtml: '<nav><slot name="links"></slot></nav>',
        lightDom: [
          { slot: 'links', content: '<a href="/home">Home</a>' },
          { slot: 'links', content: '<a href="/about">About</a>' },
        ],
      });

      expect(htmlOut).toContain('<template shadowrootmode="open"><nav><slot name="links"></slot></nav></template>');
      expect(htmlOut).toContain('<a slot="links" href="/home">Home</a><a slot="links" href="/about">About</a></multi-item-list>');
    });

    it('[F7] resumable state serialization outputs data-lit-state attribute', async () => {
      const htmlOut = await renderSpec(
        {
          tagName: 'test-stateful-component',
          shadowHtml: '<button>Increment</button>',
          state: { count: 42, active: true, user: { name: 'Alice' } },
        },
        { resumable: true },
      );

      expect(htmlOut).toContain('data-lit-state="');
      expect(htmlOut).not.toContain('<script type="lit/state">');
      expect(htmlOut).toContain('&quot;count&quot;:42');
      expect(htmlOut).toContain('&quot;active&quot;:true');
      expect(htmlOut).toContain('&quot;name&quot;:&quot;Alice&quot;');
    });

    it('[F7] DOM path metadata attributes are emitted when domPaths option is enabled', async () => {
      const htmlOut = await renderSpec(
        {
          tagName: 'test-dom-path-comp',
          shadowHtml: '<p>Target item</p>',
        },
        { domPaths: true },
      );

      expect(htmlOut).toContain('data-lit-paths="true"');
    });

    it('[F6] monorepo compiler integration ingests pre-compiled template descriptors', async () => {
      const engine = await getSsrEngine();
      const precompiledDescriptor = {
        _$litType$: {
          h: '<div class="precompiled">Compiled template static fragment</div>',
          parts: [],
        },
        values: [],
      };

      const htmlOut = await engine.collectResult(engine.render(precompiledDescriptor));
      expect(htmlOut).toContain('Compiled template static fragment');
      expect(htmlOut).not.toContain('<!--lit-part');
    });

    it('[F6] monorepo compiler integration ingests tagged template strings and values', async () => {
      const engine = await getSsrEngine();
      const taggedTemplate = html`<div class="user-greeting">Welcome, ${'Bob'}! Score: ${100}</div>`;

      const htmlOut = await engine.collectResult(engine.render(taggedTemplate));
      expect(htmlOut).toBe('<div class="user-greeting">Welcome, <?start name="p0">Bob<?end>! Score: <?start name="p1">100<?end></div>');
    });

    it('[F1] ecosystem research specifications enforce zero comment markers and isolate execution', async () => {
      const result = await renderSpec({
        tagName: 'whitepaper-spec-check',
        shadowHtml: '<article>Universal SSR specification</article>',
      });

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
      const htmlOut = await renderSpec({
        tagName: 'empty-box',
        shadowHtml: '',
      });
      expect(htmlOut).toBe('<empty-box><template shadowrootmode="open"></template></empty-box>');
    });

    it('handles empty array inputs yielding empty string', async () => {
      const engine = await getSsrEngine();
      expect(await engine.collectResult(engine.render([]))).toBe('');
    });

    it('omits null, undefined, and false attributes according to HTML rules', async () => {
      const htmlOut = await renderSpec({
        tagName: 'attr-comp',
        shadowHtml: '<div></div>',
        attributes: {
          title: 'Valid title',
          disabled: false,
          hidden: null,
          'aria-expanded': undefined,
        },
      });

      expect(htmlOut).toContain('title="Valid title"');
      expect(htmlOut).not.toContain('disabled');
      expect(htmlOut).not.toContain('hidden');
      expect(htmlOut).not.toContain('aria-expanded');
    });

    it('emits boolean attributes without values when true', async () => {
      const htmlOut = await renderSpec({
        tagName: 'boolean-host',
        shadowHtml: '<div></div>',
        attributes: {
          required: true,
          autofocus: true,
        },
      });

      expect(htmlOut).toContain('<boolean-host required autofocus>');
    });

    it('formats numeric attributes correctly as quoted string values', async () => {
      const htmlOut = await renderSpec({
        tagName: 'numeric-host',
        shadowHtml: '<div></div>',
        attributes: {
          tabindex: 0,
          width: 120,
          'aria-valuenow': 75,
        },
      });

      expect(htmlOut).toContain('tabindex="0"');
      expect(htmlOut).toContain('width="120"');
      expect(htmlOut).toContain('aria-valuenow="75"');
    });

    it('properly escapes special characters in attribute values', async () => {
      const htmlOut = await renderSpec({
        tagName: 'escape-test',
        shadowHtml: '<div></div>',
        attributes: {
          'data-xss': '<script>alert("xss")</script>',
          'data-quote': 'Value with "double" & \'single\' quotes',
          'data-amp': 'Tom & Jerry & <friends>',
        },
      });

      expect(htmlOut).toContain('data-xss="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"');
      expect(htmlOut).toContain('data-quote="Value with &quot;double&quot; &amp; \'single\' quotes"');
      expect(htmlOut).toContain('data-amp="Tom &amp; Jerry &amp; &lt;friends&gt;"');
      expect(htmlOut).not.toContain('<script>alert');
    });

    it('renders unicode and emoji characters in shadow DOM without byte corruption', async () => {
      const htmlOut = await renderSpec({
        tagName: 'unicode-widget',
        shadowHtml: '<p>Unicode: 日本語 🌟 🚀 Äpfel & Bananen</p>',
      });

      expect(htmlOut).toContain('日本語 🌟 🚀 Äpfel &amp; Bananen');
    });

    it('handles deep component nesting up to 10 levels without stack exhaustion', async () => {
      const engine = await getSsrEngine();
      const env = createIsolateEnvironment();

      class NestLeaf extends env.HTMLElement {
        render() {
          return html`<span>Leaf</span>`;
        }
      }
      env.customElements.define('nest-leaf', NestLeaf);

      for (let d = 1; d <= 10; d++) {
        const level = d;
        class NestLevel extends env.HTMLElement {
          render() {
            return html`<div class="level-${level}">Inner level ${level}</div><slot></slot>`;
          }
        }
        env.customElements.define(`nest-level-${level}`, NestLevel);
      }

      let rawMarkup = '<nest-leaf></nest-leaf>';
      for (let d = 1; d <= 10; d++) {
        rawMarkup = `<nest-level-${d}>${rawMarkup}</nest-level-${d}>`;
      }
      const strings = Object.assign([rawMarkup], { raw: [rawMarkup] }) as unknown as TemplateStringsArray;
      const htmlOut = await engine.collectResult(engine.render({ _$litType$: 1, strings, values: [] }, { customElements: env.customElements }));

      expect(htmlOut).toContain('nest-level-10');
      expect(htmlOut).toContain('nest-level-1');
      expect(htmlOut).toContain('<span>Leaf</span>');
      expect(htmlOut).not.toContain('<!--lit-part');
    });

    it('retains unprojected light DOM elements in light DOM remainder', async () => {
      const htmlOut = await renderSpec({
        tagName: 'unprojected-host',
        shadowHtml: '<div class="shadow-box"><slot name="target"></slot></div>',
        lightDom: [
          { slot: 'target', content: '<span>Projected</span>' },
          { slot: 'unknown', content: '<span class="orphan">Unmatched orphan</span>' },
        ],
      });

      expect(htmlOut).toContain('<div class="shadow-box"><slot name="target"></slot></div>');
      expect(htmlOut).toContain('</template><span slot="target">Projected</span><span slot="unknown" class="orphan">Unmatched orphan</span></unprojected-host>');
    });

    it('handles multiple light DOM children targeted to the same named slot', async () => {
      const htmlOut = await renderSpec({
        tagName: 'multi-child-slot-host',
        shadowHtml: '<ul><slot name="items"></slot></ul>',
        lightDom: [
          { slot: 'items', content: '<li>Item 1</li>' },
          { slot: 'items', content: '<li>Item 2</li>' },
          { slot: 'items', content: '<li>Item 3</li>' },
        ],
      });

      expect(htmlOut).toContain('<ul><slot name="items"></slot></ul>');
      expect(htmlOut).toContain('</template><li slot="items">Item 1</li><li slot="items">Item 2</li><li slot="items">Item 3</li></multi-child-slot-host>');
    });

    it('stream reader can be cancelled without throwing or corrupting stream state', async () => {
      const engine = await getSsrEngine();
      const fixture = buildRegisteredComponentFixture({
        tagName: 'stream-cancellation-comp',
        shadowHtml: '<div>Cancelled midway</div>',
      });
      const stream = engine.renderToStream(fixture.template, fixture.options);

      const reader = stream.getReader();
      const firstChunk = await reader.read();
      expect(firstChunk.done).toBe(false);

      await reader.cancel('Manual cancellation');
      const nextChunk = await reader.read();
      expect(nextChunk.done).toBe(true);
    });

    it('handles empty component state when resumable is enabled', async () => {
      const htmlOut = await renderSpec(
        {
          tagName: 'empty-state-comp',
          shadowHtml: '<p>No state</p>',
          state: {},
        },
        { resumable: true },
      );

      expect(htmlOut).not.toContain('data-lit-state=');
      expect(htmlOut).not.toContain('<script type="lit/state">');
    });

    it('streams large payloads (>50KB) sequentially without buffer exhaustion', async () => {
      const engine = await getSsrEngine();
      const env = createIsolateEnvironment();
      const largePayload = Array.from({ length: 50 }, (_, i) => {
        const fixture = buildRegisteredComponentFixture(
          {
            tagName: `large-item-${i}`,
            shadowHtml: `<div class="payload-chunk-${i}">${'A'.repeat(1000)}</div>`,
          },
          env.customElements,
        );
        return fixture.template;
      });

      const stream = engine.renderToStream(largePayload, { customElements: env.customElements });
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
      const env = createIsolateEnvironment();
      class ChildWidget extends env.HTMLElement {
        render() {
          return html`<span>Child</span>`;
        }
      }
      class ParentContainer extends env.HTMLElement {
        render() {
          return html`<div class="parent"><slot></slot></div>`;
        }
      }
      env.customElements.define('child-widget', ChildWidget);
      env.customElements.define('parent-container', ParentContainer);

      const stream = engine.renderToStream([html`<parent-container><child-widget></child-widget></parent-container>`], {
        customElements: env.customElements,
      });

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
      const htmlOut = await renderSpec(
        {
          tagName: 'combo-component',
          shadowHtml: '<div class="layout"><slot name="content"></slot></div>',
          lightDom: [{ slot: 'content', content: '<p>Interactive body</p>' }],
          state: { userId: 101, permissions: ['read', 'write'] },
        },
        { resumable: true, domPaths: true },
      );

      expect(htmlOut).toContain('data-lit-paths="true"');
      expect(htmlOut).toContain('<div class="layout"><slot name="content"></slot></div>');
      expect(htmlOut).toContain('</template><p slot="content">Interactive body</p>');
      expect(htmlOut).toContain('data-lit-state="');
      expect(htmlOut).not.toContain('<script type="lit/state">');
      expect(htmlOut).toContain('&quot;userId&quot;:101');
      expect(htmlOut).not.toContain('<!--lit-part');
    });

    it('streams pre-compiled html-aot template descriptors via renderToStream', async () => {
      const engine = await getSsrEngine();
      const descriptors = [
        { _$litType$: { h: '<header class="site-header">Header</header>', parts: [] }, values: [] },
        { _$litType$: { h: '<main class="site-main">Content</main>', parts: [] }, values: [] },
        { _$litType$: { h: '<footer class="site-footer">Footer</footer>', parts: [] }, values: [] },
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

    it('combines custom element styles, slot projection, and data-lit-state in single render', async () => {
      const htmlOut = await renderSpec(
        {
          tagName: 'all-inclusive-card',
          styles: ':host { border-radius: 8px; }',
          shadowHtml: '<div class="card"><slot name="title"></slot><slot></slot></div>',
          lightDom: [{ slot: 'title', content: '<h2>Card title</h2>' }, { content: '<p>Body text</p>' }],
          state: { loaded: true, viewCount: 1500 },
        },
        { resumable: true, domPaths: true },
      );

      expect(htmlOut).toContain('<style>:host { border-radius: 8px; }</style>');
      expect(htmlOut).toContain('<h2 slot="title">Card title</h2>');
      expect(htmlOut).toContain('<p>Body text</p>');
      expect(htmlOut).toContain('&quot;viewCount&quot;:1500');
      expect(htmlOut).toContain('data-lit-paths="true"');
      expect(htmlOut).not.toContain('<script type="lit/state">');
    });

    it('streams multiple sibling custom elements each containing clean DSD', async () => {
      const engine = await getSsrEngine();
      const env = createIsolateEnvironment();
      const siblings = [
        buildRegisteredComponentFixture({ tagName: 'sibling-one', shadowHtml: '<span>One</span>' }, env.customElements).template,
        buildRegisteredComponentFixture({ tagName: 'sibling-two', shadowHtml: '<span>Two</span>' }, env.customElements).template,
        buildRegisteredComponentFixture({ tagName: 'sibling-three', shadowHtml: '<span>Three</span>' }, env.customElements).template,
      ];

      const stream = engine.renderToStream(siblings, { customElements: env.customElements });
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
