import { isCompiledTemplateResult, isStandardTemplateResult, type RenderOptions, renderToString } from '@lit-core/ssr';
import { canonicalizeJson } from '../crypto.js';
import type { KeyedItem, KeyedOp, KeyedPartState } from '../types.js';
import { hash64 } from './hash.js';

type ItemKey = string | number;

interface KeyedEntry {
  key: ItemKey;
  html?: string;
  text?: string;
  fingerprint: string;
}

interface RepeatDirectiveLike {
  _$litDirective$: unknown;
  values: unknown[];
}

export interface KeyedDiff {
  ops: KeyedOp[];
  state: KeyedPartState;
}

const KEY_PROPERTIES = ['key', 'data-lit-key', '__litKey', 'id'] as const;

export function isTemplateValue(value: unknown): boolean {
  return isCompiledTemplateResult(value) || isStandardTemplateResult(value);
}

/** True for the `repeat(items, keyFn?, template)` directive result. */
export function isRepeatDirective(value: unknown): value is RepeatDirectiveLike {
  return Boolean(value && typeof value === 'object' && '_$litDirective$' in value && Array.isArray((value as RepeatDirectiveLike).values) && (value as RepeatDirectiveLike).values.length >= 2);
}

function hasKeyProperty(item: unknown): item is Record<string, ItemKey> {
  return item !== null && typeof item === 'object' && KEY_PROPERTIES.some((prop) => prop in item);
}

function readItemKey(item: unknown): ItemKey | undefined {
  if (!hasKeyProperty(item)) {
    return undefined;
  }
  const prop = KEY_PROPERTIES.find((p) => p in item);
  return prop === undefined ? undefined : item[prop];
}

/** True for a non-empty array whose items all carry an explicit key field. */
export function isKeyedList(value: readonly unknown[]): boolean {
  return value.length > 0 && value.every(hasKeyProperty);
}

function toKeyedItem(entry: KeyedEntry): KeyedItem {
  return entry.html !== undefined ? { key: entry.key, html: entry.html } : { key: entry.key, text: entry.text ?? '' };
}

function entryFromValue(key: ItemKey, value: unknown, renderOptions: RenderOptions, stringify: (v: unknown) => string): KeyedEntry {
  if (isTemplateValue(value)) {
    const html = renderToString(value, renderOptions);
    return { key, html, fingerprint: hash64(['h', html]) };
  }
  const text = stringify(value);
  return { key, text, fingerprint: hash64(['t', text]) };
}

function collectEntries(value: unknown, renderOptions: RenderOptions): KeyedEntry[] {
  if (isRepeatDirective(value)) {
    const [itemsRaw, keyFnOrTemplate, maybeTemplate] = value.values as [Iterable<unknown> | null | undefined, unknown, unknown];
    const hasKeyFn = typeof maybeTemplate === 'function';
    const keyFn = (hasKeyFn ? keyFnOrTemplate : (_: unknown, index: number) => index) as (item: unknown, index: number) => ItemKey;
    const template = (hasKeyFn ? maybeTemplate : keyFnOrTemplate) as (item: unknown, index: number) => unknown;
    return Array.from(itemsRaw ?? []).map((item, index) => entryFromValue(keyFn(item, index), template(item, index), renderOptions, (v) => (v === null || v === undefined ? '' : String(v))));
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      entryFromValue(readItemKey(item) ?? index, item, renderOptions, (v) => {
        if (v === null || v === undefined) return '';
        return typeof v === 'object' ? canonicalizeJson(v) : String(v);
      }),
    );
  }
  return [];
}

/**
 * Diffs the current value of a keyed list part against the keys and item fingerprints the
 * client last acknowledged, producing the minimal `remove` / `insert` / `update` / `reorder` ops.
 */
export function diffKeyedItems(value: unknown, previous: KeyedPartState | undefined, renderOptions: RenderOptions): KeyedDiff {
  const entries = collectEntries(value, renderOptions);
  const keys = entries.map((entry) => entry.key);
  const fingerprints: Record<ItemKey, string> = {};
  for (const entry of entries) {
    fingerprints[entry.key] = entry.fingerprint;
  }

  // Server-rendered markup carries no key markers, so until the client has acknowledged a key set
  // for this part the only sound patch is to re-render the whole range. Incremental ops resume afterwards.
  if (previous === undefined) {
    return { ops: [{ op: 'replace', items: entries.map(toKeyedItem) }], state: { keys, fingerprints } };
  }

  const previousKeys = previous.keys;
  const previousFingerprints = previous.fingerprints;

  const previousKeySet = new Set(previousKeys);
  const currentKeySet = new Set(keys);
  const ops: KeyedOp[] = [];

  for (const key of previousKeys) {
    if (!currentKeySet.has(key)) {
      ops.push({ op: 'remove', key });
    }
  }

  entries.forEach((entry, index) => {
    if (!previousKeySet.has(entry.key)) {
      ops.push({ op: 'insert', index, ...toKeyedItem(entry) });
    } else if (previousFingerprints[entry.key] !== undefined && previousFingerprints[entry.key] !== entry.fingerprint) {
      ops.push({ op: 'update', ...toKeyedItem(entry) });
    }
  });

  const orderChanged = previousKeys.length !== keys.length || previousKeys.some((key, index) => key !== keys[index]);
  if (orderChanged || previousKeys.length === 0) {
    ops.push({ op: 'reorder', order: keys });
  }

  return { ops, state: { keys, fingerprints } };
}
