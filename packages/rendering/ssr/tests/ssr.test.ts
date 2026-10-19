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
  projectSlots,
  renderToStream,
  renderToString,
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

      expect(output).toBe('<div><h1>Welcome Alex</h1><p>Status: Active</p></div>');
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
      const shadow = '<div class="card"><slot class="main-slot" style="display:contents">fallback</slot></div>';
      const children = [{ content: '<p>Projected body</p>' }];
      const { projectedShadow, lightRemainder } = projectSlots(shadow, children);
      expect(projectedShadow).toBe('<div class="card"><p>Projected body</p></div>');
      expect(lightRemainder).toBe('');
    });

    it('projects named slot regardless of attribute order', () => {
      const shadow = '<header><slot class="cls" name="header" id="h1">fallback</slot></header>';
      const children = [{ slot: 'header', content: '<h1>Header Title</h1>' }];
      const { projectedShadow, lightRemainder } = projectSlots(shadow, children);
      expect(projectedShadow).toBe('<header><h1>Header Title</h1></header>');
      expect(lightRemainder).toBe('');
    });

    it('projects self-closing slots with multiple attributes', () => {
      const shadow = '<header><slot class="c" name="h"/></header><main><slot class="m"/></main>';
      const children = [{ slot: 'h', content: '<h1>Header</h1>' }, { content: '<p>Body</p>' }];
      const { projectedShadow, lightRemainder } = projectSlots(shadow, children);
      expect(projectedShadow).toBe('<header><h1>Header</h1></header><main><p>Body</p></main>');
      expect(lightRemainder).toBe('');
    });

    it('resolves nested slot fallback chains when outer slot is unassigned', () => {
      const shadow = '<div class="box"><slot name="outer"><slot name="inner">deep fb</slot></slot></div>';
      const children = [{ slot: 'inner', content: '<span>Inner Content</span>' }];
      const { projectedShadow } = projectSlots(shadow, children);
      expect(projectedShadow).toBe('<div class="box"><span>Inner Content</span></div>');
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
      expect(result).toBe('<div><span>Visible</span></div>');
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
      expect(output).toBe('<div>Text </div>');
    });
  });

  describe('Feature F7: Resumable state serialization', () => {
    it('serializes component state snapshot into <script type="lit/state"> with breakout escaping', () => {
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

      expect(output).toContain('<script type="lit/state">');
      expect(output).toContain('\\u003cscript>alert');
      expect(output).not.toContain('<script>alert');
    });
  });
});
