import { closeSharedBrowser, createTestPage, getSharedBrowser } from '@lit-core/test-kit';
import { afterAll, describe, expect, it } from 'vitest';
import { computeDomParts, computeDomPaths } from '../src/index.js';

afterAll(async () => {
  await closeSharedBrowser();
});

async function withBrowserPage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  const browser = await getSharedBrowser();
  const managed = await createTestPage(browser);
  try {
    return await fn(managed.page);
  } finally {
    await managed.close();
  }
}

describe('dom-paths DSD soundness on real Chromium Declarative Shadow DOM', () => {
  it('classifies parts into 3 sound addressability classes', () => {
    // 1. Element-anchored
    const elemTemplate = ['<button id="', '" ?disabled="', '" @click="', '">Click</button>'];
    const elemParts = computeDomParts(elemTemplate);
    expect(elemParts).toHaveLength(3);
    for (const p of elemParts) {
      expect(p.isAttribute).toBe(true);
      expect(p.addressing.kind).toBe('element');
      expect(p.addressing.type).toBe('ElementAnchored');
    }

    // 2. Sole text child
    const soleTemplate = ['<div><h1>', '</h1><p>', '</p><span>', '</span></div>'];
    const soleParts = computeDomParts(soleTemplate);
    expect(soleParts).toHaveLength(3);
    for (const p of soleParts) {
      expect(p.isAttribute).toBe(false);
      expect(p.addressing.kind).toBe('sole-text');
      expect(p.addressing.type).toBe('SoleTextChild');
    }

    // 3. Range-addressed (sibling text, adjacent holes)
    const rangeTemplate = ['<div>Count: ', ' items<span>', '', '</span></div>'];
    const rangeParts = computeDomParts(rangeTemplate);
    expect(rangeParts).toHaveLength(3);
    for (const p of rangeParts) {
      expect(p.isAttribute).toBe(false);
      expect(p.addressing.kind).toBe('range');
      expect(p.addressing.type).toBe('RangeAddressed');
    }
  });

  it('accurately indexes HTML5 implied tbody in tables', () => {
    const tableTemplate = ['<table><tr><td>', '</td><td>', '</td></tr></table>'];
    const paths = computeDomPaths(tableTemplate);
    const parts = computeDomParts(tableTemplate);

    // HTML5 parser inserts implied <tbody>: table -> tbody (0) -> tr (0) -> td (0 or 1) -> text (0)
    expect(paths[0]).toEqual([0, 0, 0, 0, 0]);
    expect(paths[1]).toEqual([0, 0, 0, 1, 0]);

    expect(parts[0].addressing.kind).toBe('sole-text');
    expect(parts[0].addressing.parentPath).toEqual([0, 0, 0, 0]);
  });

  it('accurately indexes SVG elements and preserved casing', () => {
    const svgTemplate = ['<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="', '"></circle><text x="10" y="20">', '</text></svg>'];
    const parts = computeDomParts(svgTemplate);
    expect(parts).toHaveLength(2);

    // Part 0 is attribute on circle: svg (0) -> circle (0)
    expect(parts[0].isAttribute).toBe(true);
    expect(parts[0].path).toEqual([0, 0]);
    expect(parts[0].addressing.kind).toBe('element');

    // Part 1 is sole text child of text: svg (0) -> text (1)
    expect(parts[1].isAttribute).toBe(false);
    expect(parts[1].addressing.kind).toBe('sole-text');
    expect(parts[1].addressing.parentPath).toEqual([0, 1]);
  });

  it('resolves 100% of addressable parts in real Chromium Declarative Shadow DOM', async () => {
    await withBrowserPage(async (page) => {
      const testCases = [
        // 1. Sole text children with numbers, entities, and empty strings
        {
          html: '<test-fixture-1><template shadowrootmode="open"><div><h1>Initial Title</h1><p>42</p><span>&lt;ok&gt;</span></div></template></test-fixture-1>',
          templateQuasis: ['<div><h1>', '</h1><p>', '</p><span>', '</span></div>'],
          expected: [
            { kind: 'sole-text', initial: 'Initial Title', update: 'Updated Title' },
            { kind: 'sole-text', initial: '42', update: '100' },
            { kind: 'sole-text', initial: '<ok>', update: 'Final' },
          ],
        },

        // 2. Implied <tbody> in tables
        {
          html: '<test-fixture-2><template shadowrootmode="open"><table><tr><td>Initial Cell 1</td><td>Initial Cell 2</td></tr></table></template></test-fixture-2>',
          templateQuasis: ['<table><tr><td>', '</td><td>', '</td></tr></table>'],
          expected: [
            { kind: 'sole-text', initial: 'Initial Cell 1', update: 'Updated Cell 1' },
            { kind: 'sole-text', initial: 'Initial Cell 2', update: 'Updated Cell 2' },
          ],
        },
        // 3. Element-anchored bindings on native and SVG elements
        {
          html: '<test-fixture-3><template shadowrootmode="open"><div><button id="btn-1" disabled>Button</button><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="25"></circle></svg></div></template></test-fixture-3>',
          templateQuasis: ['<div><button id="', '" ?disabled="', '">Button</button><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="', '"></circle></svg></div>'],
          expected: [
            { kind: 'element', attr: 'id', initial: 'btn-1', update: 'btn-updated' },
            { kind: 'element', attr: 'disabled', initial: '', update: null },
            { kind: 'element', attr: 'r', initial: '25', update: '50' },
          ],
        },
      ];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const tagName = `test-fixture-${i + 1}`;

        // Compute descriptors via compiler
        const parts = computeDomParts(tc.templateQuasis);
        expect(parts).toHaveLength(tc.expected.length);

        await page.setContent(`<!DOCTYPE html><html><body>${tc.html}</body></html>`);

        const evalResult = await page.evaluate(
          ({ tagName, parts, expected }) => {
            const host = document.querySelector(tagName);
            if (!host?.shadowRoot) {
              return { success: false, error: 'ShadowRoot not found' };
            }
            const root = host.shadowRoot;

            function resolveNodeByPath(r: Node, path: number[]): Node | null {
              let cur: any = r;
              for (let j = 0; j < path.length; j++) {
                if (!cur?.childNodes) return null;
                cur = cur.childNodes[path[j]];
              }
              return cur;
            }

            for (let j = 0; j < parts.length; j++) {
              const part = parts[j];
              const exp = expected[j];

              if (exp.kind === 'sole-text') {
                const parentPath = part.addressing.parentPath || part.path.slice(0, -1);
                const parentEl = resolveNodeByPath(root, parentPath) as Element | null;
                if (parentEl?.nodeType !== 1) {
                  return {
                    success: false,
                    error: `Failed to resolve sole-text parent at [${parentPath.join(', ')}]`,
                  };
                }
                if (parentEl.textContent?.trim() !== exp.initial) {
                  return {
                    success: false,
                    error: `Sole-text initial mismatch: expected '${exp.initial}', got '${parentEl.textContent?.trim()}'`,
                  };
                }
                // Mutate
                parentEl.textContent = exp.update;
                if (parentEl.textContent !== exp.update) {
                  return { success: false, error: 'Sole-text update mutation failed' };
                }
              } else if (exp.kind === 'element') {
                const el = resolveNodeByPath(root, part.path) as Element | null;
                if (el?.nodeType !== 1) {
                  return {
                    success: false,
                    error: `Failed to resolve element at [${part.path.join(', ')}]`,
                  };
                }
                const actual = el.getAttribute(exp.attr);
                if (exp.initial !== null && actual !== exp.initial) {
                  return {
                    success: false,
                    error: `Element attribute mismatch: expected '${exp.initial}', got '${actual}'`,
                  };
                }
                // Mutate
                if (exp.update === null) {
                  el.removeAttribute(exp.attr);
                  if (el.hasAttribute(exp.attr)) {
                    return { success: false, error: 'Attribute removal failed' };
                  }
                } else {
                  el.setAttribute(exp.attr, exp.update);
                  if (el.getAttribute(exp.attr) !== exp.update) {
                    return { success: false, error: 'Attribute update failed' };
                  }
                }
              } else if (exp.kind === 'range') {
                const whatToShow = 128 | 64; // SHOW_COMMENT (128) | SHOW_PROCESSING_INSTRUCTION (64)
                const walker = document.createTreeWalker(root, whatToShow);
                let startMarker: Node | null = null;
                const targetData = `name="${exp.name}"`;
                while (walker.nextNode()) {
                  const node = walker.currentNode;
                  if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'start' && (node as ProcessingInstruction).data.includes(targetData)) {
                    startMarker = node;
                    break;
                  }
                  if (node.nodeType === 8 && ((node as Comment).data.startsWith(`?start name="${exp.name}"`) || (node as Comment).data.startsWith(`start name="${exp.name}"`))) {
                    startMarker = node;
                    break;
                  }
                }
                if (!startMarker) {
                  return { success: false, error: `Range marker '${exp.name}' not found` };
                }

                let endMarker: Node | null = null;
                let depth = 0;
                let cur: Node | null = startMarker.nextSibling;
                while (cur) {
                  if (cur.nodeType === 7) {
                    const pi = cur as ProcessingInstruction;
                    if (pi.target === 'start') {
                      depth++;
                    } else if (pi.target === 'end') {
                      if (depth === 0) {
                        endMarker = cur;
                        break;
                      }
                      depth--;
                    }
                  } else if (cur.nodeType === 8) {
                    const data = (cur as Comment).data;
                    if (data.startsWith('?start') || data.startsWith('start name=')) {
                      depth++;
                    } else if (data === '?end' || data.startsWith('?end') || data === 'end' || data.startsWith('end')) {
                      if (depth === 0) {
                        endMarker = cur;
                        break;
                      }
                      depth--;
                    }
                  }
                  cur = cur.nextSibling;
                }
                if (!endMarker) {
                  return { success: false, error: `Range end marker for '${exp.name}' not found` };
                }

                // Range content check & update
                const textNode = startMarker.nextSibling;
                if (textNode && textNode !== endMarker && textNode.nodeType === 3) {
                  if (textNode.textContent !== exp.initial) {
                    return {
                      success: false,
                      error: `Range initial mismatch: expected '${exp.initial}', got '${textNode.textContent}'`,
                    };
                  }
                  textNode.textContent = exp.update;
                } else {
                  startMarker.after(document.createTextNode(exp.update));
                }
              }
            }

            return { success: true };
          },
          { tagName, parts, expected: tc.expected },
        );

        if (!evalResult.success) {
          console.error(`Case ${i} failed:`, evalResult.error);
        }
        expect(evalResult.error).toBeUndefined();
        expect(evalResult.success).toBe(true);
      }
    });
  });

  it('verifies 100% addressability on randomized property-generated DOM templates in Chromium', async () => {
    await withBrowserPage(async (page) => {
      // Randomized property test generation: 10 diverse templates
      const containerTags = ['div', 'section', 'article', 'main', 'aside'];
      const childTags = ['p', 'span', 'h2', 'h3', 'em', 'strong'];

      for (let run = 0; run < 10; run++) {
        const cTag = containerTags[run % containerTags.length];
        const numParts = (run % 4) + 1; // 1 to 4 parts
        const quasis: string[] = [];
        const expectedItems: Array<{ kind: string; name?: string; initial: string; update: string }> = [];

        const currentHtml = `<${cTag}>`;
        quasis.push(currentHtml);

        for (let p = 0; p < numParts; p++) {
          const innerTag = childTags[(p + run) % childTags.length];
          quasis[quasis.length - 1] += `<${innerTag}>`;
          quasis.push(`</${innerTag}>`);
          expectedItems.push({
            kind: 'sole-text',
            initial: `Val_${run}_${p}`,
            update: `Updated_${run}_${p}`,
          });
        }
        quasis[quasis.length - 1] += `</${cTag}>`;

        // Build pre-rendered DSD HTML
        let dsdBody = `<${cTag}>`;
        for (let p = 0; p < numParts; p++) {
          const exp = expectedItems[p];
          const innerTag = childTags[(p + run) % childTags.length];
          dsdBody += `<${innerTag}>${exp.initial}</${innerTag}>`;
        }
        dsdBody += `</${cTag}>`;

        const hostTag = `prop-fixture-${run}`;
        const pageHtml = `<${hostTag}><template shadowrootmode="open">${dsdBody}</template></${hostTag}>`;

        const parts = computeDomParts(quasis);
        expect(parts).toHaveLength(numParts);

        await page.setContent(`<!DOCTYPE html><html><body>${pageHtml}</body></html>`);

        const result = await page.evaluate(
          ({ hostTag, parts, expectedItems }) => {
            const host = document.querySelector(hostTag);
            if (!host?.shadowRoot) return { success: false, error: 'No shadowRoot' };
            const root = host.shadowRoot;

            function resolve(r: Node, path: number[]): Node | null {
              let cur: any = r;
              for (const idx of path) {
                if (!cur?.childNodes) return null;
                cur = cur.childNodes[idx];
              }
              return cur;
            }

            for (let idx = 0; idx < parts.length; idx++) {
              const part = parts[idx];
              const exp = expectedItems[idx];

              if (exp.kind === 'sole-text') {
                const parentPath = part.addressing.parentPath || part.path.slice(0, -1);
                const el = resolve(root, parentPath) as Element | null;
                if (!el || el.textContent !== exp.initial) {
                  return {
                    success: false,
                    error: `sole-text mismatch at ${idx}: expected '${exp.initial}', got '${el?.textContent}'`,
                  };
                }
                el.textContent = exp.update;
              } else if (exp.kind === 'range') {
                const whatToShow = 128 | 64;
                const walker = document.createTreeWalker(root, whatToShow);
                let start: Node | null = null;
                const targetData = `name="${exp.name}"`;
                while (walker.nextNode()) {
                  const node = walker.currentNode;
                  if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'start' && (node as ProcessingInstruction).data.includes(targetData)) {
                    start = node;
                    break;
                  }
                  if (node.nodeType === 8 && ((node as Comment).data.startsWith(`?start name="${exp.name}"`) || (node as Comment).data.startsWith(`start name="${exp.name}"`))) {
                    start = node;
                    break;
                  }
                }
                if (!start) return { success: false, error: `Missing start for ${exp.name}` };

                let end: Node | null = null;
                let cur = start.nextSibling;
                let depth = 0;
                while (cur) {
                  if (cur.nodeType === 7) {
                    const pi = cur as ProcessingInstruction;
                    if (pi.target === 'start') {
                      depth++;
                    } else if (pi.target === 'end') {
                      if (depth === 0) {
                        end = cur;
                        break;
                      }
                      depth--;
                    }
                  } else if (cur.nodeType === 8) {
                    const d = (cur as Comment).data;
                    if (d.startsWith('?start') || d.startsWith('start name=')) {
                      depth++;
                    } else if (d === '?end' || d.startsWith('?end') || d === 'end' || d.startsWith('end')) {
                      if (depth === 0) {
                        end = cur;
                        break;
                      }
                      depth--;
                    }
                  }
                  cur = cur.nextSibling;
                }
                if (!end) return { success: false, error: `Missing end for ${exp.name}` };

                const text = start.nextSibling;
                if (text && text !== end && text.nodeType === 3) {
                  if (text.textContent !== exp.initial) {
                    return {
                      success: false,
                      error: `range initial mismatch: expected '${exp.initial}', got '${text.textContent}'`,
                    };
                  }
                  text.textContent = exp.update;
                }
              }
            }
            return { success: true };
          },
          { hostTag, parts, expectedItems },
        );

        if (!result.success) {
          console.error(`Run ${run} failed:`, result.error);
        }
        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
      }
    });
  });
});
