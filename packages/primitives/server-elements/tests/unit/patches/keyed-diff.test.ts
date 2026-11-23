import { describe, expect, it } from 'vitest';
import { diffKeyedItems, isKeyedList } from '../../../src/patches/keyed-diff.js';

const options = { mode: 'dsd', resumable: false } as const;
const row = (id: string, label: string) => ({ id, label });

describe('isKeyedList', () => {
  it('requires every item to carry a key field', () => {
    expect(isKeyedList([{ id: 1 }, { key: 'a' }])).toBe(true);
    expect(isKeyedList([{ id: 1 }, { label: 'x' }])).toBe(false);
    expect(isKeyedList([])).toBe(false);
    expect(isKeyedList(['a', 'b'])).toBe(false);
  });
});

describe('diffKeyedItems', () => {
  it('re-renders the whole range when the client has acknowledged no key state', () => {
    const { ops, state } = diffKeyedItems([row('a', 'A'), row('b', 'B')], undefined, options);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'replace' });
    expect(state.keys).toEqual(['a', 'b']);
  });

  it('emits inserts followed by a reorder when growing from an acknowledged empty list', () => {
    const { ops } = diffKeyedItems([row('a', 'A'), row('b', 'B')], { keys: [], fingerprints: {} }, options);
    expect(ops.map((o) => o.op)).toEqual(['insert', 'insert', 'reorder']);
  });

  it('emits nothing when keys, order and content are unchanged', () => {
    const first = diffKeyedItems([row('a', 'A'), row('b', 'B')], undefined, options);
    const second = diffKeyedItems([row('a', 'A'), row('b', 'B')], first.state, options);
    expect(second.ops).toEqual([]);
  });

  it('emits remove, insert and update for membership and content changes', () => {
    const first = diffKeyedItems([row('a', 'A'), row('b', 'B'), row('c', 'C')], undefined, options);
    const { ops } = diffKeyedItems([row('a', 'A2'), row('c', 'C'), row('d', 'D')], first.state, options);
    expect(ops).toContainEqual({ op: 'remove', key: 'b' });
    expect(ops).toContainEqual(expect.objectContaining({ op: 'insert', key: 'd' }));
    expect(ops).toContainEqual(expect.objectContaining({ op: 'update', key: 'a' }));
    expect(ops).not.toContainEqual(expect.objectContaining({ key: 'c', op: 'update' }));
    expect(ops.at(-1)).toEqual({ op: 'reorder', order: ['a', 'c', 'd'] });
  });

  it('emits only a reorder when items move', () => {
    const first = diffKeyedItems([row('a', 'A'), row('b', 'B')], undefined, options);
    const { ops } = diffKeyedItems([row('b', 'B'), row('a', 'A')], first.state, options);
    expect(ops).toEqual([{ op: 'reorder', order: ['b', 'a'] }]);
  });

  it('detects single-character edits across many items', () => {
    const items = Array.from({ length: 2000 }, (_, i) => row(`k${i}`, `label ${i}`));
    const first = diffKeyedItems(items, undefined, options);
    const edited = items.map((item, i) => (i % 2 === 0 ? { ...item, label: `${item.label}!` } : item));
    const { ops } = diffKeyedItems(edited, first.state, options);
    expect(ops.filter((o) => o.op === 'update')).toHaveLength(1000);
  });
});
