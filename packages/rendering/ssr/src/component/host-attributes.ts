import { escapeAttribute } from '../compiler-bridge.js';
import { HTMLElementStub } from '../environment.js';
import { isValidAttrName } from '../validation.js';

export function readLiveHostAttributesMap(instance: any): Map<string, string> {
  const map = new Map<string, string>();
  if (instance instanceof HTMLElementStub) {
    const raw = instance._getRawAttributesMap();
    if (!raw || raw.size === 0) {
      return map;
    }
    for (const [name, val] of raw) {
      if (isValidAttrName(name)) {
        map.set(name, val);
      }
    }
    return map;
  }
  if (typeof instance?.getAttributeNames === 'function' && typeof instance?.getAttribute === 'function') {
    for (const name of instance.getAttributeNames()) {
      if (!isValidAttrName(name)) continue;
      const val = instance.getAttribute(name);
      if (val !== null) {
        map.set(name, val);
      }
    }
  } else if (instance?.attributes && typeof instance.attributes[Symbol.iterator] === 'function') {
    for (const attr of instance.attributes) {
      if (attr && typeof attr.name === 'string' && isValidAttrName(attr.name)) {
        map.set(attr.name, String(attr.value ?? ''));
      }
    }
  }
  return map;
}

export function serializeHostAttributeString(
  instance: any,
  options: {
    eventAttrs?: readonly string[];
    adoptKeys?: readonly string[];
    adoptedUrls?: readonly string[];
    hostId?: number;
    stateJson?: string;
    domPaths?: boolean;
    deferHydration?: boolean;
  } = {},
): string {
  if (
    instance instanceof HTMLElementStub &&
    !options.domPaths &&
    (!options.adoptKeys || options.adoptKeys.length === 0) &&
    (!options.adoptedUrls || options.adoptedUrls.length === 0) &&
    options.hostId === undefined &&
    !options.stateJson &&
    (!options.eventAttrs || options.eventAttrs.length === 0)
  ) {
    const raw = instance._getRawAttributesMap();
    if (!raw || raw.size === 0) {
      return options.deferHydration ? ' defer-hydration' : '';
    }
    let out = '';
    let hasDefer = false;
    for (const [k, v] of raw) {
      if (!isValidAttrName(k)) continue;
      if (k === 'defer-hydration') hasDefer = true;
      out += v === '' ? ` ${k}` : ` ${k}="${escapeAttribute(v)}"`;
    }
    if (options.deferHydration && !hasDefer) {
      out += ' defer-hydration';
    }
    return out;
  }
  const attrs = readLiveHostAttributesMap(instance);
  if (options.domPaths && !attrs.has('data-lit-paths')) {
    attrs.set('data-lit-paths', 'true');
  }
  if (options.adoptKeys && options.adoptKeys.length > 0) {
    attrs.set('data-lit-adopt', options.adoptKeys.join(' '));
  }
  if (options.adoptedUrls && options.adoptedUrls.length > 0) {
    attrs.set('data-lit-adopted-urls', options.adoptedUrls.join(' '));
  }
  if (options.hostId !== undefined) {
    attrs.set('data-lit-ssr', String(options.hostId));
  }
  if (options.stateJson && !attrs.has('data-lit-state')) {
    attrs.set('data-lit-state', options.stateJson);
  }
  if (options.deferHydration && !attrs.has('defer-hydration')) {
    attrs.set('defer-hydration', '');
  }

  const eventAttrs = options.eventAttrs;
  if (attrs.size === 0 && (!eventAttrs || eventAttrs.length === 0)) {
    return '';
  }

  let out = '';
  for (const [k, v] of attrs.entries()) {
    out += v === '' ? ` ${k}` : ` ${k}="${escapeAttribute(v)}"`;
  }
  if (eventAttrs && eventAttrs.length > 0) {
    for (let i = 0; i < eventAttrs.length; i++) {
      const evAttr = eventAttrs[i];
      if (!attrs.has(evAttr)) {
        out += ` ${evAttr}`;
      }
    }
  }
  return out;
}
