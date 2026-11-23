import { escapeAttribute, type SsrOpcode } from './compiler-bridge.js';

export function hasExistingDeclarativeShadowRoot(opcodes: SsrOpcode[], start: number, end: number): boolean {
  for (let idx = start; idx < end; idx++) {
    const child = opcodes[idx];
    if (child.type === 'text' && child.value.trim().length === 0) continue;
    if (child.type === 'comment') continue;
    if (child.type === 'open') {
      return Boolean(child.tag === 'template' && child.staticAttrs && (Object.hasOwn(child.staticAttrs, 'shadowrootmode') || Object.hasOwn(child.staticAttrs, 'shadowroot')));
    }
    return false;
  }
  return false;
}

export function renderStaticAttrsToString(staticAttrs?: Record<string, string>): string {
  if (!staticAttrs) return '';
  let out = '';
  for (const [k, v] of Object.entries(staticAttrs)) {
    out += ` ${k}="${escapeAttribute(v)}"`;
  }
  return out;
}
