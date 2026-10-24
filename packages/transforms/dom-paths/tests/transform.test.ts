import { describe, expect, it } from 'vitest';
import { computeDomPaths, transformDomPaths } from '../src/index.js';

describe('dom-paths compiler', () => {
  const compute = computeDomPaths;
  const transform = transformDomPaths;
  it('computes exact paths for the prompt specification example', () => {
    const quasis = ['<div>\n  <h1>Title</h1>\n  <p>Count: ', '</p>\n  <button @click=', '>+</button>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 3, 1], // Part 0: ${this.count} inside <p>
      [0, 5], // Part 1: @click attribute on <button>
    ]);
  });

  it('transforms Lit component class to inject static __litPartPaths and fast update', () => {
    const input = `
import { LitElement, html } from 'lit';
export class CounterComponent extends LitElement {
  static properties = { count: { type: Number } };
  render() {
    return html\`
      <div>
        <p>\${this.count}</p>
      </div>
    \`;
  }
}
`;

    const res = transform(input);
    expect(res.componentsCount).toBe(1);
    expect(res.pathsCount).toBe(1);
    expect(res.paths[0]).toEqual([[1, 1, 0]]);

    expect(res.code).toContain('static __litPartPaths = [');
    expect(res.code.replace(/\s+/g, '')).toContain('[1,1,0]');
    expect(res.code).toContain('update(changedProperties)');
    expect(res.code).not.toContain('this.updated');
    expect(res.code).not.toContain('this.__litDomNodes');
    expect(res.code).toContain('render()');
  });

  it('omits static __litPartPaths when component has unsupported parts', () => {
    const input = `
import { LitElement, html } from 'lit';
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
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
    expect(res.code).not.toContain('static __litPartPaths');
    expect(res.code).toBe(input);
  });

  it('handles deep nested DOM subtrees', () => {
    const quasis = ['<div>\n  <section>\n    <article>\n      <span>', '</span>\n    </article>\n  </section>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([[0, 1, 1, 1, 0]]);
  });

  it('handles SVG subtrees with self-closing and text tags', () => {
    const quasis = ['<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="', '" />\n  <text x="50" y="50">', '</text>\n</svg>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 1], // Attribute on <circle>
      [0, 3, 0], // Child inside <text>
    ]);
  });

  it('handles adjacent child expressions', () => {
    const quasis = ['<div>\n  <span>', '', '</span>\n</div>'];

    const paths = compute(quasis);
    expect(paths).toEqual([
      [0, 1, 0], // First child expression in <span>
      [0, 1, 1], // Second child expression in <span>
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
      [2, 0], // Inside <main>
      [4, 0], // Inside <footer>
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

  it('bails out safely when class has multiple templates with expressions', () => {
    const input = `
export class MultiTemplateComponent extends LitElement {
  renderHeader() {
    return html\`<h1>\${this.title}</h1>\`;
  }
  render() {
    return html\`<main>\${this.content}</main>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
    expect(res.code).toBe(input);
  });

  it('ignores classes inheriting from non-Lit base classes', () => {
    const input = `
export class CustomService extends BaseService {
  render() {
    return html\`<div>\${this.data}</div>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
  });

  it('transforms aliased Lit imports correctly', () => {
    const input = `
import { LitElement as ReactiveComponent, html as template } from 'lit';
export class AliasedComp extends ReactiveComponent {
  static properties = { text: { type: String } };
  render() {
    return template\`<section><span>\${this.text}</span></section>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(1);
    expect(res.pathsCount).toBe(1);
    expect(res.code).toContain('static __litPartPaths');
    expect(res.code).toContain('update(changedProperties)');
  });

  it('composes cleanly with firstUpdated, willUpdate, and updated lifecycle methods', () => {
    const input = `
import { LitElement, html } from 'lit';
export class LifecycleComp extends LitElement {
  static properties = { count: { type: Number } };
  firstUpdated() {}
  willUpdate() {}
  updated(changedProperties) {}
  render() {
    return html\`<div><p>\${this.count}</p></div>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(1);
    expect(res.pathsCount).toBe(1);
    expect(res.code).toContain('static __litPartPaths = [');
    expect(res.code).toContain('update(changedProperties)');
    expect(res.code).not.toContain('this.updated');
  });

  it('ignores html templates from non-Lit packages', () => {
    const input = `
import { html } from 'non-lit-package';
export class NotLit extends Something {
  render() {
    return html\`<section>\${this.text}</section>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
  });

  it('empirically verifies runtime execution: updated() call and zero heap retention leak', () => {
    const input = `
import { LitElement, html } from 'lit';
export class RuntimeComp extends LitElement {
  static properties = { count: { type: Number } };
  firstUpdated() {}
  willUpdate() {}
  updated(changedProperties) {}
  render() {
    return html\`<div><p>\${this.count}</p></div>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(1);
    expect(res.code).toContain('static __litPartPaths');
    expect(res.code).not.toContain('this.__litDomNodes');

    class MockLitElement {
      hasUpdated = false;
      renderRoot: any = null;
      superUpdateCalled = false;
      update(_changedProperties: Map<string, any>) {
        this.superUpdateCalled = true;
        this.hasUpdated = true;
      }
    }

    const runnableCode = res.code
      .replace(/import\s*\{[^}]*\}\s*from\s*['"]lit['"];?/, '')
      .replace(/export\s+class/, 'class')
      .replace('extends LitElement', 'extends MockBase');

    const fn = new Function('MockBase', `${runnableCode}; return RuntimeComp;`);
    const TransformedClass = fn(MockLitElement);

    const instance = new TransformedClass();
    const updatedCalls: any[] = [];
    instance.updated = (changedProps: any) => {
      updatedCalls.push(changedProps);
    };

    // First update: hasUpdated is false -> calls super.update()
    const initialProps = new Map([['count', 0]]);
    instance.update(initialProps);
    expect(instance.superUpdateCalled).toBe(true);
    expect(instance.hasUpdated).toBe(true);

    // Mock DOM tree matching path [0, 0, 0]:
    // renderRoot.childNodes[0] = <div>
    //   div.childNodes[0] = <p>
    //     p.childNodes[0] = textNode
    const textNode = { nodeType: 3, data: '0' };
    const pNode = { nodeType: 1, firstChild: textNode, childNodes: [textNode] };
    const divNode = { nodeType: 1, firstChild: pNode, childNodes: [pNode] };
    instance.renderRoot = {
      firstChild: divNode,
      childNodes: [divNode],
    };

    // Second update: hasUpdated is true
    instance.count = 42;
    const updateProps = new Map([['count', 0]]);
    instance.update(updateProps);

    // 1. Text node updated directly via DOM CharacterData .data
    expect(textNode.data).toBe('42');

    // 2. this.updated(changedProperties) is invoked by Lit's performUpdate()
    // inside _$AE(changedProperties) after update() returns. Verify update() does not invoke this.updated() directly.
    expect(updatedCalls.length).toBe(0);

    // 3. No this.__litDomNodes on instance (zero heap leak)
    expect((instance as any).__litDomNodes).toBeUndefined();
  });

  it('bails out cleanly when component property specifies reflect: true', () => {
    const input = `
import { LitElement, html } from 'lit';
export class ReflectedComp extends LitElement {
  static properties = {
    active: { type: Boolean, reflect: true },
    count: { type: Number },
  };
  render() {
    return html\`<div><p>\${this.count}</p></div>\`;
  }
}
`;
    const res = transform(input);
    expect(res.componentsCount).toBe(0);
    expect(res.pathsCount).toBe(0);
    expect(res.code).toBe(input);
  });
});
