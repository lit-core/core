import { describe, expect, it } from 'vitest';
import { computeDomPaths, transformDomPaths } from '../src/index.js';

describe('dom-paths compiler', () => {
  const compute = computeDomPaths;
  const transform = transformDomPaths;
  it('computes exact paths for the prompt specification example', () => {
    const quasis = ['<div>\n  <h1>Title</h1>\n  <p>Count: ', '</p>\n  <button @click=', '>+</button>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 1, 1], // Part 0: ${this.count} inside <p>
      [0, 2], // Part 1: @click attribute on <button>
    ]);
  });

  it('transforms Lit component class to inject static __litPartPaths', () => {
    const input = `
export class CounterComponent extends LitElement {
  render() {
    return html\`
      <div>
        <h1>Title</h1>
        <p>Count: \${this.count}</p>
        <button @click=\${this.inc}>+</button>
      </div>
    \`;
  }
}
`;

    const res = transform(input);
    expect(res.componentsCount).toBe(1);
    expect(res.pathsCount).toBe(2);
    expect(res.paths[0]).toEqual([
      [0, 1, 1],
      [0, 2],
    ]);

    expect(res.code).toContain('static __litPartPaths = [');
    expect(res.code.replace(/\s+/g, '')).toContain('[0,1,1]');
    expect(res.code.replace(/\s+/g, '')).toContain('[0,2]');
    expect(res.code).toContain('render()');
  });

  it('handles deep nested DOM subtrees', () => {
    const quasis = ['<div>\n  <section>\n    <article>\n      <span>', '</span>\n    </article>\n  </section>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([[0, 0, 0, 0, 0]]);
  });

  it('handles SVG subtrees with self-closing and text tags', () => {
    const quasis = ['<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="', '" />\n  <text x="50" y="50">', '</text>\n</svg>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 0], // Attribute on <circle>
      [0, 1, 0], // Child inside <text>
    ]);
  });

  it('handles adjacent child expressions', () => {
    const quasis = ['<div>\n  <span>', '', '</span>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 0, 0], // First child expression in <span>
      [0, 0, 1], // Second child expression in <span>
    ]);
  });

  it('handles multiple attribute expressions on the same element', () => {
    const quasis = ['<button @click=', ' ?disabled=', ' title=', '>Submit</button>'];

    const paths = compute(quasis);
    expect(paths).toEqual([[0], [0], [0]]);
  });

  it('handles multiple top-level root elements', () => {
    const quasis = ['<header>', '</header>\n<main>', '</main>\n<footer>', '</footer>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 0], // Inside <header>
      [1, 0], // Inside <main>
      [2, 0], // Inside <footer>
    ]);
  });

  it('ignores classes without html templates', () => {
    const input = `
export class HelperUtil {
  format(val) {
    return val.trim();
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
    expect(res.code).toBe(input);
  });
});
