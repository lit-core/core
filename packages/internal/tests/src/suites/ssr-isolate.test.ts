import { describe, expect, it } from 'vitest';
import { createIsolateEnvironment, getSsrEngine } from '../ssr-harness.js';

describe('@lit-core/ssr pure V8 isolate environment test suite', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (ISOLATE ENVIRONMENT CONTRACT)
  // =========================================================================
  describe('tier 1: isolate environment feature coverage', () => {
    it('[F2] createIsolateEnvironment returns customElements registry and HTMLElement constructor', async () => {
      const engine = await getSsrEngine();
      const env = engine.createIsolateEnvironment();

      expect(env).toBeDefined();
      expect(typeof env.customElements.get).toBe('function');
      expect(typeof env.customElements.define).toBe('function');
      expect(typeof env.HTMLElement).toBe('function');
    });

    it('[F2] customElements registry defines and retrieves custom element constructors', async () => {
      const env = createIsolateEnvironment();

      class TestElement extends env.HTMLElement {
        title = 'Isolate component';
      }

      env.customElements.define('my-isolate-elem', TestElement);
      const retrieved = env.customElements.get('my-isolate-elem');

      expect(retrieved).toBe(TestElement);
      if (!retrieved) throw new Error('retrieved constructor is undefined');
      const instance = new retrieved();
      expect(instance.title).toBe('Isolate component');
      expect(instance.tagName).toBe('MY-ISOLATE-ELEM');
    });

    it('[F2] executes custom element lifecycle without window global required', async () => {
      const env = createIsolateEnvironment();

      const isolateScope = {
        window: undefined,
        document: undefined,
        HTMLElement: env.HTMLElement,
        customElements: env.customElements,
      };

      class StatelessWidget extends isolateScope.HTMLElement {
        render() {
          return '<div>Stateless isolate content</div>';
        }
      }

      isolateScope.customElements.define('stateless-widget', StatelessWidget);
      const Ctor = isolateScope.customElements.get('stateless-widget');
      expect(Ctor).toBe(StatelessWidget);

      if (!Ctor) throw new Error('Ctor is undefined');
      const widget = new Ctor();
      expect(widget.render()).toBe('<div>Stateless isolate content</div>');
    });

    it('[F2] executes without requiring node:vm module', async () => {
      // Invariant: pure V8 isolates (Cloudflare Workers, Fastly Compute) forbid node:vm
      const env = createIsolateEnvironment();
      expect(env).toBeDefined();
    });

    it('[F2] independent isolate environments maintain isolated registries without collision', () => {
      const env1 = createIsolateEnvironment();
      const env2 = createIsolateEnvironment();

      class Element1 extends env1.HTMLElement {}
      class Element2 extends env2.HTMLElement {}

      env1.customElements.define('shared-tag', Element1);
      env2.customElements.define('shared-tag', Element2);

      expect(env1.customElements.get('shared-tag')).toBe(Element1);
      expect(env2.customElements.get('shared-tag')).toBe(Element2);
    });

    it('[F2] registers and retrieves multiple custom elements in single isolate registry', () => {
      const env = createIsolateEnvironment();
      const tagNames = ['alpha-elem', 'beta-elem', 'gamma-elem', 'delta-elem', 'epsilon-elem'];

      tagNames.forEach((tag) => {
        class Elem extends env.HTMLElement {}
        env.customElements.define(tag, Elem);
        expect(env.customElements.get(tag)).toBe(Elem);
      });
    });

    it('[F2] isolate HTMLElement constructor initializes empty attributes map', () => {
      const env = createIsolateEnvironment();
      const instance = new env.HTMLElement('test-init');
      expect(instance.tagName).toBe('TEST-INIT');
      expect(instance.getAttribute('non-existent')).toBeNull();
    });

    it('[F2] isolate environment operates with Web Standard globals only', () => {
      expect(typeof ReadableStream).toBe('function');
      expect(typeof TextEncoder).toBe('function');
      expect(typeof TextDecoder).toBe('function');
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY AND CORNER CASES
  // =========================================================================
  describe('tier 2: isolate boundary and corner cases', () => {
    it('throws when attempting to register a duplicate custom element tag', () => {
      const env = createIsolateEnvironment();

      class FirstClass extends env.HTMLElement {}
      class DuplicateClass extends env.HTMLElement {}

      env.customElements.define('duplicate-tag', FirstClass);
      expect(() => {
        env.customElements.define('duplicate-tag', DuplicateClass);
      }).toThrow(/already defined/);
    });

    it('returns undefined when querying an unregistered custom element tag', () => {
      const env = createIsolateEnvironment();
      expect(env.customElements.get('unregistered-custom-element')).toBeUndefined();
    });

    it('handles custom element tag lookup case-insensitively according to HTML standards', () => {
      const env = createIsolateEnvironment();

      class CaseComp extends env.HTMLElement {}
      env.customElements.define('My-Mixed-Case', CaseComp);

      expect(env.customElements.get('my-mixed-case')).toBe(CaseComp);
      expect(env.customElements.get('MY-MIXED-CASE')).toBe(CaseComp);
    });

    it('allows attaching an open shadow root to isolate HTMLElement instance', () => {
      const env = createIsolateEnvironment();

      class ShadowComp extends env.HTMLElement {}
      const comp = new ShadowComp('shadow-comp');

      const shadow = comp.attachShadow({ mode: 'open' });
      expect(shadow).toBeDefined();
      expect(shadow.mode).toBe('open');
      expect(comp.shadowRoot).toBe(shadow);
    });

    it('supports getAttribute and setAttribute on isolate HTMLElement instance', () => {
      const env = createIsolateEnvironment();

      class AttrComp extends env.HTMLElement {}
      const comp = new AttrComp('attr-comp');

      comp.setAttribute('data-test-id', 'test-123');
      expect(comp.getAttribute('data-test-id')).toBe('test-123');
      expect(comp.getAttribute('non-existent')).toBeNull();
    });

    it('handles attribute keys case-insensitively on isolate HTMLElement instance', () => {
      const env = createIsolateEnvironment();
      const el = new env.HTMLElement('case-attr-host');

      el.setAttribute('Aria-Hidden', 'true');
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.getAttribute('ARIA-HIDDEN')).toBe('true');
    });

    it('handles custom elements registered with non-ASCII or unicode identifiers', () => {
      const env = createIsolateEnvironment();

      class UnicodeElem extends env.HTMLElement {}
      env.customElements.define('unicode-é-component', UnicodeElem);

      expect(env.customElements.get('unicode-é-component')).toBe(UnicodeElem);
    });

    it('handles empty attribute values set on isolate HTMLElement instance', () => {
      const env = createIsolateEnvironment();
      const el = new env.HTMLElement('empty-attr-host');

      el.setAttribute('data-empty', '');
      expect(el.getAttribute('data-empty')).toBe('');
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================
  describe('tier 3: isolate cross-feature combinations', () => {
    it('renders and streams custom element output inside isolate environment without DOM globals', async () => {
      const engine = await getSsrEngine();
      const env = engine.createIsolateEnvironment();

      class StreamComp extends env.HTMLElement {}
      env.customElements.define('isolate-stream-comp', StreamComp);

      const stream = engine.renderToStream(
        {
          tagName: 'isolate-stream-comp',
          shadowHtml: '<p>Rendered within isolate environment</p>',
          attributes: { 'data-isolate': 'true' },
        },
        { customElements: env.customElements },
      );

      const reader = stream.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(decoder.decode(value));
      }

      const totalHtml = chunks.join('');
      expect(totalHtml).toContain('<isolate-stream-comp data-isolate="true">');
      expect(totalHtml).toContain('shadowrootmode="open"');
      expect(totalHtml).toContain('<p>Rendered within isolate environment</p>');
      expect(totalHtml).not.toContain('<!--lit-part');
    });

    it('renders isolate custom element carrying resumable state snapshot and DOM paths', async () => {
      const engine = await getSsrEngine();
      const env = engine.createIsolateEnvironment();

      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'isolate-resumable-comp',
            shadowHtml: '<button>Click</button>',
            state: { count: 10, isolateMode: true },
          },
          {
            customElements: env.customElements,
            resumable: true,
            domPaths: true,
          },
        ),
      );

      expect(html).toContain('data-lit-paths="true"');
      expect(html).toContain('<script type="lit/state">');
      expect(html).toContain('"isolateMode":true');
      expect(html).not.toContain('<!--lit-part');
    });

    it('renders slotted elements inside isolate environment with clean DSD emission', async () => {
      const engine = await getSsrEngine();
      const env = engine.createIsolateEnvironment();

      const html = await engine.collectResult(
        engine.render(
          {
            tagName: 'isolate-slot-host',
            shadowHtml: '<div class="host-inner"><slot name="badge"></slot><slot></slot></div>',
            lightDom: [{ slot: 'badge', content: '<span class="badge">New</span>' }, { content: '<p>Main isolate content</p>' }],
          },
          { customElements: env.customElements },
        ),
      );

      expect(html).toContain('<span class="badge">New</span>');
      expect(html).toContain('<p>Main isolate content</p>');
      expect(html).not.toContain('<!--lit-part');
    });

    it('executes parallel isolate stream rendering without shared state corruption', async () => {
      const engine = await getSsrEngine();
      const env = engine.createIsolateEnvironment();

      const tasks = Array.from({ length: 5 }, async (_, i) => {
        const stream = engine.renderToStream(
          {
            tagName: `parallel-isolate-${i}`,
            shadowHtml: `<span>Worker ${i}</span>`,
          },
          { customElements: env.customElements },
        );

        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let result = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) result += decoder.decode(value);
        }

        return result;
      });

      const results = await Promise.all(tasks);
      results.forEach((res, i) => {
        expect(res).toContain(`parallel-isolate-${i}`);
        expect(res).toContain(`Worker ${i}`);
      });
    });
  });
});
