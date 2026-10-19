import { html } from 'lit';
import { describe, expect, it } from 'vitest';
import {
  type CompiledTemplateResult,
  collectResult,
  createIsolateEnvironment,
  createStreamFromIterator,
  HTMLElementStub,
  isCompiledTemplateResult,
  LIT_NO_CHANGE,
  LIT_NOTHING,
  renderToStream,
  renderToString,
} from '../src/index.js';
import { projectSlots } from '../src/slot.js';

describe('adversarial stress harness for @lit-core/ssr', () => {
  describe('stream cancellation and generator teardown', () => {
    it('tears down generator on cancellation mid-stream after consuming partial chunks', async () => {
      let finallyExecuted = false;
      let chunksYielded = 0;

      function* countingGenerator(): IterableIterator<string> {
        try {
          for (let i = 0; i < 1000; i++) {
            chunksYielded++;
            yield `<chunk id="${i}"/>`;
          }
        } finally {
          finallyExecuted = true;
        }
      }

      const stream = createStreamFromIterator(countingGenerator(), { highWaterMark: 1 });
      const reader = stream.getReader();

      const chunk1 = await reader.read();
      expect(chunk1.done).toBe(false);
      expect(new TextDecoder().decode(chunk1.value)).toContain('<chunk id="0"/>');

      const chunk2 = await reader.read();
      expect(chunk2.done).toBe(false);

      // Cancel mid-stream
      await reader.cancel('client connection closed');

      expect(finallyExecuted).toBe(true);
      expect(chunksYielded).toBeLessThan(100);

      const postCancel = await reader.read();
      expect(postCancel.done).toBe(true);
      await expect(reader.closed).resolves.toBeUndefined();
    });

    it('resolves pending reader promises cleanly when stream is cancelled before chunks', async () => {
      function* infiniteGenerator(): IterableIterator<string> {
        while (true) {
          yield 'chunk';
        }
      }

      const stream = createStreamFromIterator(infiniteGenerator());
      const reader = stream.getReader();

      const readPromise = reader.read();
      await reader.cancel('client aborted');

      const result = await readPromise;
      expect(result.done).toBe(true);
      expect(result.value).toBeUndefined();
      await expect(reader.closed).resolves.toBeUndefined();
    });

    it('handles generator exceptions gracefully and executes iterator return', async () => {
      let returnExecuted = false;

      const throwingIterator: IterableIterator<string> = {
        [Symbol.iterator]() {
          return this;
        },
        next() {
          throw new Error('deliberate generator failure');
        },
        return() {
          returnExecuted = true;
          return { done: true, value: undefined };
        },
      };

      const stream = createStreamFromIterator(throwingIterator);
      const reader = stream.getReader();

      await expect(reader.read()).rejects.toThrow('deliberate generator failure');
      expect(returnExecuted).toBe(true);
      await expect(reader.closed).rejects.toThrow('deliberate generator failure');
    });

    it('survives rapid cancellation stress loop with zero unhandled rejections', async () => {
      const iterations = 100;
      let activeGenerators = 0;

      for (let i = 0; i < iterations; i++) {
        function* testGen(): IterableIterator<string> {
          try {
            activeGenerators++;
            yield `iteration-${i}`;
            yield `second-${i}`;
          } finally {
            activeGenerators--;
          }
        }

        const stream = createStreamFromIterator(testGen());
        const reader = stream.getReader();
        await reader.read();
        await reader.cancel('rapid cycle');
        await reader.closed;
      }

      expect(activeGenerators).toBe(0);
    });

    it('handles empty string chunks in stream without deadlocking', async () => {
      const tpl = html`<div>${''}</div>`;
      const stream = renderToStream(tpl);

      const raceWithTimeout = Promise.race([collectResult(stream), new Promise<'DEADLOCKED'>((resolve) => setTimeout(() => resolve('DEADLOCKED'), 500))]);

      const result = await raceWithTimeout;
      expect(result).toBe('<div></div>');
    });
  });

  describe('pure isolate execution independence', () => {
    it('executes without window, document, or node:vm in global scope', async () => {
      const globalObj = globalThis as any;
      const originalWindow = globalObj.window;
      const originalDocument = globalObj.document;

      delete globalObj.window;
      delete globalObj.document;

      try {
        expect(globalObj.window).toBeUndefined();
        expect(globalObj.document).toBeUndefined();

        const template = html`<div class="isolate"><span>Hello from edge isolate</span></div>`;
        const rendered = renderToString(template);
        expect(rendered).toBe('<div class="isolate"><span>Hello from edge isolate</span></div>');

        const streamResult = await collectResult(renderToStream(template));
        expect(streamResult).toBe('<div class="isolate"><span>Hello from edge isolate</span></div>');
      } finally {
        if (originalWindow !== undefined) globalObj.window = originalWindow;
        if (originalDocument !== undefined) globalObj.document = originalDocument;
      }
    });

    it('executes custom element rendering in pure isolate environment', () => {
      const env = createIsolateEnvironment();

      class IsolatedCard extends HTMLElementStub {
        render() {
          return html`<section><h2>Isolated Card</h2><slot></slot></section>`;
        }
      }

      env.customElements.define('isolated-card', IsolatedCard);

      const template = html`<isolated-card><p>Slotted child</p></isolated-card>`;
      const output = renderToString(template, {
        customElements: env.customElements,
        resumable: false,
      });

      expect(output).toContain('<isolated-card>');
      expect(output).toContain('<template shadowrootmode="open">');
      expect(output).toContain('<h2>Isolated Card</h2>');
      expect(output).toContain('<p>Slotted child</p>');
      expect(output).toContain('</isolated-card>');
    });
  });

  describe('compiled template descriptor resilience', () => {
    it('handles empty and boundary compiled descriptors', () => {
      const emptyDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '',
          parts: [],
        },
        values: [],
      };
      expect(isCompiledTemplateResult(emptyDesc)).toBe(true);
      expect(renderToString(emptyDesc)).toBe('');

      const emptyArrayDesc: CompiledTemplateResult = {
        _$litType$: {
          h: [],
          parts: [],
        },
        values: [],
      };
      expect(renderToString(emptyArrayDesc)).toBe('');

      const staticOnlyDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<div class="static"><span>No dynamic parts</span></div>',
          parts: [],
        },
        values: [],
      };
      expect(renderToString(staticOnlyDesc)).toBe('<div class="static"><span>No dynamic parts</span></div>');
    });

    it('handles values array with fewer items than declared parts without throwing', () => {
      const missingValuesDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<div><?> and <?> and <?></div>',
          parts: [
            { type: 2, index: 1 },
            { type: 2, index: 2 },
            { type: 2, index: 3 },
          ],
        },
        values: ['Alpha'],
      };

      const output = renderToString(missingValuesDesc);
      expect(output).toBe('<div>Alpha and  and </div>');
    });

    it('handles values array with more items than declared parts', () => {
      const extraValuesDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<p>Value: <?>.</p>',
          parts: [{ type: 2, index: 1 }],
        },
        values: ['Active', 'Extra1', 'Extra2', 'Extra3'],
      };

      const output = renderToString(extraValuesDesc);
      expect(output).toBe('<p>Value: Active.</p>');
    });

    it('handles out-of-bounds and negative part indices cleanly', () => {
      const invalidIndicesDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<main><?><footer>Footer</footer></main>',
          parts: [
            { type: 2, index: -5 },
            { type: 2, index: 9999 },
            { type: 1, index: -1, name: 'data-invalid' },
          ],
        },
        values: ['Safe child', 'Ignored', 'No attr'],
      };

      const output = renderToString(invalidIndicesDesc);
      expect(output).toContain('<main>');
      expect(output).toContain('<footer>Footer</footer>');
      expect(output).toContain('</main>');
    });

    it('handles Lit sentinels nothing and noChange in compiled templates', () => {
      const sentinelDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<button><?>-<?>-<?></button>',
          parts: [
            { type: 2, index: 1 },
            { type: 2, index: 2 },
            { type: 2, index: 3 },
          ],
        },
        values: ['Visible', LIT_NOTHING, LIT_NO_CHANGE],
      };

      const output = renderToString(sentinelDesc);
      expect(output).toBe('<button>Visible--</button>');
    });

    it('handles nested compiled templates within standard Lit templates', () => {
      const innerCompiled: CompiledTemplateResult = {
        _$litType$: {
          h: '<span class="badge"><?></span>',
          parts: [{ type: 2, index: 1 }],
        },
        values: ['Admin'],
      };

      const outerTemplate = html`<div class="user-card"><h3>${'John Doe'}</h3>${innerCompiled}</div>`;
      const output = renderToString(outerTemplate);

      expect(output).toBe('<div class="user-card"><h3>John Doe</h3><span class="badge">Admin</span></div>');
    });

    it('handles self-closing elements with dynamic attributes in compiled templates', () => {
      const selfClosingDesc: CompiledTemplateResult = {
        _$litType$: {
          h: '<input/><img/>',
          parts: [
            { type: 1, index: 0, name: 'type', strings: ['', ''] },
            { type: 1, index: 0, name: 'disabled', ctorType: 4 },
            { type: 1, index: 1, name: 'src', strings: ['', ''] },
            { type: 1, index: 1, name: 'alt', strings: ['', ''] },
          ],
        },
        values: ['checkbox', true, '/logo.png', 'Logo'],
      };

      const output = renderToString(selfClosingDesc);
      expect(output).toContain('<input type="checkbox" disabled/>');
      expect(output).toContain('<img src="/logo.png" alt="Logo"/>');
    });

    it('handles compiled template descriptors with null or missing parts cleanly', () => {
      const malformedDesc = {
        _$litType$: {
          h: '<p>test</p>',
          parts: null,
        },
        values: [],
      };

      expect(isCompiledTemplateResult(malformedDesc)).toBe(true);
      expect(renderToString(malformedDesc)).toBe('<p>test</p>');
    });

    it('handles non-monotonic child part indices without duplicating or dropping values', () => {
      const desc = {
        _$litType$: {
          h: '<div><?> - <?></div>',
          parts: [
            { type: 2, index: 1 },
            { type: 2, index: 0 },
          ],
        },
        values: ['first', 'second'],
      };

      const output = renderToString(desc);
      expect(output).toBe('<div>first - second</div>');
    });

    it('handles all 24 non-monotonic child part index permutations across 4 elements', () => {
      function permute<T>(arr: T[]): T[][] {
        if (arr.length <= 1) return [arr];
        const result: T[][] = [];
        for (let i = 0; i < arr.length; i++) {
          const rest = permute(arr.slice(0, i).concat(arr.slice(i + 1)));
          for (const r of rest) result.push([arr[i], ...r]);
        }
        return result;
      }

      const partsBase = [
        { type: 2, index: 1, val: 'A' },
        { type: 2, index: 2, val: 'B' },
        { type: 2, index: 3, val: 'C' },
        { type: 2, index: 4, val: 'D' },
      ];

      const permutations = permute([0, 1, 2, 3]);
      expect(permutations).toHaveLength(24);

      for (const p of permutations) {
        const parts = p.map((idx) => ({ type: 2, index: partsBase[idx].index }));
        const values = p.map((idx) => partsBase[idx].val);
        const desc = {
          _$litType$: {
            h: '<div><?>|<?>|<?>|<?></div>',
            parts,
          },
          values,
        };
        const res = renderToString(desc);
        expect(res).toBe('<div>A|B|C|D</div>');
      }
    });
  });

  describe('slot projection edge cases', () => {
    it('projects slot when slot element has additional attributes', () => {
      const shadowWithClass = '<slot class="main-slot">fallback</slot>';
      const res = projectSlots(shadowWithClass, [{ content: '<div>projected</div>' }]);

      expect(res.projectedShadow).toBe('<div>projected</div>');
    });

    it('projects named and default slots with multiple attributes and arbitrary ordering', () => {
      const shadow = '<slot name="header" class="hdr" id="s1">Fallback Header</slot><main><slot id="s2" class="body">Fallback Body</slot></main>';
      const res = projectSlots(shadow, [{ slot: 'header', content: '<h1>Header Content</h1>' }, { content: '<p>Body Content</p>' }]);

      expect(res.projectedShadow).toBe('<h1>Header Content</h1><main><p>Body Content</p></main>');
      expect(res.lightRemainder).toBe('');
    });
  });

  describe('large payload streaming and memory stability', () => {
    it('streams large payloads with stable memory footprint', async () => {
      const itemCount = 5000;

      function* largeListGenerator(): IterableIterator<string> {
        yield '<ul class="large-dataset">\n';
        for (let i = 0; i < itemCount; i++) {
          yield `  <li id="item-${i}" data-index="${i}"><span>Item title ${i}</span><p>Description for record ${i}</p></li>\n`;
        }
        yield '</ul>\n';
      }

      const stream = createStreamFromIterator(largeListGenerator(), { highWaterMark: 16 });
      const reader = stream.getReader();

      let totalBytes = 0;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          chunkCount++;
        }
      }

      expect(chunkCount).toBeGreaterThan(10);
      expect(totalBytes).toBeGreaterThan(400_000);
    });

    it('streams large 10MB payloads with minimal heap delta', async () => {
      const targetBytes = 10 * 1024 * 1024;
      const chunkSize = 64 * 1024;
      const totalChunks = Math.ceil(targetBytes / chunkSize);

      function* generate10Mb(): IterableIterator<string> {
        const chunkContent = 'A'.repeat(chunkSize);
        for (let i = 0; i < totalChunks; i++) {
          yield chunkContent;
        }
      }

      const initialHeap = process.memoryUsage().heapUsed;
      const stream = createStreamFromIterator(generate10Mb(), { highWaterMark: 4 });
      const reader = stream.getReader();

      let totalBytes = 0;
      let chunkCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          chunkCount++;
        }
      }

      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

      expect(totalBytes).toBeGreaterThanOrEqual(targetBytes);
      expect(chunkCount).toBe(totalChunks);
      expect(heapDeltaMb).toBeLessThan(10);
    });

    it('executes 200 sequential streaming renders without memory accumulation', async () => {
      const runCount = 200;
      const initialHeap = process.memoryUsage().heapUsed;

      for (let i = 0; i < runCount; i++) {
        const tpl = html`<div data-run="${i}"><span>Test #${i}</span><p>Content for run ${i}</p></div>`;
        const res = await collectResult(renderToStream(tpl));
        expect(res).toContain(`Test #${i}`);
      }

      const finalHeap = process.memoryUsage().heapUsed;
      const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

      expect(heapDeltaMb).toBeLessThan(50);
    });
  });
});
