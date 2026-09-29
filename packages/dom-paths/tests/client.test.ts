import { describe, expect, it } from 'vitest';
import { preparePartsWithPaths, resolveNodeByPath, resolveNodesByPaths } from '../src/client.js';

interface MockDOMNode {
  nodeName: string;
  nodeType: number;
  childNodes: MockDOMNode[];
  data?: string;
}

function createElement(name: string, children: MockDOMNode[] = []): MockDOMNode {
  return {
    nodeName: name.toUpperCase(),
    nodeType: 1,
    childNodes: children,
  };
}

function createTextNode(text: string): MockDOMNode {
  return {
    nodeName: '#text',
    nodeType: 3,
    childNodes: [],
    data: text,
  };
}

function createCommentNode(text: string): MockDOMNode {
  return {
    nodeName: '#comment',
    nodeType: 8,
    childNodes: [],
    data: text,
  };
}

function createFragment(children: MockDOMNode[] = []): MockDOMNode {
  return {
    nodeName: '#document-fragment',
    nodeType: 11,
    childNodes: children,
  };
}

describe('dom-paths client runtime resolver', () => {
  it('resolves nodes matching the prompt specification example', () => {
    // Structure:
    // root (fragment)
    //  childNodes[0] = <div>
    //    childNodes[0] = <h1>Title</h1>
    //    childNodes[1] = <p>
    //      childNodes[0] = text node "Count: "
    //      childNodes[1] = comment node <!--?lit$1234$--> (${this.count})
    //    childNodes[2] = <button>
    const countPartMarker = createCommentNode('?lit$1234$');
    const buttonNode = createElement('button', [createTextNode('+')]);

    const root = createFragment([createElement('div', [createElement('h1', [createTextNode('Title')]), createElement('p', [createTextNode('Count: '), countPartMarker]), buttonNode])]);

    // Path for Part 0: [0, 1, 1]
    const resolvedCountPart = resolveNodeByPath(root as unknown as Node, [0, 1, 1]);
    expect(resolvedCountPart).toBe(countPartMarker);

    // Path for Part 1: [0, 2] (button attribute)
    const resolvedButton = resolveNodeByPath(root as unknown as Node, [0, 2]);
    expect(resolvedButton).toBe(buttonNode);
  });

  it('resolves deep paths', () => {
    const deepTarget = createElement('span', [createTextNode('Deep target')]);

    const root = createFragment([createElement('div', [createElement('section', [createElement('article', [deepTarget])])])]);

    const resolved = resolveNodeByPath(root as unknown as Node, [0, 0, 0, 0]);
    expect(resolved).toBe(deepTarget);
  });

  it('resolves multiple nodes via resolveNodesByPaths', () => {
    const part0 = createCommentNode('part0');
    const part1 = createElement('button');

    const root = createFragment([createElement('div', [createElement('span', [part0]), part1])]);

    const resolved = resolveNodesByPaths(root as unknown as Node, [
      [0, 0, 0],
      [0, 1],
    ]);

    expect(resolved).toEqual([part0, part1]);
  });

  it('prepares parts directly via preparePartsWithPaths', () => {
    const nodeA = createCommentNode('a');
    const nodeB = createCommentNode('b');

    const root = createFragment([createElement('main', [nodeA, nodeB])]);

    const parts = preparePartsWithPaths(
      root as unknown as Node,
      [
        [0, 0],
        [0, 1],
      ],
      (node, index) => ({ id: index, target: node }),
    );

    expect(parts).toEqual([
      { id: 0, target: nodeA },
      { id: 1, target: nodeB },
    ]);
  });

  it('runs path resolution in sub-millisecond nanosecond scale', () => {
    const target = createCommentNode('perf-test');
    const root = createFragment([createElement('div', [createElement('p', [target])])]);

    const iterations = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      resolveNodeByPath(root as unknown as Node, [0, 0, 0]);
    }
    const t1 = performance.now();
    const duration = t1 - t0;

    // 10,000 pointer lookups should easily finish in under 50ms in Node.js
    expect(duration).toBeLessThan(50);
  });
});
