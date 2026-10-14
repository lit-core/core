import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import { collectResult, createIsolateEnvironment, createStreamFromIterator, HTMLElementStub, renderToStream, renderToString } from '../src/index.js';
import { projectSlots } from '../src/slot.js';

describe('tier 5 white-box adversarial hardening suite for @lit-core/ssr', () => {
  describe('stream cancellation and abort signal handling', () => {
    it('terminates stream and triggers generator finally when AbortSignal fires', async () => {
      const ac = new AbortController();
      let finallyExecuted = false;

      function* infiniteGenerator(): IterableIterator<string> {
        try {
          while (true) {
            yield 'infinite-chunk';
          }
        } finally {
          finallyExecuted = true;
        }
      }

      const stream = createStreamFromIterator(infiniteGenerator(), {
        signal: ac.signal,
      });

      const reader = stream.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);

      // Abort via AbortController
      ac.abort('aborted by client');

      // With signal wired, reader.read() rejects with abort reason and generator finally executes
      await expect(reader.read()).rejects.toThrow('aborted by client');
      expect(finallyExecuted).toBe(true);
    });

    it('propagates generator throw during active streaming without hang', async () => {
      let returnCalled = false;
      const throwingIterator: IterableIterator<string> = {
        [Symbol.iterator]() {
          return this;
        },
        next() {
          throw new RangeError('Maximum SSR render depth exceeded');
        },
        return() {
          returnCalled = true;
          return { done: true, value: undefined };
        },
      };

      const stream = createStreamFromIterator(throwingIterator);
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow(RangeError);
      expect(returnCalled).toBe(true);
    });
  });

  describe('circular component dependencies and recursion limit safety', () => {
    it('throws RangeError and aborts stream cleanly on indirect circular component dependencies A -> B -> A', async () => {
      const env = createIsolateEnvironment();

      class LoopA extends HTMLElementStub {
        render() {
          return html`<loop-b></loop-b>`;
        }
      }

      class LoopB extends HTMLElementStub {
        render() {
          return html`<loop-a></loop-a>`;
        }
      }

      env.customElements.define('loop-a', LoopA);
      env.customElements.define('loop-b', LoopB);

      // Synchronous render throws RangeError
      expect(() => {
        renderToString(html`<loop-a></loop-a>`, {
          customElements: env.customElements,
          depth: 10,
        });
      }).toThrow(RangeError);

      // Streaming render rejects stream reader with RangeError
      const stream = renderToStream(html`<loop-a></loop-a>`, {
        customElements: env.customElements,
        depth: 10,
      });

      await expect(collectResult(stream)).rejects.toThrow('Maximum SSR render depth exceeded');
    });

    it('unwinds recursion depth without leaking when an exception is thrown', () => {
      const env = createIsolateEnvironment();

      class CrashingChild extends HTMLElementStub {
        render() {
          throw new Error('child rendering exploded');
        }
      }

      env.customElements.define('crash-child', CrashingChild);

      expect(() => {
        renderToString(html`<div><crash-child></crash-child></div>`, {
          customElements: env.customElements,
        });
      }).toThrow('child rendering exploded');

      // Subsequent renders on the same isolate must succeed without leftover depth
      const safeOutput = renderToString(html`<div><span>Safe after crash</span></div>`, {
        customElements: env.customElements,
      });
      expect(safeOutput).toBe('<div><span>Safe after crash</span></div>');
    });
  });

  describe('circular data structures in resumable state serialization', () => {
    it('handles circular state passed in RenderOptions safely without throwing TypeError', () => {
      const circularState: Record<string, unknown> = { id: 1 };
      circularState.self = circularState;

      // Cycle-safe serialization handles circular references safely without throwing
      const output = renderToString(
        {
          tagName: 'circular-box',
          state: circularState,
        },
        { resumable: true },
      );
      expect(output).toContain('<circular-box>');
      expect(output).toContain('<script type="lit/state">{"id":1}</script>');
    });

    it('silently drops component state when component instance has self-referential property', () => {
      const circularData: Record<string, unknown> = { key: 'value' };
      circularData.ref = circularData;

      class CircularPropElement extends HTMLElementStub {
        data = circularData;
        render() {
          return html`<p>Circular prop</p>`;
        }
      }

      const instance = new CircularPropElement();

      // isSerializableValue in state-serializer.ts detects cycles, silently dropping circular property
      const output = renderToString(instance, { resumable: true });
      expect(output).toContain('<p>Circular prop</p>');
      expect(output).not.toContain('<script type="lit/state">');
    });

    it('safely handles circular state fallback without throwing TypeError', () => {
      const circularData: Record<string, unknown> = { key: 'value' };
      circularData.ref = circularData;

      class CircularPropElement extends HTMLElementStub {
        data = circularData;
        render() {
          return html`<p>Circular prop</p>`;
        }
      }

      const instance = new CircularPropElement();
      const circularFallback: Record<string, unknown> = { fallback: true };
      circularFallback.cycle = circularFallback;

      // Protected fallback renders without unhandled TypeError
      const output = renderToString(instance, {
        resumable: true,
        state: circularFallback,
      });
      expect(output).toContain('<p>Circular prop</p>');
    });
  });

  describe('nested identical tag names in slot parsing', () => {
    it('preserves outer slot node with nested identical tags without truncation', () => {
      const env = createIsolateEnvironment();

      class CardWrapper extends HTMLElementStub {
        render() {
          return html`<div class="card"><slot name="content"></slot></div>`;
        }
      }

      env.customElements.define('card-wrapper', CardWrapper);

      // Light DOM contains nested div tags inside a div with slot="content"
      const tpl = html`<card-wrapper><div slot="content"><div class="nested">Inner content</div>Outer content</div></card-wrapper>`;

      // In flattened mode, slots are projected from getParsedSlottedNodes()
      const flattened = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      // Depth-balanced slot parsing balances matching tags: Outer content is preserved
      expect(flattened).toContain('Inner content');
      expect(flattened).toContain('Outer content');
    });

    it('preserves clean slot distribution when elements with nested identical tags are slotted', () => {
      const env = createIsolateEnvironment();

      class MultiSlotContainer extends HTMLElementStub {
        render() {
          return html`<header><slot name="header"></slot></header><main><slot></slot></main>`;
        }
      }

      env.customElements.define('multi-slot-box', MultiSlotContainer);

      const tpl = html`<multi-slot-box><div slot="header"><div class="badge">Badge</div>Title text</div><p>Main text</p></multi-slot-box>`;

      const flattened = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      // Clean distribution with no orphaned closing tags
      expect(flattened).toContain('<header><div slot="header"><div class="badge">Badge</div>Title text</div></header>');
      expect(flattened).toContain('<main><p>Main text</p></main>');
    });
  });

  describe('nested slot tags and fallback content in projectSlots', () => {
    it('replaces outer nested slot cleanly without leaving dangling closing slot tag', () => {
      const shadow = '<div class="container"><slot name="outer"><slot name="inner">Fallback</slot></slot></div>';
      const res = projectSlots(shadow, [
        { slot: 'outer', content: '<div class="outer-content">Outer</div>' },
        { slot: 'inner', content: '<span>Inner</span>' },
      ]);

      // Depth-balanced outer slot replacement leaves no dangling </slot>
      expect(res.projectedShadow).toBe('<div class="container"><div class="outer-content">Outer</div></div>');
      expect(res.lightRemainder).toBe('<span>Inner</span>');
    });

    it('retains unprojected light DOM children in lightRemainder', () => {
      const shadow = '<slot name="header"></slot>';
      const light = [{ slot: 'header', content: '<h1>Header</h1>' }, { slot: 'unmatched-named', content: '<aside>Orphaned named slot</aside>' }, { content: '<p>Orphaned default content</p>' }];

      const { projectedShadow, lightRemainder } = projectSlots(shadow, light);

      expect(projectedShadow).toBe('<h1>Header</h1>');
      expect(lightRemainder).toContain('<aside>Orphaned named slot</aside>');
      expect(lightRemainder).toContain('<p>Orphaned default content</p>');
    });
  });

  describe('component lifecycle exception isolation', () => {
    it('aborts render pass when component render() throws an unhandled exception', () => {
      const env = createIsolateEnvironment();

      class FaultyElement extends HTMLElementStub {
        render() {
          throw new ReferenceError('window is not defined in render()');
        }
      }

      env.customElements.define('faulty-el', FaultyElement);

      expect(() => {
        renderToString(html`<main><faulty-el></faulty-el></main>`, {
          customElements: env.customElements,
        });
      }).toThrow(ReferenceError);
    });

    it('aborts render pass when component willUpdate() throws an unhandled exception', () => {
      const env = createIsolateEnvironment();

      class FaultyUpdateElement extends HTMLElementStub {
        willUpdate() {
          throw new TypeError('invalid property access in willUpdate');
        }
        render() {
          return html`<p>Content</p>`;
        }
      }

      env.customElements.define('faulty-update-el', FaultyUpdateElement);

      expect(() => {
        renderToString(html`<main><faulty-update-el></faulty-update-el></main>`, {
          customElements: env.customElements,
        });
      }).toThrow(TypeError);
    });
  });

  describe('declarative shadow DOM template boundary breakout', () => {
    it('escapes closing template tags inside standard template string bindings', () => {
      const maliciousPayload = '</template><script>alert("pwned")</script><template shadowrootmode="open">';
      const tpl = html`<my-widget>${maliciousPayload}</my-widget>`;

      const output = renderToString(tpl);
      // html tagged template strings safely escape < and > into &lt; and &gt;
      expect(output).not.toContain('</template>');
      expect(output).toContain('&lt;/template&gt;');
    });
  });
});
