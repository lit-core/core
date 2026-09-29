import { describe, expect, it } from 'vitest';
import { transformMemoize } from '../src/index.js';

describe('memoize transform', () => {
  const fn = transformMemoize;
  it('memoizes single-input array mapping', () => {
    const input = `
export class UserList extends LitElement {
  render() {
    return html\`
      <ul>
        \${this.items.map(x => html\`<li>\${x}</li>\`)}
      </ul>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(1);
    expect(res.componentsCount).toBe(1);

    expect(res.code).toContain('let _memoized_items;');
    expect(res.code).toContain('if (this.__memo_items_ref === this.items)');
    expect(res.code).toContain('_memoized_items = this.__memo_items_val;');
    expect(res.code).toMatch(/_memoized_items = this\.__memo_items_val = this\.items\.map\(\(?x\)? => html`<li>\$\{x\}<\/li>`\);/);
    expect(res.code).toContain('${_memoized_items}');
  });

  it('memoizes multi-input array mapping with filterText dependency', () => {
    const input = `
export class FilteredList extends LitElement {
  render() {
    return html\`
      <ul>
        \${this.items.filter(x => x.includes(this.filterText)).map(x => html\`<li>\${x}</li>\`)}
      </ul>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(1);
    expect(res.componentsCount).toBe(1);

    expect(res.code).toContain('let _memoized_items;');
    expect(res.code).toContain('this.__memo_items_ref === this.items');
    expect(res.code).toContain('this.__memo_filterText_ref === this.filterText');
    expect(res.code).toContain('_memoized_items = this.__memo_items_val;');
    expect(res.code).toContain('this.__memo_items_ref = this.items;');
    expect(res.code).toContain('this.__memo_filterText_ref = this.filterText;');
    expect(res.code).toContain('${_memoized_items}');
  });

  it('memoizes chained array operations as a single pipeline', () => {
    const input = `
export class SortedTable extends LitElement {
  render() {
    return html\`
      <table>
        \${this.items.filter(x => x.active).sort((a, b) => a.order - b.order).map(x => html\`<tr><td>\${x.name}</td></tr>\`)}
      </table>
    \`;
  }
}
`;
    const res = fn(input);
    // Entire pipeline should be memoized once, not 3 separate times
    expect(res.memoizedCount).toBe(1);
    expect(res.componentsCount).toBe(1);
    expect(res.code).toContain('let _memoized_items;');
    expect(res.code).toContain('this.__memo_items_ref === this.items');
    expect(res.code).toMatch(
      /_memoized_items = this\.__memo_items_val = this\.items\.filter\(\(?x\)? => x\.active\)\.sort\(\(a, b\) => a\.order - b\.order\)\.map\(\(?x\)? => html`<tr><td>\$\{x\.name\}<\/td><\/tr>`\);/,
    );
  });

  it('memoizes variable declarations inside render()', () => {
    const input = `
export class TableView extends LitElement {
  render() {
    const rows = this.items.filter(x => x.active).map(x => html\`<tr><td>\${x.name}</td></tr>\`);
    return html\`<table>\${rows}</table>\`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(1);
    expect(res.componentsCount).toBe(1);
    expect(res.code).toContain('let rows;');
    expect(res.code).toContain('if (this.__memo_items_ref === this.items)');
    expect(res.code).toContain('rows = this.__memo_items_val;');
    expect(res.code).toContain('this.__memo_items_ref = this.items;');
    expect(res.code).toMatch(/rows = this\.__memo_items_val = this\.items\.filter\(\(?x\)? => x\.active\)\.map\(\(?x\)? => html`<tr><td>\$\{x\.name\}<\/td><\/tr>`\);/);
    expect(res.code).toContain('return html`<table>${rows}</table>`;');
  });

  it('memoizes multiple independent expressions in the same template without collision', () => {
    const input = `
export class DashboardView extends LitElement {
  render() {
    return html\`
      <div>
        <div class="users">\${this.users.map(u => html\`<span>\${u}</span>\`)}</div>
        <div class="tasks">\${this.tasks.map(t => html\`<span>\${t}</span>\`)}</div>
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(2);
    expect(res.componentsCount).toBe(1);

    expect(res.code).toContain('let _memoized_users;');
    expect(res.code).toContain('this.__memo_users_ref === this.users');
    expect(res.code).toContain('_memoized_users = this.__memo_users_val;');

    expect(res.code).toContain('let _memoized_tasks;');
    expect(res.code).toContain('this.__memo_tasks_ref === this.tasks');
    expect(res.code).toContain('_memoized_tasks = this.__memo_tasks_val;');

    expect(res.code).toContain('${_memoized_users}');
    expect(res.code).toContain('${_memoized_tasks}');
  });

  it('memoizes .slice(), .reduce(), and .flatMap() array transformations', () => {
    const input = `
export class AdvancedList extends LitElement {
  render() {
    return html\`
      <div>
        \${this.items.slice(0, 5).map(x => html\`<li>\${x}</li>\`)}
        \${this.tags.flatMap(t => t.subtags)}
        \${this.numbers.reduce((acc, n) => acc + n, 0)}
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(3);
    expect(res.componentsCount).toBe(1);
    expect(res.code).toContain('let _memoized_items;');
    expect(res.code).toContain('let _memoized_tags;');
    expect(res.code).toContain('let _memoized_numbers;');
    expect(res.code).toContain('this.__memo_items_ref === this.items');
    expect(res.code).toContain('this.__memo_tags_ref === this.tags');
    expect(res.code).toContain('this.__memo_numbers_ref === this.numbers');
  });

  it('does not memoize expressions calling mutating array methods', () => {
    const input = `
export class ImpureComponent extends LitElement {
  render() {
    return html\`
      <div>
        \${this.items.map(x => { this.items.push(x); return html\`<span>\${x}</span>\`; })}
        \${this.items.filter(x => { x.splice(0, 1); return true; })}
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(0);
    expect(res.code).not.toContain('__memo_');
  });

  it('does not memoize expressions calling Date.now(), Math.random(), or DOM queries', () => {
    const input = `
export class NonDeterministicComponent extends LitElement {
  render() {
    return html\`
      <div>
        \${this.items.map(x => html\`<span>\${x} - \${Date.now()}</span>\`)}
        \${this.items.map(x => html\`<span>\${x} - \${Math.random()}</span>\`)}
        \${this.items.map(x => html\`<span>\${document.querySelector('#' + x)}</span>\`)}
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(0);
    expect(res.code).not.toContain('__memo_');
  });

  it('does not memoize expressions with method calls on this', () => {
    const input = `
export class CustomMethodComponent extends LitElement {
  render() {
    return html\`
      <div>
        \${this.items.map(x => this.renderCustomItem(x))}
      </div>
    \`;
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(0);
    expect(res.code).not.toContain('__memo_');
  });

  it('ignores non-render methods and classes without render()', () => {
    const input = `
export class DataService {
  compute() {
    return this.items.map(x => x * 2);
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(0);
    expect(res.componentsCount).toBe(0);
    expect(res.code).toBe(input);
  });

  it('verifies runtime reference caching and reactive cache invalidation', () => {
    const input = `
class TestComponent {
  constructor() {
    this.items = ['apple', 'banana', 'cherry'];
    this.filterText = 'a';
    this.open = false;
  }

  render() {
    return this.items
      .filter(x => x.includes(this.filterText))
      .map(x => ({ text: x }));
  }
}
`;
    const res = fn(input);
    expect(res.memoizedCount).toBe(1);

    // Execute transformed class code in sandbox
    const factory = new Function(`${res.code}; return TestComponent;`);
    const ComponentClass = factory();
    const instance = new ComponentClass();

    // Initial render: computes and caches
    const render1 = instance.render();
    expect(render1).toEqual([{ text: 'apple' }, { text: 'banana' }]);

    // Re-render with unrelated state change (this.open = true)
    instance.open = true;
    const render2 = instance.render();

    // Must return the exact same array reference (Object.is skip!)
    expect(render2).toBe(render1);

    // Re-render with filterText change
    instance.filterText = 'b';
    const render3 = instance.render();

    // Cache invalidated: new reference returned with filtered results
    expect(render3).not.toBe(render1);
    expect(render3).toEqual([{ text: 'banana' }]);

    // Re-render again without changes: returned reference stays stable
    const render4 = instance.render();
    expect(render4).toBe(render3);

    // Re-render with items reference change
    instance.items = ['avocado', 'blueberry'];
    const render5 = instance.render();
    expect(render5).not.toBe(render4);
    expect(render5).toEqual([{ text: 'blueberry' }]);
  });
});
