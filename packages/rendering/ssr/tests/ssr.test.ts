import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import {
  type CompiledTemplateResult,
  CSSStyleSheetStub,
  CustomEventStub,
  collectResult,
  createIsolateEnvironment,
  createStreamFromIterator,
  DocumentStub,
  defaultDocumentStub,
  HTMLElementStub,
  IsolateCustomElementRegistry,
  isCompiledTemplateResult,
  KeyboardEventStub,
  LIT_NOTHING,
  renderToStream,
  renderToString,
  type SsrTemplatePlanV2,
  StyleDeduplicator,
} from '../src/index.js';

describe('@lit-core/ssr universal core engine', () => {
  describe('Feature F2: Pure V8 Isolate Minimal Environment (ISME)', () => {
    it('creates isolated environment without window, document, or node:vm', () => {
      const env = createIsolateEnvironment();
      expect(env.customElements).toBeDefined();
      expect(env.HTMLElement).toBeDefined();
      expect(env.CustomEvent).toBeDefined();
      expect(env.CSSStyleSheet).toBeDefined();

      const el = new env.HTMLElement();
      expect(el.tagName).toBe('CUSTOM-ELEMENT');
      expect(el.getAttribute('title')).toBeNull();

      el.setAttribute('title', 'test');
      expect(el.getAttribute('title')).toBe('test');
      expect(el.hasAttribute('title')).toBe(true);

      el.removeAttribute('title');
      expect(el.hasAttribute('title')).toBe(false);

      const shadow = el.attachShadow({ mode: 'open' });
      expect(shadow.mode).toBe('open');
      expect(shadow.host).toBe(el);
      expect(el.shadowRoot).toBe(shadow);
    });

    it('handles CustomEvent preventDefault and details', () => {
      const event = new CustomEventStub('action', {
        detail: { count: 42 },
        cancelable: true,
      });
      expect(event.type).toBe('action');
      expect(event.detail).toEqual({ count: 42 });
      expect(event.defaultPrevented).toBe(false);

      event.preventDefault();
      expect(event.defaultPrevented).toBe(true);
    });

    it('handles CSSStyleSheet replaceSync', () => {
      const sheet = new CSSStyleSheetStub();
      sheet.replaceSync(':host { display: block; }');
      expect(sheet.cssRules).toEqual([':host { display: block; }']);
    });

    it('provides referentially stable DocumentStub with body, head, and documentElement', () => {
      const el1 = new HTMLElementStub('DIV');
      const el2 = new HTMLElementStub('SPAN');
      expect(el1.ownerDocument).toBe(el2.ownerDocument);
      expect(el1.ownerDocument).toBe(defaultDocumentStub);
      expect(el1.ownerDocument).toBeInstanceOf(DocumentStub);
      expect(el1.ownerDocument.body).toBeDefined();
      expect(el1.ownerDocument.body.tagName).toBe('BODY');
      expect(el1.ownerDocument.head).toBeDefined();
      expect(el1.ownerDocument.head.tagName).toBe('HEAD');
      expect(el1.ownerDocument.documentElement).toBeDefined();
      expect(el1.ownerDocument.documentElement.tagName).toBe('HTML');
      expect(el1.ownerDocument.createElement('button').tagName).toBe('BUTTON');
      expect(el1.ownerDocument.createDocumentFragment().tagName).toBe('#DOCUMENT-FRAGMENT');
    });

    it('handles KeyboardEventStub methods and defaultPrevented', () => {
      const ev = new KeyboardEventStub('keydown', {
        key: 'Enter',
        code: 'Enter',
        cancelable: true,
        bubbles: true,
      });
      expect(ev.type).toBe('keydown');
      expect(ev.key).toBe('Enter');
      expect(ev.cancelable).toBe(true);
      expect(ev.bubbles).toBe(true);
      expect(ev.defaultPrevented).toBe(false);
      ev.preventDefault();
      expect(ev.defaultPrevented).toBe(true);
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    });

    it('isolates custom element registries across scopes', () => {
      const parentRegistry = new IsolateCustomElementRegistry();
      class GlobalWidget extends HTMLElementStub {}
      parentRegistry.define('global-widget', GlobalWidget);

      const scopedEnv = createIsolateEnvironment(parentRegistry);
      class ScopedWidget extends HTMLElementStub {}
      scopedEnv.customElements.define('scoped-widget', ScopedWidget);

      expect(scopedEnv.customElements.get('scoped-widget')).toBe(ScopedWidget);
      expect(scopedEnv.customElements.get('global-widget')).toBe(GlobalWidget);
      expect(parentRegistry.get('scoped-widget')).toBeUndefined();
    });
  });

  describe('Feature F3: Clean Declarative Shadow DOM emission', () => {
    it('emits clean HTML with zero comment markers', () => {
      const template = html`<div><h1>Welcome ${'Alex'}</h1><p>Status: ${'Active'}</p></div>`;
      const output = renderToString(template);

      expect(output).toBe('<div><h1>Welcome <?start name="p0">Alex<?end></h1><p>Status: <?start name="p1">Active<?end></p></div>');
      expect(output).not.toContain('<!--lit-part');
      expect(output).not.toContain('<!--/lit-part');
      expect(output).not.toContain('<!--lit-node');
    });

    it('escapes dynamic strings and attribute values safely', () => {
      const dangerous = '<script>alert("xss")</script> & "quotes"';
      const template = html`<div title="${dangerous}">${dangerous}</div>`;
      const output = renderToString(template);

      expect(output).not.toContain('<script>');
      expect(output).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;');
    });

    it('handles boolean attributes accurately', () => {
      const tplTrue = html`<button ?disabled="${true}">Click</button>`;
      const tplFalse = html`<button ?disabled="${false}">Click</button>`;

      expect(renderToString(tplTrue)).toBe('<button disabled>Click</button>');
      expect(renderToString(tplFalse)).toBe('<button>Click</button>');
    });

    it('renders custom elements with native Declarative Shadow DOM', () => {
      class UserCard extends HTMLElementStub {
        render() {
          return html`<div class="card"><h2>${'John Doe'}</h2></div>`;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('user-card', UserCard);

      const template = html`<user-card></user-card>`;
      const output = renderToString(template, { customElements: env.customElements });

      expect(output).toContain('<user-card>');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<div class="card"><h2>John Doe</h2></div>');
      expect(output).toContain('</template>');
      expect(output).toContain('</user-card>');
      expect(output).not.toContain('<!--lit-part');
    });

    it('enforces maximum recursion depth safeguard', () => {
      const recursive: any = [];
      recursive.push(recursive);

      expect(() => {
        renderToString(recursive, { depth: 10 });
      }).toThrow(RangeError);
    });
  });

  describe('Feature F4: Deterministic server-side slot projection', () => {
    it('projects named slots and default slots across component boundaries', () => {
      class LayoutShell extends HTMLElementStub {
        render() {
          return html`
            <header><slot name="header"></slot></header>
            <main><slot></slot></main>
          `;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('layout-shell', LayoutShell);

      const template = html`
        <layout-shell>
          <h1 slot="header">App title</h1>
          <p>Main content paragraph</p>
        </layout-shell>
      `;

      const output = renderToString(template, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(output).toContain('<header><h1 slot="header">App title</h1></header>');
      expect(output).toContain('<main><p>Main content paragraph</p></main>');
      expect(output).not.toContain('<slot');
    });

    it('evaluates slot fallback content when no child is assigned', () => {
      class FallbackWidget extends HTMLElementStub {
        render() {
          return html`
            <div class="box">
              <slot name="extra"><span class="badge">Default badge</span></slot>
            </div>
          `;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('fallback-widget', FallbackWidget);

      const template = html`<fallback-widget></fallback-widget>`;
      const output = renderToString(template, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(output).toContain('<span class="badge">Default badge</span>');
    });

    it('isolates slots across nested custom elements preventing slot bleed', () => {
      class OuterCard extends HTMLElementStub {
        render() {
          return html`<div class="outer"><slot name="header"></slot><slot></slot></div>`;
        }
      }

      class InnerCard extends HTMLElementStub {
        render() {
          return html`<div class="inner"><slot name="header"></slot><slot></slot></div>`;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('outer-card', OuterCard);
      env.customElements.define('inner-card', InnerCard);

      const template = html`
        <outer-card>
          <h1 slot="header">Outer header</h1>
          <inner-card>
            <h2 slot="header">Inner header</h2>
            <p>Inner body</p>
          </inner-card>
          <p>Outer body</p>
        </outer-card>
      `;

      const output = renderToString(template, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(output).toContain('<h1 slot="header">Outer header</h1>');
      expect(output).toContain('<h2 slot="header">Inner header</h2>');
      expect(output).toContain('Inner body');
      expect(output).toContain('Outer body');
    });

    it('projects default slot when slot tag contains classes and styles', () => {
      const env = createIsolateEnvironment();
      class CardCe extends HTMLElementStub {
        render() {
          return html`<div class="card"><slot class="main-slot" style="display:contents">fallback</slot></div>`;
        }
      }
      env.customElements.define('card-ce', CardCe);
      const res = renderToString(html`<card-ce><p>Projected body</p></card-ce>`, { customElements: env.customElements, mode: 'flattened' });
      expect(res).toBe('<card-ce><div class="card"><p>Projected body</p></div></card-ce>');
    });

    it('projects named slot regardless of attribute order', () => {
      const env = createIsolateEnvironment();
      class HeaderCe extends HTMLElementStub {
        render() {
          return html`<header><slot class="cls" name="header" id="h1">fallback</slot></header>`;
        }
      }
      env.customElements.define('header-ce-attr', HeaderCe);
      const res = renderToString(html`<header-ce-attr><h1 slot="header">Header Title</h1></header-ce-attr>`, { customElements: env.customElements, mode: 'flattened' });
      expect(res).toBe('<header-ce-attr><header><h1 slot="header">Header Title</h1></header></header-ce-attr>');
    });

    it('projects self-closing slots with multiple attributes', () => {
      const env = createIsolateEnvironment();
      class SelfCloseCe extends HTMLElementStub {
        render() {
          return html`<header><slot class="c" name="h"></slot></header><main><slot class="m"></slot></main>`;
        }
      }
      env.customElements.define('self-close-ce', SelfCloseCe);
      const res = renderToString(html`<self-close-ce><h1 slot="h">Header</h1><p>Body</p></self-close-ce>`, { customElements: env.customElements, mode: 'flattened' });
      expect(res).toBe('<self-close-ce><header><h1 slot="h">Header</h1></header><main><p>Body</p></main></self-close-ce>');
    });

    it('resolves nested slot fallback chains when outer slot is unassigned', () => {
      const env = createIsolateEnvironment();
      class NestedChainCe extends HTMLElementStub {
        render() {
          return html`<div class="box"><slot name="outer"><slot name="inner">deep fb</slot></slot></div>`;
        }
      }
      env.customElements.define('nested-chain-ce', NestedChainCe);
      const res = renderToString(html`<nested-chain-ce><span slot="inner">Inner Content</span></nested-chain-ce>`, { customElements: env.customElements, mode: 'flattened' });
      expect(res).toBe('<nested-chain-ce><div class="box"><span slot="inner">Inner Content</span></div></nested-chain-ce>');
    });
  });

  describe('Feature F5: Web Standard WHATWG ReadableStream streaming', () => {
    it('streams HTML chunks and resolves with collectResult', async () => {
      const template = html`<div class="stream"><span>Chunk 1</span><span>${'Chunk 2'}</span></div>`;
      const stream = renderToStream(template);

      expect(stream).toBeInstanceOf(ReadableStream);

      const collected = await collectResult(stream);
      expect(collected).toBe('<div class="stream"><span>Chunk 1</span><span>Chunk 2</span></div>');
    });

    it('streams templates with empty string chunks without deadlocking', async () => {
      const template = html`<div>${''}<span>${'Visible'}</span>${''}</div>`;
      const stream = renderToStream(template);
      const result = await collectResult(stream);
      expect(result).toBe('<div><?start name="p0"><?end><span>Visible</span><?start name="p2"><?end></div>');
    });

    it('handles completely empty template values in renderToStream', async () => {
      const stream = renderToStream('');
      const result = await collectResult(stream);
      expect(result).toBe('');
    });

    it('handles iterator yielding multiple consecutive empty strings', async () => {
      function* emptyGen(): IterableIterator<string> {
        yield '';
        yield '';
        yield '<p>Content</p>';
        yield '';
      }
      const stream = createStreamFromIterator(emptyGen());
      const result = await collectResult(stream);
      expect(result).toBe('<p>Content</p>');
    });

    it('supports reader cancellation without memory leaks', async () => {
      const infiniteList = {
        *[Symbol.iterator]() {
          let count = 0;
          while (true) {
            yield `<div>Item ${count++}</div>`;
          }
        },
      };

      const stream = renderToStream(infiniteList);
      const reader = stream.getReader();

      const chunk1 = await reader.read();
      expect(chunk1.done).toBe(false);
      expect(chunk1.value).toBeDefined();

      await reader.cancel('client abort');
      const chunk2 = await reader.read();
      expect(chunk2.done).toBe(true);
    });
  });

  describe('Feature F6: Compiler bridge & html-aot ingestion', () => {
    it('renders @lit-core/html-aot CompiledTemplateResult descriptors', () => {
      const compiledResult: CompiledTemplateResult = {
        _$litType$: {
          h: '<p>Hello <?>!</p>',
          parts: [{ type: 2, index: 1 }],
        },
        values: ['World'],
      };

      expect(isCompiledTemplateResult(compiledResult)).toBe(true);

      const output = renderToString(compiledResult);
      expect(output).toBe('<p>Hello World!</p>');
    });

    it('interpolates attribute parts in CompiledTemplateResult', () => {
      const compiledResult: CompiledTemplateResult = {
        _$litType$: {
          h: '<button><?> </button>',
          parts: [
            { type: 1, index: 0, name: 'class', strings: ['', ''] },
            { type: 1, index: 0, name: 'disabled', ctorType: 4 },
            { type: 2, index: 1 },
          ],
        },
        values: ['primary', true, 'Save'],
      };

      const output = renderToString(compiledResult);
      expect(output).toBe('<button class="primary" disabled>Save </button>');
    });

    it('deduplicates shared stylesheets via StyleDeduplicator', () => {
      const deduplicator = new StyleDeduplicator();

      class CompA {
        static styles = ['/* @lit-core/css-fuse */ :host { box-sizing: border-box; }', ':host { color: red; }'];
        render() {
          return '';
        }
      }

      class CompB {
        static styles = ['/* @lit-core/css-fuse */ :host { box-sizing: border-box; }', ':host { color: blue; }'];
        render() {
          return '';
        }
      }

      const resA = deduplicator.processComponentStyles(CompA);
      const resB = deduplicator.processComponentStyles(CompB);

      expect(resA.sharedSheets.length).toBe(1);
      expect(resA.localStyles).toEqual([':host { color: red; }']);

      expect(resB.sharedSheets.length).toBe(1);
      expect(resB.localStyles).toEqual([':host { color: blue; }']);

      // Deduplicated globally: collected only once
      expect(deduplicator.getCollectedStyles().length).toBe(1);
    });

    it('preserves collected styles across multiple instances via cached sharedEntries', () => {
      StyleDeduplicator.resetCache();
      const dedup1 = new StyleDeduplicator();
      const longCss =
        ':host { display: block; padding: 24px; margin: 12px; background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 1200px; color: #333333; font-family: sans-serif; line-height: 1.5; text-align: left; vertical-align: baseline; }';

      class CachedComponent extends HTMLElementStub {
        static styles = [longCss];
      }

      const res1 = dedup1.processComponentStyles(CachedComponent);
      expect(res1.sharedSheets.length).toBe(1);
      expect(dedup1.getCollectedStyles().length).toBe(1);

      // Second deduplicator instance with fresh seenSharedSheets and collectedStyles
      const dedup2 = new StyleDeduplicator();
      const res2 = dedup2.processComponentStyles(CachedComponent);
      expect(res2.sharedSheets.length).toBe(1);
      // Verify cached hit populated dedup2.collectedStyles via sharedEntries
      expect(dedup2.getCollectedStyles().length).toBe(1);
      expect(dedup2.getCollectedStyles()[0]).toBe(longCss.trim());
    });

    it('handles Lit sentinels nothing and noChange', () => {
      const template = html`<div ?hidden="${LIT_NOTHING}">Text ${LIT_NOTHING}</div>`;
      const output = renderToString(template);
      expect(output).toBe('<div>Text <?start name="p1"><?end></div>');
    });
  });

  describe('Feature F7: Resumable state serialization', () => {
    it('serializes component state snapshot into data-lit-state with breakout escaping', () => {
      class ProfileWidget extends HTMLElementStub {
        userId = 101;
        bio = 'Engineer <script>alert("hack")</script>';

        render() {
          return html`<div>User: ${this.userId}</div>`;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('profile-widget', ProfileWidget);

      const template = html`<profile-widget></profile-widget>`;
      const output = renderToString(template, {
        customElements: env.customElements,
        resumable: true,
      });

      expect(output).toContain('data-lit-state="');
      expect(output).not.toContain('<script type="lit/state">');
      expect(output).toContain('\\u003cscript&gt;alert');
      expect(output).not.toContain('<script>alert');
    });
  });

  describe('Feature F8: Ahead-of-time SSR template plan rendering', () => {
    it('renders compiled templates using SsrTemplatePlan directly', () => {
      const plan: SsrTemplatePlanV2 = {
        v: 2,
        h: 'test-user-card',
        opcodes: [
          {
            type: 'open',
            tag: 'div',
            staticAttrs: { class: 'user-card' },
            dynamicAttrs: [{ type: 'attribute', name: 'id', index: 0 }],
            closeIndex: 6,
          },
          { type: 'open', tag: 'span', staticAttrs: { class: 'name' }, closeIndex: 3 },
          { type: 'part', index: 1 },
          { type: 'close', tag: 'span' },
          {
            type: 'open',
            tag: 'span',
            staticAttrs: { class: 'active' },
            dynamicAttrs: [{ type: 'boolean', name: 'data-active', index: 2 }],
            closeIndex: 5,
          },
          { type: 'close', tag: 'span' },
          { type: 'close', tag: 'div' },
        ],
        markerSites: [],
        parts: [],
      };

      const compiledTemplate = {
        _$litType$: {
          h: '<div class="user-card" id="<?><span class="name"><?></span><span class="active" ?></span></div>',
          parts: [
            { type: 1, index: 0, name: 'id' },
            { type: 2, index: 1 },
            { type: 1, index: 2, name: 'data-active' },
          ],
          ssrPlan: plan,
        },
        values: ['usr-42', 'Alice', true],
      };

      const output = renderToString(compiledTemplate as any);
      expect(output).toBe('<div class="user-card" id="usr-42"><span class="name">Alice</span><span class="active" data-active></span></div>');
    });

    it('expands custom elements defined in SsrTemplatePlan with Declarative Shadow DOM', () => {
      class HeaderBadge extends HTMLElementStub {
        render() {
          return html`<div class="badge-shadow"><slot></slot></div>`;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('header-badge', HeaderBadge);

      const plan: SsrTemplatePlanV2 = {
        v: 2,
        h: 'test-header-badge',
        opcodes: [
          { type: 'open', tag: 'main', closeIndex: 4 },
          {
            type: 'open',
            tag: 'header-badge',
            isCustomElement: true,
            staticAttrs: { class: 'pill' },
            closeIndex: 3,
          },
          { type: 'part', index: 0 },
          { type: 'close', tag: 'header-badge' },
          { type: 'close', tag: 'main' },
        ],
        markerSites: [],
        parts: [],
      };

      const compiledTemplate = {
        _$litType$: {
          h: '<main><header-badge class="pill"><?></header-badge></main>',
          parts: [{ type: 2, index: 0 }],
          ssrPlan: plan,
        },
        values: ['Beta User'],
      };

      const output = renderToString(compiledTemplate as any, { customElements: env.customElements });
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<div class="badge-shadow">');
      expect(output).toContain('Beta User');
    });

    it('preserves custom element tags inside comments, attributes, and scripts without expansion', () => {
      class CardComponent extends HTMLElementStub {
        render() {
          return html`<div class="card-body">card content</div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('test-card', CardComponent);

      const plan: SsrTemplatePlanV2 = {
        v: 2,
        h: 'test-card-preserve',
        opcodes: [
          { type: 'open', tag: 'div', closeIndex: 10 },
          { type: 'open', tag: 'test-card', isCustomElement: true, closeIndex: 2 },
          { type: 'close', tag: 'test-card' },
          { type: 'comment', value: ' <test-card></test-card> ' },
          { type: 'open', tag: 'div', staticAttrs: { title: '<test-card></test-card>' }, closeIndex: 6 },
          { type: 'text', value: 'text' },
          { type: 'close', tag: 'div' },
          { type: 'open', tag: 'script', closeIndex: 9 },
          { type: 'text', value: 'const x = "<test-card></test-card>";' },
          { type: 'close', tag: 'script' },
          { type: 'close', tag: 'div' },
        ],
        markerSites: [],
        parts: [],
      };

      const compiledTemplate = {
        _$litType$: {
          h: '<div><test-card></test-card><!-- <test-card></test-card> --><div title="<test-card></test-card>">text</div><script>const x = "<test-card></test-card>";</script></div>',
          parts: [],
          ssrPlan: plan,
        },
        values: [],
      };

      const output = renderToString(compiledTemplate as any, { customElements: env.customElements });

      // 1. Genuine custom element is expanded with Declarative Shadow DOM
      expect(output).toContain('<div><test-card><template shadowrootmode="open"><div class="card-body">card content</div></template></test-card>');
      // 2. HTML comment remains 100% intact
      expect(output).toContain('<!-- <test-card></test-card> -->');
      expect(output).not.toContain('<!-- <test-card><template');
      // 3. Attribute value remains 100% intact
      expect(output).toContain('<div title="&lt;test-card&gt;&lt;/test-card&gt;">text</div>');
      expect(output).not.toContain('title="<test-card><template');
      // 4. Script contents remain 100% intact
      expect(output).toContain('<script>const x = "<test-card></test-card>";</script>');
      expect(output).not.toContain('<script>const x = "<test-card><template');
    });

    it('applies staticAttrs directly and triggers attributeChangedCallback on observed attributes', () => {
      let callbackInvoked = false;
      let callbackArgs: unknown[] = [];

      class CounterComponent extends HTMLElementStub {
        static observedAttributes = ['count'];
        count = 0;

        attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
          callbackInvoked = true;
          callbackArgs = [name, oldValue, newValue];
          if (name === 'count') {
            this.count = Number(newValue);
          }
        }

        render() {
          return html`<div class="counter-display">Count: ${this.count}</div>`;
        }
      }

      const env = createIsolateEnvironment();
      env.customElements.define('my-counter', CounterComponent);

      const plan: SsrTemplatePlanV2 = {
        v: 2,
        h: 'test-counter-static-attrs',
        opcodes: [
          { type: 'open', tag: 'main', closeIndex: 3 },
          {
            type: 'open',
            tag: 'my-counter',
            isCustomElement: true,
            staticAttrs: { count: '42' },
            closeIndex: 2,
          },
          { type: 'close', tag: 'my-counter' },
          { type: 'close', tag: 'main' },
        ],
        markerSites: [],
        parts: [],
      };

      const compiledTemplate = {
        _$litType$: {
          h: '<main><my-counter count="42"></my-counter></main>',
          parts: [],
          ssrPlan: plan,
        },
        values: [],
      };

      const output = renderToString(compiledTemplate as any, { customElements: env.customElements });
      expect(output).toContain('<my-counter count="42" data-lit-state="{&quot;count&quot;:42}"><template shadowrootmode="open"><div class="counter-display">Count: ');
      expect(output).toContain('42');
      expect(output).toContain('</div></template></my-counter></main>');
      expect(callbackInvoked).toBe(true);
    });

    it('throws a diagnostic error when an uncompiled template is rendered with edge: true', () => {
      const uncompiledTemplate = html`<div>Uncompiled Template</div>`;
      expect(() => {
        renderToString(uncompiledTemplate, { edge: true });
      }).toThrow('[@lit-core/ssr] Uncompiled Lit template encountered in edge mode');
    });

    it('expands custom element with child element containing custom tag name in an attribute', () => {
      class NestedHost extends HTMLElementStub {
        render() {
          return html`<div class="host-root"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('nested-host', NestedHost);

      const tpl = html`<div><nested-host><input placeholder="<nested-host>"></nested-host></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<nested-host><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template>');
      expect(out).toContain('<input placeholder="&lt;nested-host&gt;">');
      expect(out).toContain('</nested-host></div>');
    });

    it('expands custom element with child element attribute containing closing custom tag name', () => {
      class NestedHostClose extends HTMLElementStub {
        render() {
          return html`<div class="host-root"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('nested-host-close', NestedHostClose);

      const tpl = html`<div><nested-host-close><input placeholder="</nested-host-close>"><span class="genuine-slotted">slotted</span></nested-host-close></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<nested-host-close><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template>');
      expect(out).toContain('<input placeholder="&lt;/nested-host-close&gt;">');
      expect(out).toContain('<span class="genuine-slotted">slotted</span>');
      expect(out).toContain('</nested-host-close></div>');
    });

    it('expands custom element following an uppercase raw-text tag', () => {
      class GenuinePost extends HTMLElementStub {
        render() {
          return html`<div class="post-body">post</div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('genuine-post', GenuinePost);

      const tpl = html`<div><SCRIPT>const x = 1;</SCRIPT><genuine-post></genuine-post></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<script>const x = 1;</script>');
      expect(out).toContain('<genuine-post><template shadowrootmode="open"><div class="post-body">post</div></template></genuine-post>');
    });

    it('expands custom element following other uppercase raw-text tags', () => {
      class GenuinePostMulti extends HTMLElementStub {
        render() {
          return html`<div class="post-body">multi</div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('genuine-post-multi', GenuinePostMulti);

      const tpl = html`<div><STYLE>body { color: red; }</STYLE><TEXTAREA>text</TEXTAREA><TITLE>doc title</TITLE><genuine-post-multi></genuine-post-multi></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<style>body { color: red; }</style>');
      expect(out).toContain('<textarea>text</textarea>');
      expect(out).toContain('<title>doc title</title>');
      expect(out).toContain('<genuine-post-multi><template shadowrootmode="open"><div class="post-body">multi</div></template></genuine-post-multi>');
    });

    it('expands custom element containing uppercase raw-text tag inside child nodes', () => {
      class HostWithRawText extends HTMLElementStub {
        render() {
          return html`<div class="wrapper"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('host-with-raw-text', HostWithRawText);

      const tpl = html`<div><host-with-raw-text><SCRIPT>const s = "</host-with-raw-text>";</SCRIPT><span class="slotted">child</span></host-with-raw-text></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<host-with-raw-text><template shadowrootmode="open"><div class="wrapper"><slot></slot></div></template>');
      expect(out).toContain('<script>const s = "</host-with-raw-text>";</script>');
      expect(out).toContain('<span class="slotted">child</span>');
      expect(out).toContain('</host-with-raw-text></div>');
    });

    it('expands custom element following less-than comparison in text content', () => {
      class MyCounterComp extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('my-counter-comp', MyCounterComp);

      const tpl = html`<div>count < 5 <my-counter-comp>val</my-counter-comp></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<my-counter-comp><template shadowrootmode="open"><div><slot></slot></div></template>val</my-counter-comp>');
      expect(out).toContain('count &lt; 5 ');
    });

    it('expands custom element containing less-than comparison in child nodes', () => {
      class MyCounterChild extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('my-counter-child', MyCounterChild);

      const tpl = html`<div><my-counter-child>count < 5</my-counter-child></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<my-counter-child><template shadowrootmode="open"><div><slot></slot></div></template>count &lt; 5</my-counter-child>');
    });

    it('expands custom element following adjacent less-than signs', () => {
      class MyCounterAdjacent extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('my-counter-adj', MyCounterAdjacent);

      const tpl = html`<div><<my-counter-adj>val</my-counter-adj></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('&lt;<my-counter-adj><template shadowrootmode="open"><div><slot></slot></div></template>val</my-counter-adj>');
    });

    it('prevents shadow template injection inside child element attribute when preceded by dynamic binding', () => {
      class NestedHostDyn extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('nested-host-dyn', NestedHostDyn);

      const val = 'test';
      const tpl = html`<div><nested-host-dyn><input value="${val}" placeholder="<nested-host-dyn>"></nested-host-dyn></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<nested-host-dyn><template shadowrootmode="open"><div><slot></slot></div></template>');
      expect(out).toContain('<input placeholder="&lt;nested-host-dyn&gt;" value="test">');
      expect(out).not.toContain('placeholder="<nested-host-dyn><template');
    });

    it('expands subsequent custom element after top-level element with dynamic attribute and collision title', () => {
      class GenuinePostDyn extends HTMLElementStub {
        render() {
          return html`<div>post</div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('genuine-post-dyn', GenuinePostDyn);

      const cls = 'btn';
      const tpl = html`<div><div class="${cls}" title="<genuine-post-dyn>"></div><genuine-post-dyn></genuine-post-dyn></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<div title="&lt;genuine-post-dyn&gt;" class="btn"></div>');
      expect(out).toContain('<genuine-post-dyn><template shadowrootmode="open"><div>post</div></template></genuine-post-dyn>');
    });

    it('handles multiple dynamic attributes before placeholder collision without corruption', () => {
      class MultiAttrHost extends HTMLElementStub {
        render() {
          return html`<div><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('multi-attr-host', MultiAttrHost);

      const a = 'foo';
      const b = true;
      const tpl = html`<div><multi-attr-host><input name="${a}" ?disabled=${b} placeholder="<multi-attr-host>"></multi-attr-host></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<multi-attr-host><template shadowrootmode="open"><div><slot></slot></div></template>');
      expect(out).toContain('<input placeholder="&lt;multi-attr-host&gt;" name="foo" disabled>');
      expect(out).not.toContain('placeholder="<multi-attr-host><template');
    });

    it('expands custom elements following unclosed hyphenated text sequence', () => {
      class MyElem extends HTMLElementStub {
        render() {
          return html`<div class="elem-root"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('my-elem', MyElem);

      const tpl = html`<div><<<triple-left> <my-elem>inner</my-elem></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      expect(out).toContain('<my-elem><template shadowrootmode="open"><div class="elem-root"><slot></slot></div></template>inner</my-elem>');
      expect(out).toContain('&lt;&lt;<triple-left> ');
    });

    it('expands nested custom elements of the same tag name when dynamic attributes are present', () => {
      class NestedHost extends HTMLElementStub {
        render() {
          return html`<div class="host-root"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('nested-host', NestedHost);

      const innerId = 'child-1';
      const tpl = html`<div><nested-host id="outer"><nested-host id="${innerId}"></nested-host></nested-host></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      const count = (out.match(/shadowrootmode="open"/g) || []).length;
      expect(count).toBe(2);
      expect(out).toContain('<nested-host id="outer"><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template>');
      expect(out).toContain('<nested-host id="child-1"><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template></nested-host>');
    });

    it('expands nested custom elements of the same tag name with dynamic attributes and placeholder collisions', () => {
      class NestedHostPlaceholder extends HTMLElementStub {
        render() {
          return html`<div class="host-root"><slot></slot></div>`;
        }
      }
      const env = createIsolateEnvironment();
      env.customElements.define('nested-host-ph', NestedHostPlaceholder);

      const innerId = 'child-1';
      const tpl = html`<div><nested-host-ph id="outer"><nested-host-ph id="${innerId}" placeholder="<nested-host-ph>"></nested-host-ph></nested-host-ph></div>`;
      const out = renderToString(tpl, { customElements: env.customElements });
      const count = (out.match(/shadowrootmode="open"/g) || []).length;
      expect(count).toBe(2);
      expect(out).toContain('<nested-host-ph id="outer"><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template>');
      expect(out).toContain('<nested-host-ph placeholder="&lt;nested-host-ph&gt;" id="child-1"><template shadowrootmode="open"><div class="host-root"><slot></slot></div></template></nested-host-ph>');
      expect(out).not.toContain('placeholder="<nested-host-ph><template');
    });
  });
});
