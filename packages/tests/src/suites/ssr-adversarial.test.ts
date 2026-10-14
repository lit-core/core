import { collectResult, createIsolateEnvironment, HTMLElementStub, renderToStream, renderToString } from '@lit-core/ssr';
import { projectSlots } from '@lit-core/ssr/slot';
import { html, LitElement } from 'lit';
import { describe, expect, it } from 'vitest';

describe('adversarial stress and edge case test suite for @lit-core/ssr', () => {
  describe('deep nesting and recursion limits', () => {
    it('enforces custom recursion depth limits and throws range error', () => {
      const env = createIsolateEnvironment();
      const elementClasses: Array<new () => any> = [];

      for (let i = 0; i < 20; i++) {
        class ChainItem extends HTMLElementStub {
          render() {
            if (i < 19) {
              return new elementClasses[i + 1]();
            }
            return html`<span>leaf reached</span>`;
          }
        }
        elementClasses.push(ChainItem);
        env.customElements.define(`chain-item-${i}`, ChainItem);
      }

      // Safe depth limit allows rendering
      const safeOutput = renderToString(new elementClasses[0](), {
        customElements: env.customElements,
        depth: 25,
      });
      expect(safeOutput).toContain('leaf reached');

      // Restrictive depth limit triggers RangeError
      expect(() => {
        renderToString(new elementClasses[0](), {
          customElements: env.customElements,
          depth: 10,
        });
      }).toThrow(RangeError);
    });

    it('renders custom element tag names with multiple hyphens with Declarative Shadow DOM', () => {
      const env = createIsolateEnvironment();

      class SpActionButton extends HTMLElementStub {
        render() {
          return html`<button><slot></slot></button>`;
        }
      }

      class CdsDataTable extends HTMLElementStub {
        render() {
          return html`<div class="table"><slot></slot></div>`;
        }
      }

      env.customElements.define('sp-action-button', SpActionButton);
      env.customElements.define('cds-data-table', CdsDataTable);

      const tpl = html`<sp-action-button>Save</sp-action-button><cds-data-table>Data</cds-data-table>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<sp-action-button><template shadowrootmode="open"><button><slot></slot></button></template>Save');
      expect(output).toContain('<cds-data-table><template shadowrootmode="open"><div class="table"><slot></slot></div></template>Data');
    });

    it('safely renders subclasses of standard LitElement', () => {
      const env = createIsolateEnvironment();

      class RealButton extends LitElement {
        render() {
          return html`<button>Real Lit Element</button>`;
        }
      }

      env.customElements.define('lit-button', RealButton);

      const output = renderToString(html`<lit-button></lit-button>`, { customElements: env.customElements });
      expect(output).toContain('<lit-button><template shadowrootmode="open"><button>Real Lit Element</button></template>');
    });

    it('correctly handles self-nested custom elements with identical tag names', () => {
      const env = createIsolateEnvironment();

      class TreeNode extends HTMLElementStub {
        render() {
          return html`<div class="node"><slot></slot></div>`;
        }
      }

      env.customElements.define('tree-node', TreeNode);

      const tpl = html`<tree-node><tree-node>inner</tree-node></tree-node>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain(
        '<tree-node><template shadowrootmode="open"><div class="node"><slot></slot></div></template><tree-node><template shadowrootmode="open"><div class="node"><slot></slot></div></template>inner',
      );
      expect(output.endsWith('</tree-node>')).toBe(true);
    });

    it('recursively expands nested custom elements in light DOM', () => {
      const env = createIsolateEnvironment();

      class OuterBox extends HTMLElementStub {
        render() {
          return html`<div class="outer"><slot></slot></div>`;
        }
      }

      class InnerButton extends HTMLElementStub {
        render() {
          return html`<button class="inner">Click</button>`;
        }
      }

      env.customElements.define('outer-box', OuterBox);
      env.customElements.define('inner-btn', InnerButton);

      const tpl = html`<outer-box><inner-btn></inner-btn></outer-box>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<outer-box><template shadowrootmode="open">');
      expect(output).toContain('<inner-btn><template shadowrootmode="open"><button class="inner">Click</button></template>');
    });
  });

  describe('malicious payloads and attribute parsing', () => {
    it('safely escapes html injection in child and attribute expressions', () => {
      const maliciousScript = '<script>alert("xss")</script>';
      const maliciousAttr = 'val" onfocus="alert(1)" data-x="';

      const tpl = html`<div title="${maliciousAttr}">${maliciousScript}</div>`;
      const output = renderToString(tpl);

      expect(output).not.toContain('<script>alert');
      expect(output).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(output).toContain('title="val&quot; onfocus=&quot;alert(1)&quot; data-x=&quot;"');
    });

    it('demonstrates markup corruption when attribute value contains greater-than character', () => {
      // In renderer.ts line 308:
      // customTagRegex uses ([^>]*)> which terminates early when an attribute contains >
      const env = createIsolateEnvironment();

      class WidgetCard extends HTMLElementStub {
        render() {
          return html`<div class="content"><slot></slot></div>`;
        }
      }

      env.customElements.define('widget-card', WidgetCard);

      const tpl = html`<widget-card title="value > threshold">Content</widget-card>`;
      const output = renderToString(tpl, { customElements: env.customElements });

      expect(output).toContain('<widget-card title="value > threshold"><template shadowrootmode="open">');
    });

    it('sanitizes attribute names against breakout injection in component descriptors', () => {
      const descriptor = {
        tagName: 'custom-card',
        attributes: {
          'data-ok': 'safe',
          'attr" onclick="alert(1)': 'injected',
        },
      };

      const output = renderToString(descriptor);
      expect(output).not.toContain('attr" onclick="alert(1)');
      expect(output).toContain('<custom-card data-ok="safe">');
    });
  });

  describe('complex slot topologies and projection flaws', () => {
    it('projects slots when slot element has additional attributes', () => {
      const shadow = '<div class="wrapper"><slot class="heading" name="header"></slot><slot class="body"></slot></div>';
      const light = [{ slot: 'header', content: '<h1>Header title</h1>' }, { content: '<p>Body text</p>' }];

      const { projectedShadow, lightRemainder } = projectSlots(shadow, light);

      expect(projectedShadow).toBe('<div class="wrapper"><h1>Header title</h1><p>Body text</p></div>');
      expect(lightRemainder).toBe('');
    });

    it('preserves mixed light DOM text nodes in flattened mode', () => {
      const env = createIsolateEnvironment();

      class MixedContainer extends HTMLElementStub {
        render() {
          return html`<section><slot name="header"></slot><slot></slot></section>`;
        }
      }

      env.customElements.define('mixed-box', MixedContainer);

      const tpl = html`<mixed-box>Leading text <span slot="header">Title</span> Trailing text</mixed-box>`;
      const output = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(output).toContain('Leading text');
      expect(output).toContain('Trailing text');
      expect(output).toContain('<span slot="header">Title</span>');
    });

    it('resolves flattened mode slot name lookup when attribute precedes name', () => {
      const env = createIsolateEnvironment();

      class CardWithAttrs extends HTMLElementStub {
        render() {
          return html`<div class="card"><slot class="slot-class" name="header"></slot></div>`;
        }
      }

      env.customElements.define('card-slot', CardWithAttrs);

      const tpl = html`<card-slot><h1 slot="header">Header Title</h1></card-slot>`;
      const output = renderToString(tpl, {
        customElements: env.customElements,
        mode: 'flattened',
      });

      expect(output).toBe('<card-slot><div class="card"><h1 slot="header">Header Title</h1></div></card-slot>');
    });
  });

  describe('concurrency and streaming stability', () => {
    it('executes 1000 concurrent streaming renders without crosstalk or failure', async () => {
      const env = createIsolateEnvironment();

      class TaskItem extends HTMLElementStub {
        render() {
          return html`<div class="task"><slot></slot></div>`;
        }
      }

      env.customElements.define('task-item', TaskItem);

      const concurrency = 1000;
      const tasks = Array.from({ length: concurrency }, (_, idx) => {
        const stream = renderToStream(html`<task-item><span>Task #${idx}</span></task-item>`, {
          customElements: env.customElements,
        });
        return collectResult(stream);
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(concurrency);
      expect(results.every((res, idx) => res.includes(`Task #${idx}`))).toBe(true);
    });

    it('streams templates with empty string chunks without deadlocking', async () => {
      const tpl = html`<div>${''}</div>`;
      const stream = renderToStream(tpl);
      const timeoutPromise = new Promise<'DEADLOCK'>((resolve) => setTimeout(() => resolve('DEADLOCK'), 500));

      const result = await Promise.race([collectResult(stream), timeoutPromise]);
      expect(result).toBe('<div></div>');
    });

    it('handles 200 rapid stream cancellations without leaking unhandled promises', async () => {
      const env = createIsolateEnvironment();

      class DataList extends HTMLElementStub {
        render() {
          return html`<ul>${Array.from({ length: 100 }, (_, i) => html`<li>Record ${i}</li>`)}</ul>`;
        }
      }

      env.customElements.define('data-list', DataList);

      const abortTasks = Array.from({ length: 200 }, async () => {
        const stream = renderToStream(html`<data-list></data-list>`, {
          customElements: env.customElements,
        });
        const reader = stream.getReader();
        const first = await reader.read();
        expect(first.done).toBe(false);
        await reader.cancel('client abort');
        const second = await reader.read();
        expect(second.done).toBe(true);
      });

      await Promise.all(abortTasks);
    });
  });
});
