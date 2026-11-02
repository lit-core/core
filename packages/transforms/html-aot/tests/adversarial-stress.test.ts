import { closeSharedBrowser, createTestPage, getSharedBrowser } from '@lit-core/test-kit';
import { html } from 'lit';
import { afterAll, describe, expect, it } from 'vitest';
import { renderToString } from '../../../rendering/ssr/src/index.js';
import { computeDomParts } from '../../dom-paths/src/index.js';
import { compileHtmlAot } from '../src/index.js';

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

function extractSsrPlan(code: string): any {
  const match = code.match(/ssrPlan:\s*(\{[\s\S]*?\n\t\})/);
  if (!match) return null;
  return new Function(`return ${match[1]};`)();
}

function renderAot(resultOrStrings: any, ...values: any[]): string {
  let strings: readonly string[];
  let vals: any[];
  if (resultOrStrings && Array.isArray(resultOrStrings.strings) && Array.isArray(resultOrStrings.values)) {
    strings = resultOrStrings.strings;
    vals = resultOrStrings.values;
  } else {
    strings = resultOrStrings;
    vals = values;
  }
  let source = 'import { html } from "lit";\nexport const comp = () => html`';
  for (let i = 0; i < strings.length; i++) {
    source += strings[i];
    if (i < vals.length) {
      source += `\${v[${i}]}`;
    }
  }
  source += '`;';
  const compiled = compileHtmlAot(source, { filename: 'test_aot.ts', ssr: true });
  const plan = extractSsrPlan(compiled.code);
  if (!plan) {
    throw new Error(`Failed to extract ssrPlan from compiled code:\n${compiled.code}`);
  }
  const compiledResult = {
    _$litType$: {
      h: plan.h,
      parts: plan.parts || [],
      ssrPlan: plan,
    },
    values: vals,
  };
  return renderToString(compiledResult);
}

describe('adversarial stress testing: part addressing and dom topologies', () => {
  // Test Vector 1: Triple and quadruple adjacent dynamic holes without whitespace
  it('handles multiple adjacent dynamic holes with range marker integrity in real chromium', async () => {
    await withBrowserPage(async (page) => {
      // 1. Triple adjacent dynamic expressions: <div>${a}${b}${c}</div>
      const tripleTemplate = ['<div>', '', '', '</div>'];
      const tripleParts = computeDomParts(tripleTemplate);
      expect(tripleParts).toHaveLength(3);

      for (let i = 0; i < 3; i++) {
        expect(tripleParts[i].addressing.type).toBe('RangeAddressed');
        expect(tripleParts[i].addressing.kind).toBe('range');
        expect(tripleParts[i].addressing.name).toBe(`p${i}`);
      }

      const tripleResult = html`<div>${'Alpha'}${'Beta'}${'Gamma'}</div>`;
      const tripleHtml = renderAot(tripleResult);
      console.log('TRIPLE HTML:', tripleHtml);

      await page.setContent(`<!DOCTYPE html><html><body><triple-fixture><template shadowrootmode="open">${tripleHtml}</template></triple-fixture></body></html>`);

      const tripleEval = await page.evaluate(() => {
        const root = document.querySelector('triple-fixture')?.shadowRoot;
        if (!root) return { success: false, error: 'No shadowRoot' };

        function findMarker(name: string): { start: Node; end: Node } | null {
          const target = `name="${name}"`;
          const walker = document.createTreeWalker(root, 128 | 64);
          let start: Node | null = null;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'start' && (node as ProcessingInstruction).data.includes(target)) {
              start = node;
              break;
            }
            if (node.nodeType === 8 && ((node as Comment).data.startsWith(`?start name="${name}"`) || (node as Comment).data.startsWith(`start name="${name}"`))) {
              start = node;
              break;
            }
          }
          if (!start) return null;

          let end: Node | null = null;
          let depth = 0;
          let cur: Node | null = start.nextSibling;
          while (cur) {
            if (cur.nodeType === 7) {
              const pi = cur as ProcessingInstruction;
              if (pi.target === 'start') depth++;
              else if (pi.target === 'end') {
                if (depth === 0) {
                  end = cur;
                  break;
                }
                depth--;
              }
            } else if (cur.nodeType === 8) {
              const d = (cur as Comment).data;
              if (d.startsWith('?start') || d.startsWith('start name=')) depth++;
              else if (d === '?end' || d.startsWith('?end') || d === 'end' || d.startsWith('end')) {
                if (depth === 0) {
                  end = cur;
                  break;
                }
                depth--;
              }
            }
            cur = cur.nextSibling;
          }
          if (!end) return null;
          return { start, end };
        }

        const m0 = findMarker('p0');
        const m1 = findMarker('p1');
        const m2 = findMarker('p2');

        if (!m0) return { success: false, error: 'm0 missing' };
        if (!m1) return { success: false, error: 'm1 missing' };
        if (!m2) return { success: false, error: 'm2 missing' };

        // Verify correct marker sequence in DOM
        // m0.start -> text0 ("Alpha") -> m0.end -> m1.start -> text1 ("Beta") -> m1.end -> m2.start -> text2 ("Gamma") -> m2.end
        if (m0.end.nextSibling !== m1.start) {
          return { success: false, error: 'm0.end not directly adjacent to m1.start' };
        }
        if (m1.end.nextSibling !== m2.start) {
          return { success: false, error: 'm1.end not directly adjacent to m2.start' };
        }

        const text0 = m0.start.nextSibling;
        const text1 = m1.start.nextSibling;
        const text2 = m2.start.nextSibling;

        if (text0?.textContent !== 'Alpha') return { success: false, error: `text0 mismatch: ${text0?.textContent}` };
        if (text1?.textContent !== 'Beta') return { success: false, error: `text1 mismatch: ${text1?.textContent}` };
        if (text2?.textContent !== 'Gamma') return { success: false, error: `text2 mismatch: ${text2?.textContent}` };

        // Test independent surgical mutation
        text0.textContent = 'A_UPDATED';
        text1.textContent = 'B_UPDATED';
        text2.textContent = 'C_UPDATED';

        const parentDiv = root.querySelector('div');
        if (parentDiv?.textContent !== 'A_UPDATEDB_UPDATEDC_UPDATED') {
          return { success: false, error: `Unexpected textContent: ${parentDiv?.textContent}` };
        }

        return { success: true };
      });

      expect(tripleEval.error).toBeUndefined();
      expect(tripleEval.success).toBe(true);
    });
  });

  // Test Vector 2: SVG case sensitivity and foreignObject boundaries
  it('preserves SVG attribute and tag casing and handles foreignObject boundaries', async () => {
    await withBrowserPage(async (page) => {
      // Test preserveAspectRatio, viewBox, gradientUnits, patternUnits, foreignObject
      const svgTemplate = [
        '<svg viewBox="',
        '" preserveAspectRatio="',
        '"><defs><linearGradient id="g1" gradientUnits="',
        '"><stop offset="0%"></stop></linearGradient><pattern id="p1" patternUnits="',
        '"></pattern></defs><foreignObject width="100" height="100"><div><p>',
        '</p></div></foreignObject></svg>',
      ];
      const svgParts = computeDomParts(svgTemplate);
      expect(svgParts).toHaveLength(5);

      // Part 0: viewBox on svg
      expect(svgParts[0].addressing.attrName).toBe('viewBox');
      // Part 1: preserveAspectRatio on svg
      expect(svgParts[1].addressing.attrName).toBe('preserveAspectRatio');
      // Part 2: gradientUnits on linearGradient
      expect(svgParts[2].addressing.attrName).toBe('gradientUnits');
      // Part 3: patternUnits on pattern
      expect(svgParts[3].addressing.attrName).toBe('patternUnits');
      // Part 4: sole text child inside foreignObject -> div -> p
      expect(svgParts[4].addressing.kind).toBe('sole-text');

      const svgResult = html`<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="g1" gradientUnits="userSpaceOnUse"><stop offset="0%"></stop></linearGradient><pattern id="p1" patternUnits="userSpaceOnUse"></pattern></defs><foreignObject width="100" height="100"><div><p>Foreign Content</p></div></foreignObject></svg>`;
      const svgHtml = renderAot(svgResult);

      await page.setContent(`<!DOCTYPE html><html><body><svg-stress-fixture><template shadowrootmode="open">${svgHtml}</template></svg-stress-fixture></body></html>`);

      const svgEval = await page.evaluate(
        ({ parts }) => {
          const root = document.querySelector('svg-stress-fixture')?.shadowRoot;
          if (!root) return { success: false, error: 'No shadowRoot' };

          const svg = root.querySelector('svg');
          if (!svg) return { success: false, error: 'svg not found' };

          // Verify exact casing attributes on SVG
          if (svg.getAttribute('viewBox') !== '0 0 200 200') {
            return { success: false, error: `viewBox mismatch: ${svg.getAttribute('viewBox')}` };
          }
          if (svg.getAttribute('preserveAspectRatio') !== 'xMidYMid meet') {
            return { success: false, error: `preserveAspectRatio mismatch: ${svg.getAttribute('preserveAspectRatio')}` };
          }

          const grad = root.querySelector('linearGradient');
          if (grad?.getAttribute('gradientUnits') !== 'userSpaceOnUse') {
            return { success: false, error: `gradientUnits mismatch: ${grad?.getAttribute('gradientUnits')}` };
          }

          const pat = root.querySelector('pattern');
          if (pat?.getAttribute('patternUnits') !== 'userSpaceOnUse') {
            return { success: false, error: `patternUnits mismatch: ${pat?.getAttribute('patternUnits')}` };
          }

          const fo = root.querySelector('foreignObject');
          if (fo?.namespaceURI !== 'http://www.w3.org/2000/svg') {
            return { success: false, error: `foreignObject invalid namespace: ${fo?.namespaceURI}` };
          }

          function resolve(r: Node, path: number[]): Node | null {
            let cur: any = r;
            for (const idx of path) {
              if (!cur?.childNodes) return null;
              cur = cur.childNodes[idx];
            }
            return cur;
          }

          // Part 4 is sole-text in p inside div in foreignObject
          const p = resolve(root, parts[4].addressing.parentPath) as HTMLElement | null;
          if (p?.nodeName !== 'P') {
            return { success: false, error: `Expected P element at parentPath, got ${p?.nodeName}` };
          }
          if (p.textContent?.trim() !== 'Foreign Content') {
            return { success: false, error: `Text mismatch: ${p.textContent}` };
          }

          // In standard HTML, elements inside foreignObject have HTML namespace
          if (p.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
            return { success: false, error: `p inside foreignObject has unexpected namespace: ${p.namespaceURI}` };
          }

          return { success: true };
        },
        { parts: svgParts },
      );

      expect(svgEval.error).toBeUndefined();
      expect(svgEval.success).toBe(true);
    });
  });

  // Test Vector 3: Table auto-tbody insertion under complex structures
  it('handles complex tables with colgroup, thead, tbody, tfoot, and caption in real chromium', async () => {
    await withBrowserPage(async (page) => {
      const tableTemplate = [
        '<table><caption>',
        '</caption><colgroup><col span="1" class="',
        '"></colgroup><thead><tr><th>',
        '</th></tr></thead><tbody><tr><td>',
        '</td></tr></tbody><tfoot><tr><td>',
        '</td></tr></tfoot></table>',
      ];
      const tableParts = computeDomParts(tableTemplate);
      expect(tableParts).toHaveLength(5);

      // Part 0: sole text child of caption -> table (0) -> caption (0)
      expect(tableParts[0].addressing.parentPath).toEqual([0, 0]);
      // Part 1: element-anchored class on col -> table (0) -> colgroup (1) -> col (0)
      expect(tableParts[1].path).toEqual([0, 1, 0]);
      // Part 2: thead -> tr -> th -> table (0) -> thead (2) -> tr (0) -> th (0)
      expect(tableParts[2].addressing.parentPath).toEqual([0, 2, 0, 0]);
      // Part 3: tbody -> tr -> td -> table (0) -> tbody (3) -> tr (0) -> td (0)
      expect(tableParts[3].addressing.parentPath).toEqual([0, 3, 0, 0]);
      // Part 4: tfoot -> tr -> td -> table (0) -> tfoot (4) -> tr (0) -> td (0)
      expect(tableParts[4].addressing.parentPath).toEqual([0, 4, 0, 0]);

      const tableResult = html`<table><caption>Table Caption</caption><colgroup><col span="1" class="col-active"></colgroup><thead><tr><th>Head Title</th></tr></thead><tbody><tr><td>Body Cell</td></tr></tbody><tfoot><tr><td>Foot Cell</td></tr></tfoot></table>`;
      const tableHtml = renderAot(tableResult);

      await page.setContent(`<!DOCTYPE html><html><body><complex-table-fixture><template shadowrootmode="open">${tableHtml}</template></complex-table-fixture></body></html>`);

      const tableEval = await page.evaluate(
        ({ parts }) => {
          const root = document.querySelector('complex-table-fixture')?.shadowRoot;
          if (!root) return { success: false, error: 'No shadowRoot' };

          function resolve(r: Node, path: number[]): Node | null {
            let cur: any = r;
            for (const idx of path) {
              if (!cur?.childNodes) return null;
              cur = cur.childNodes[idx];
            }
            return cur;
          }

          const cap = resolve(root, parts[0].addressing.parentPath) as HTMLElement;
          if (cap?.nodeName !== 'CAPTION' || cap.textContent?.trim() !== 'Table Caption') {
            return { success: false, error: `Caption mismatch: ${cap?.nodeName} -> ${cap?.textContent}` };
          }

          const col = resolve(root, parts[1].path) as HTMLElement;
          if (col?.nodeName !== 'COL' || col.getAttribute('class') !== 'col-active') {
            return { success: false, error: `Col mismatch: ${col?.nodeName} -> ${col?.getAttribute('class')}` };
          }

          const th = resolve(root, parts[2].addressing.parentPath) as HTMLElement;
          if (th?.nodeName !== 'TH' || th.textContent?.trim() !== 'Head Title') {
            return { success: false, error: `TH mismatch: ${th?.nodeName} -> ${th?.textContent}` };
          }

          const tdBody = resolve(root, parts[3].addressing.parentPath) as HTMLElement;
          if (tdBody?.nodeName !== 'TD' || tdBody.textContent?.trim() !== 'Body Cell') {
            return { success: false, error: `Body TD mismatch: ${tdBody?.nodeName} -> ${tdBody?.textContent}` };
          }

          const tdFoot = resolve(root, parts[4].addressing.parentPath) as HTMLElement;
          if (tdFoot?.nodeName !== 'TD' || tdFoot.textContent?.trim() !== 'Foot Cell') {
            return { success: false, error: `Foot TD mismatch: ${tdFoot?.nodeName} -> ${tdFoot?.textContent}` };
          }

          return { success: true };
        },
        { parts: tableParts },
      );

      expect(tableEval.error).toBeUndefined();
      expect(tableEval.success).toBe(true);
    });
  });

  // Test Vector 4: Deeply nested template with mixed static text, expressions, and siblings
  it('accurately resolves part addresses across deeply nested templates in real chromium', async () => {
    await withBrowserPage(async (page) => {
      const deepTemplate = [
        '<div id="root" class="',
        '"><header><nav><ul><li><a href="',
        '">',
        '</a></li></ul></nav></header><main><section class="section"><article><header><h2>',
        '</h2><div class="meta"><span>By ',
        '</span><time datetime="',
        '">',
        '</time></div></header><div class="content"><p>Paragraph ',
        ' of ',
        '</p></div></article></section></main></div>',
      ];
      const deepParts = computeDomParts(deepTemplate);
      expect(deepParts).toHaveLength(9);

      const deepResult = html`<div id="root" class="app-root"><header><nav><ul><li><a href="/home">Home Link</a></li></ul></nav></header><main><section class="section"><article><header><h2>Article Title</h2><div class="meta"><span>By Alice</span><time datetime="2026-10-25">Today</time></div></header><div class="content"><p>Paragraph 1 of 5</p></div></article></section></main></div>`;
      const deepHtml = renderAot(deepResult);

      await page.setContent(`<!DOCTYPE html><html><body><deep-fixture><template shadowrootmode="open">${deepHtml}</template></deep-fixture></body></html>`);

      const deepEval = await page.evaluate(
        ({ parts }) => {
          const root = document.querySelector('deep-fixture')?.shadowRoot;
          if (!root) return { success: false, error: 'No shadowRoot' };

          function resolve(r: Node, path: number[]): Node | null {
            let cur: any = r;
            for (const idx of path) {
              if (!cur?.childNodes) return null;
              cur = cur.childNodes[idx];
            }
            return cur;
          }

          // Part 0: class on #root
          const rootEl = resolve(root, parts[0].path) as HTMLElement;
          if (rootEl?.getAttribute('class') !== 'app-root') return { success: false, error: 'Part 0 mismatch' };

          // Part 1: href on a
          const a = resolve(root, parts[1].path) as HTMLAnchorElement;
          if (a?.getAttribute('href') !== '/home') return { success: false, error: 'Part 1 mismatch' };

          // Part 2: sole text of a
          const aText = resolve(root, parts[2].addressing.parentPath) as HTMLElement;
          if (aText?.textContent?.trim() !== 'Home Link') return { success: false, error: 'Part 2 mismatch' };

          // Part 3: sole text of h2
          const h2 = resolve(root, parts[3].addressing.parentPath) as HTMLElement;
          if (h2?.textContent?.trim() !== 'Article Title') return { success: false, error: 'Part 3 mismatch' };

          // Part 4: range marker in span ("By Alice")
          // Part 5: datetime on time
          const time = resolve(root, parts[5].path) as HTMLElement;
          if (time?.getAttribute('datetime') !== '2026-10-25') return { success: false, error: 'Part 5 mismatch' };

          // Part 6: sole text of time
          const timeText = resolve(root, parts[6].addressing.parentPath) as HTMLElement;
          if (timeText?.textContent?.trim() !== 'Today') return { success: false, error: 'Part 6 mismatch' };

          // Part 7 and 8: range markers in p ("Paragraph 1 of 5")
          const p = root.querySelector('.content p');
          if (p?.textContent?.trim() !== 'Paragraph 1 of 5') return { success: false, error: `Part 7/8 mismatch: ${p?.textContent}` };

          return { success: true };
        },
        { parts: deepParts },
      );

      expect(deepEval.error).toBeUndefined();
      expect(deepEval.success).toBe(true);
    });
  });

  // Test Vector 5: Empty values, null, undefined, 0, and NaN across adjacent range markers
  it('handles empty and null values in adjacent range markers without collapsing DOM or marker structure', async () => {
    await withBrowserPage(async (page) => {
      // 4 adjacent expressions with falsy/empty values
      const falsyAdjacentResult = html`<div>${''}${null}${undefined}${0}</div>`;
      const falsyHtml = renderAot(falsyAdjacentResult);

      await page.setContent(`<!DOCTYPE html><html><body><falsy-range-fixture><template shadowrootmode="open">${falsyHtml}</template></falsy-range-fixture></body></html>`);

      const falsyEval = await page.evaluate(() => {
        const root = document.querySelector('falsy-range-fixture')?.shadowRoot;
        if (!root) return { success: false, error: 'No shadowRoot' };

        function findMarker(name: string): { start: Node; end: Node } | null {
          const target = `name="${name}"`;
          const walker = document.createTreeWalker(root, 128 | 64);
          let start: Node | null = null;
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'start' && (node as ProcessingInstruction).data.includes(target)) {
              start = node;
              break;
            }
            if (node.nodeType === 8 && ((node as Comment).data.startsWith(`?start name="${name}"`) || (node as Comment).data.startsWith(`start name="${name}"`))) {
              start = node;
              break;
            }
          }
          if (!start) return null;

          let end: Node | null = null;
          let depth = 0;
          let cur: Node | null = start.nextSibling;
          while (cur) {
            if (cur.nodeType === 7) {
              const pi = cur as ProcessingInstruction;
              if (pi.target === 'start') depth++;
              else if (pi.target === 'end') {
                if (depth === 0) {
                  end = cur;
                  break;
                }
                depth--;
              }
            } else if (cur.nodeType === 8) {
              const d = (cur as Comment).data;
              if (d.startsWith('?start') || d.startsWith('start name=')) depth++;
              else if (d === '?end' || d.startsWith('?end') || d === 'end' || d.startsWith('end')) {
                if (depth === 0) {
                  end = cur;
                  break;
                }
                depth--;
              }
            }
            cur = cur.nextSibling;
          }
          if (!end) return null;
          return { start, end };
        }

        const m0 = findMarker('p0'); // "" -> empty
        const m1 = findMarker('p1'); // null -> empty
        const m2 = findMarker('p2'); // undefined -> empty
        const m3 = findMarker('p3'); // 0 -> "0"

        if (!m0 || !m1 || !m2 || !m3) {
          return { success: false, error: 'One or more range markers missing' };
        }

        // p0, p1, p2 should have start immediately before end (empty)
        if (m0.start.nextSibling !== m0.end) {
          return { success: false, error: 'm0 should be empty between start and end' };
        }
        if (m1.start.nextSibling !== m1.end) {
          return { success: false, error: 'm1 should be empty between start and end' };
        }
        if (m2.start.nextSibling !== m2.end) {
          return { success: false, error: 'm2 should be empty between start and end' };
        }

        // p3 MUST contain text "0"
        const text3 = m3.start.nextSibling;
        if (text3?.textContent !== '0') {
          return { success: false, error: `m3 should contain '0', got: '${text3?.textContent}'` };
        }

        // Test inserting text into empty ranges
        const newText0 = document.createTextNode('Inserted Zero');
        m0.start.parentNode?.insertBefore(newText0, m0.end);

        const newText1 = document.createTextNode('Inserted One');
        m1.start.parentNode?.insertBefore(newText1, m1.end);

        const div = root.querySelector('div');
        if (div?.textContent !== 'Inserted ZeroInserted One0') {
          return { success: false, error: `Unexpected textContent after insertion: ${div?.textContent}` };
        }

        return { success: true };
      });

      expect(falsyEval.error).toBeUndefined();
      expect(falsyEval.success).toBe(true);
    });
  });

  // Test Vector 6: Dynamic holes in raw text elements (<textarea>, <title>)
  it('challenges dynamic holes in raw text elements (<textarea> and <title>)', () => {
    // 1. Check computeDomParts
    const textareaTemplate = ['<textarea>', '</textarea>'];
    const textareaParts = computeDomParts(textareaTemplate);
    console.log('TEXTAREA PARTS:', textareaParts);

    const titleTemplate = ['<title>', '</title>'];
    const titleParts = computeDomParts(titleTemplate);
    console.log('TITLE PARTS:', titleParts);

    // 2. Check compileHtmlAot
    const textareaSource = `
import { html } from 'lit';
export const comp = (val: string) => html\`<textarea>\${val}</textarea>\`;
`;
    const textareaCompiled = compileHtmlAot(textareaSource, { filename: 'textarea.ts', ssr: true });
    console.log('TEXTAREA COMPILED CODE:\n', textareaCompiled.code);
    const textareaPlan = extractSsrPlan(textareaCompiled.code);
    console.log('TEXTAREA PLAN:', textareaPlan);

    const titleSource = `
import { html } from 'lit';
export const comp = (val: string) => html\`<title>\${val}</title>\`;
`;
    const titleCompiled = compileHtmlAot(titleSource, { filename: 'title.ts', ssr: true });
    console.log('TITLE COMPILED CODE:\n', titleCompiled.code);
    // 3. Check what renderToString produces for standard Lit template with raw text elements
    expect(() => renderToString(html`<textarea>${'Initial content'}</textarea>`)).toThrow(/Failed to parse Lit template into spec-compliant HTML IR/);
    expect(() => renderToString(html`<title>${'Page Title'}</title>`)).toThrow(/Failed to parse Lit template into spec-compliant HTML IR/);
  });

  // Test Vector 7: Sibling elements following RangeMarkers (parent audit directive)
  it('resolves sibling elements following RangeMarkers via logical child path stepping in real chromium', async () => {
    await withBrowserPage(async (page) => {
      // Mixed 3-tier template:
      // RangeMarker (Part 0) -> Sibling Element (Part 1, ElementAnchored) -> RangeMarker (Part 2) -> Sibling Element (Part 3, ElementAnchored)
      const mixedTemplate = ['<div>', ' <span id="', '">First Sibling</span> ', ' <button ?disabled="', '">Second Sibling</button></div>'];
      const mixedParts = computeDomParts(mixedTemplate);
      expect(mixedParts).toHaveLength(4);

      // Part 0: RangeAddressed p0
      expect(mixedParts[0].addressing.type).toBe('RangeAddressed');
      expect(mixedParts[0].addressing.name).toBe('p0');

      // Part 1: ElementAnchored on span
      expect(mixedParts[1].addressing.type).toBe('ElementAnchored');
      expect(mixedParts[1].addressing.attrName).toBe('id');

      // Part 2: RangeAddressed p2 (expression index 2)
      expect(mixedParts[2].addressing.type).toBe('RangeAddressed');
      expect(mixedParts[2].addressing.name).toBe('p2');

      // Part 3: ElementAnchored on button
      expect(mixedParts[3].addressing.type).toBe('ElementAnchored');
      expect(mixedParts[3].addressing.attrName).toBe('disabled');

      const mixedResult = html`<div>${'Dynamic Leading Text'} <span id="span-target">First Sibling</span> ${'Dynamic Middle Text'} <button ?disabled=${true}>Second Sibling</button></div>`;
      const mixedHtml = renderAot(mixedResult);

      await page.setContent(`<!DOCTYPE html><html><body><sibling-fixture><template shadowrootmode="open">${mixedHtml}</template></sibling-fixture></body></html>`);

      const siblingEval = await page.evaluate(
        ({ parts }) => {
          const root = document.querySelector('sibling-fixture')?.shadowRoot;
          if (!root) return { success: false, error: 'No shadowRoot' };

          function isRangeStart(node: Node): boolean {
            if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'start') return true;
            if (node.nodeType === 8) {
              const d = (node as Comment).data;
              return d.startsWith('?start') || d.startsWith('start name=');
            }
            return false;
          }

          function isRangeEnd(node: Node): boolean {
            if (node.nodeType === 7 && (node as ProcessingInstruction).target === 'end') return true;
            if (node.nodeType === 8) {
              const d = (node as Comment).data;
              return d === '?end' || d.startsWith('?end') || d === 'end' || d.startsWith('end');
            }
            return false;
          }

          function advanceToEnd(start: Node): Node {
            let depth = 0;
            let cur: Node | null = start.nextSibling;
            while (cur) {
              if (isRangeStart(cur)) depth++;
              else if (isRangeEnd(cur)) {
                if (depth === 0) return cur;
                depth--;
              }
              cur = cur.nextSibling;
            }
            return start;
          }

          /**
           * Logical child path stepping required by parent directive:
           * When stepping from child k to k + 1, if the current node is a range-start marker,
           * advance to its matching range-end marker before .nextSibling so the entire
           * range counts as 1 logical child matching TemplateIR.
           */
          function resolveLogical(container: Node, path: number[]): Node | null {
            let cur: any = container;
            for (const targetIdx of path) {
              if (!cur?.firstChild) return null;
              let node: Node | null = cur.firstChild;
              let logicalIdx = 0;
              while (node && logicalIdx < targetIdx) {
                if (isRangeStart(node)) {
                  node = advanceToEnd(node);
                }
                node = node.nextSibling;
                logicalIdx++;
              }
              if (!node) return null;
              cur = node;
            }
            return cur;
          }

          // Verify Part 1 (span) resolves via logical child path stepping
          const spanEl = resolveLogical(root, parts[1].path) as HTMLElement | null;
          if (spanEl?.nodeName !== 'SPAN') {
            return {
              success: false,
              error: `Part 1 (span) failed to resolve at logical path [${parts[1].path.join(', ')}]. Got: ${spanEl?.nodeName}`,
            };
          }
          if (spanEl.getAttribute('id') !== 'span-target') {
            return { success: false, error: `Part 1 id mismatch: ${spanEl.getAttribute('id')}` };
          }

          // Verify Part 3 (button) resolves via logical child path stepping
          const buttonEl = resolveLogical(root, parts[3].path) as HTMLButtonElement | null;
          if (buttonEl?.nodeName !== 'BUTTON') {
            return {
              success: false,
              error: `Part 3 (button) failed to resolve at logical path [${parts[3].path.join(', ')}]. Got: ${buttonEl?.nodeName}`,
            };
          }
          if (!buttonEl.hasAttribute('disabled')) {
            return { success: false, error: 'Part 3 button disabled attribute missing' };
          }

          return { success: true };
        },
        { parts: mixedParts },
      );

      expect(siblingEval.error).toBeUndefined();
      expect(siblingEval.success).toBe(true);
    });
  });

  // Test Vector 8: Table foster-parenting and dynamic row holes
  it('analyzes table foster-parenting and dynamic row/cell expressions in real chromium', async () => {
    await withBrowserPage(async (page) => {
      // Case A: Dynamic rows inside table with implied tbody vs explicit tbody
      // 1. Table with dynamic row expression: <table>${rows}</table>
      // When rows is a range marker inside table, how does Chromium handle it?
      const tableWithRowsTemplate = ['<table>', '</table>'];
      const tableWithRowsParts = computeDomParts(tableWithRowsTemplate);
      expect(tableWithRowsParts).toHaveLength(1);
      // In TemplateIR and HTML5 spec, comments directly inside <table> are attached
      // directly to the <table> element without triggering implied <tbody> insertion:
      // table (0) -> RangeMarker (0) => path [0, 0]
      expect(tableWithRowsParts[0].path).toEqual([0, 0]);

      // 2. Table with tr directly containing dynamic cells: <table><tr>${cells}</tr></table>
      const trWithCellsTemplate = ['<table><tr>', '</tr></table>'];
      const trWithCellsParts = computeDomParts(trWithCellsTemplate);
      expect(trWithCellsParts).toHaveLength(1);
      // table (0) -> tbody (0) -> tr (0) -> RangeMarker (0)
      expect(trWithCellsParts[0].path).toEqual([0, 0, 0, 0]);

      const trResult = html`<table><tr>${html`<td>Cell 1</td><td>Cell 2</td>`}</tr></table>`;
      const trHtml = renderAot(trResult);

      await page.setContent(`<!DOCTYPE html><html><body><foster-table-fixture><template shadowrootmode="open">${trHtml}</template></foster-table-fixture></body></html>`);

      const fosterEval = await page.evaluate(() => {
        const root = document.querySelector('foster-table-fixture')?.shadowRoot;
        if (!root) return { success: false, error: 'No shadowRoot' };

        const table = root.querySelector('table');
        const tbody = table?.querySelector('tbody');
        const tr = tbody?.querySelector('tr');
        if (!tr) return { success: false, error: 'tr not found inside tbody' };

        const tds = tr.querySelectorAll('td');
        if (tds.length !== 2) {
          return { success: false, error: `Expected 2 td elements, got ${tds.length}` };
        }
        if (tds[0].textContent !== 'Cell 1' || tds[1].textContent !== 'Cell 2') {
          return { success: false, error: `Cell text mismatch: ${tds[0].textContent}, ${tds[1].textContent}` };
        }

        return { success: true };
      });

      expect(fosterEval.error).toBeUndefined();
      expect(fosterEval.success).toBe(true);
    });
  });
});
