import type { ClientPartDescriptor } from './descriptors.js';
import { clearBetween, documentOf, TEXT_NODE } from './dom.js';
import { resolveNodeByPath, resolveRangeMarkers } from './markers.js';

function asText(value: unknown): string {
  return value == null ? '' : String(value);
}

function isFocused(root: Node, el: Element): boolean {
  return (root as ShadowRoot).activeElement === el || (typeof document !== 'undefined' && document.activeElement === el);
}

/** Assigns a DOM property, keeping the caret and selection of a focused text control where they were. */
function assignProperty(root: Node, el: HTMLElement, prop: string, value: unknown): void {
  const input = el as HTMLInputElement;
  const focused = isFocused(root, el) && 'selectionStart' in el;
  const start = focused ? input.selectionStart : null;
  const end = focused ? input.selectionEnd : null;

  (el as unknown as Record<string, unknown>)[prop] = value;

  if (start !== null && end !== null) {
    try {
      input.setSelectionRange(start, end);
    } catch {
      // Not every input type supports selection; the value is already applied.
    }
  }
}

function applyElementPart(root: Node, part: Extract<ClientPartDescriptor, { kind: 'element' }>, value: unknown): void {
  const target = resolveNodeByPath(root, part.path);
  if (target?.nodeType !== 1) return;
  const el = target as HTMLElement;

  switch (part.prefix ?? '') {
    case '.':
      assignProperty(root, el, part.attr, value);
      break;
    case '?':
      if (value && value !== 'false') {
        el.setAttribute(part.attr, '');
      } else {
        el.removeAttribute(part.attr);
      }
      break;
    case '':
      if (value == null) {
        el.removeAttribute(part.attr);
      } else {
        el.setAttribute(part.attr, String(value));
      }
      break;
  }
}

function applySoleTextPart(root: Node, part: Extract<ClientPartDescriptor, { kind: 'sole-text' }>, value: unknown): void {
  const target = resolveNodeByPath(root, part.path);
  const text = asText(value);
  if (target?.nodeType === 1 && target.textContent !== text) {
    target.textContent = text;
  }
}

function applyRangePart(root: Node, part: Extract<ClientPartDescriptor, { kind: 'range' }>, value: unknown): void {
  const markers = resolveRangeMarkers(root, part.name, part.startPath);
  if (!markers) return;
  const { start, end } = markers;
  const text = asText(value);

  const first = start.nextSibling;
  if (first && first.nextSibling === end && first.nodeType === TEXT_NODE) {
    if (first.nodeValue !== text) first.nodeValue = text;
    return;
  }

  clearBetween(start, end, start.parentNode as Node);
  if (text.length > 0) {
    end.parentNode?.insertBefore(documentOf(root).createTextNode(text), end);
  }
}

/** Applies a scalar value to the binding a descriptor addresses. Unaddressable parts are left untouched. */
export function applyScalarPart(root: Node, part: ClientPartDescriptor | undefined, value: unknown): void {
  switch (part?.kind) {
    case 'element':
      applyElementPart(root, part, value);
      break;
    case 'sole-text':
      applySoleTextPart(root, part, value);
      break;
    case 'range':
      applyRangePart(root, part, value);
      break;
  }
}
