import { escapeAttribute, isNothing, resolveDirectiveValue, type SsrDynamicAttribute } from './compiler-bridge.js';
import { reflectedAttributeName } from './reflected-attributes.js';

export function renderDynamicAttrsToString(dynamicAttrs: readonly SsrDynamicAttribute[], tagUpper: string, values: unknown[], resumable: boolean): string {
  let renderedAttrs = '';
  for (let dIdx = 0; dIdx < dynamicAttrs.length; dIdx++) {
    const dyn = dynamicAttrs[dIdx];
    if (dyn.type === 'attribute') {
      const attrName = dyn.name;
      if (dyn.indices && dyn.strings) {
        let formatted = dyn.strings[0] ?? '';
        for (let j = 0; j < dyn.indices.length; j++) {
          const idx = dyn.indices[j];
          const rawVal = idx < values.length ? values[idx] : undefined;
          const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: attrName, strings: dyn.strings });
          formatted += !isNothing(resolved) && resolved !== null && resolved !== undefined ? String(resolved) : '';
          formatted += dyn.strings[j + 1] ?? '';
        }
        renderedAttrs += ` ${attrName}="${escapeAttribute(formatted)}"`;
      } else {
        const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 1, tagName: tagUpper, name: attrName, strings: dyn.strings });
        if (!isNothing(resolved) && resolved !== null && resolved !== undefined) {
          const formatted = dyn.strings && dyn.strings.length > 1 ? dyn.strings[0] + String(resolved) + dyn.strings.slice(1).join('') : String(resolved);
          renderedAttrs += ` ${attrName}="${escapeAttribute(formatted)}"`;
        }
      }
    } else if (dyn.type === 'property') {
      const reflectedName = reflectedAttributeName(tagUpper, dyn.name);
      if (dyn.indices && dyn.strings) {
        let formatted = dyn.strings[0] ?? '';
        let omitted = false;
        for (let j = 0; j < dyn.indices.length; j++) {
          const idx = dyn.indices[j];
          const rawVal = idx < values.length ? values[idx] : undefined;
          const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
          if (isNothing(resolved)) {
            omitted = true;
          } else if (resolved !== null && resolved !== undefined) {
            formatted += String(resolved);
          }
          formatted += dyn.strings[j + 1] ?? '';
        }
        if (reflectedName !== undefined && !omitted) {
          renderedAttrs += ` ${reflectedName}="${escapeAttribute(formatted)}"`;
        }
      } else {
        const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
        const resolved = resolveDirectiveValue(rawVal, { type: 3, tagName: tagUpper, name: dyn.name, strings: dyn.strings });
        if (reflectedName !== undefined && !isNothing(resolved)) {
          const formatted =
            dyn.strings && dyn.strings.length > 1
              ? dyn.strings[0] + (resolved !== null && resolved !== undefined ? String(resolved) : '') + dyn.strings.slice(1).join('')
              : typeof resolved === 'string'
                ? resolved
                : String(resolved);
          renderedAttrs += ` ${reflectedName}="${escapeAttribute(formatted)}"`;
        }
      }
    } else if (dyn.type === 'boolean') {
      const rawVal = dyn.index < values.length ? values[dyn.index] : undefined;
      const resolved = resolveDirectiveValue(rawVal, { type: 4, tagName: tagUpper, name: dyn.name });
      if (resolved && !isNothing(resolved)) {
        renderedAttrs += ` ${dyn.name}`;
      }
    } else if (dyn.type === 'event') {
      if (resumable) {
        renderedAttrs += ` resumes-on-${dyn.name}`;
      }
    }
    // ElementPart (`dyn.type === 'directive'`) only executes `update()` on live client DOM elements.
  }
  return renderedAttrs;
}
