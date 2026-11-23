import { isNothing, resolveDirectiveValue, type SsrOpcode } from '../compiler-bridge.js';
import { defineElementProperty, isElementInstance } from '../element-utils.js';
import { HTMLElementStub } from '../environment.js';
import { findMatchingCloseTag } from '../slot.js';

export function buildLightDomStubsFromOpcodes(opcodes: SsrOpcode[], values: unknown[], start: number, end: number): { children: HTMLElementStub[]; childNodes: any[] } {
  const children: HTMLElementStub[] = [];
  const childNodes: any[] = [];
  let idx = start;

  while (idx < end) {
    const op = opcodes[idx];
    if (op.type === 'open') {
      const childEl = new HTMLElementStub(op.tag);
      if (op.staticAttrs) {
        for (const [k, v] of Object.entries(op.staticAttrs)) {
          childEl.setAttribute(k, v);
        }
      }
      if (op.dynamicAttrs) {
        for (const dyn of op.dynamicAttrs) {
          if (dyn.type === 'attribute') {
            if (dyn.indices && dyn.strings) {
              let formatted = dyn.strings[0] ?? '';
              for (let j = 0; j < dyn.indices.length; j++) {
                const vIdx = dyn.indices[j];
                const rawVal = vIdx < values.length ? values[vIdx] : undefined;
                const resolved = resolveDirectiveValue(rawVal, { type: 1, name: dyn.name, strings: dyn.strings });
                formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
                formatted += dyn.strings[j + 1] ?? '';
              }
              childEl.setAttribute(dyn.name, formatted);
            } else {
              const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
              const resolved = resolveDirectiveValue(rawVal, { type: 1, name: dyn.name, strings: dyn.strings });
              if (!isNothing(resolved) && resolved !== null && resolved !== undefined) {
                const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
                childEl.setAttribute(dyn.name, formatted);
              }
            }
          } else if (dyn.type === 'boolean') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 4, name: dyn.name });
            if (resolved && !isNothing(resolved)) {
              childEl.setAttribute(dyn.name, '');
            }
          } else if (dyn.type === 'property') {
            const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
            const resolved = resolveDirectiveValue(rawVal, { type: 3, name: dyn.name });
            defineElementProperty(childEl, dyn.name, resolved);
          }
        }
      }

      const closeIdx = findMatchingCloseTag(opcodes, idx, end);
      if (!op.isVoid && !op.isSelfClosing && closeIdx > idx) {
        if (closeIdx > idx + 1) {
          const nested = buildLightDomStubsFromOpcodes(opcodes, values, idx + 1, closeIdx);
          childEl._ssrLightChildren = nested.children;
          childEl._ssrLightChildNodes = nested.childNodes;
        }
        idx = closeIdx + 1;
      } else {
        idx++;
      }

      children.push(childEl);
      childNodes.push(childEl);
    } else if (op.type === 'text') {
      if (op.value.length > 0) {
        childNodes.push({ nodeType: 3, data: op.value, textContent: op.value });
      }
      idx++;
    } else if (op.type === 'part') {
      const rawVal = op.index < values.length ? values[op.index] : undefined;
      const resolved = resolveDirectiveValue(rawVal, { type: 2 });
      if (isElementInstance(resolved)) {
        children.push(resolved);
        childNodes.push(resolved);
      } else if (resolved !== null && resolved !== undefined && !isNothing(resolved) && typeof resolved !== 'object') {
        const text = String(resolved);
        if (text.length > 0) {
          childNodes.push({ nodeType: 3, data: text, textContent: text });
        }
      }
      idx++;
    } else {
      idx++;
    }
  }

  return { children, childNodes };
}
