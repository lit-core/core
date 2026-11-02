import type { PatchFrame, ScalarPatchFrame, StateSnapshotPatchFrame } from './types.js';

export interface ElementPartDescriptor {
  k?: 'element';
  kind?: 'element';
  type?: 'ElementAnchored';
  path: number[];
  attr?: string;
  attr_name?: string;
  prefix?: string; // '.', '?', '@', or ''
}

export interface SoleTextPartDescriptor {
  k?: 'sole-text';
  kind?: 'sole-text';
  type?: 'SoleTextChild';
  path?: number[];
  parent_path?: number[];
}

export interface RangePartDescriptor {
  k?: 'range';
  kind?: 'range';
  type?: 'RangeAddressed';
  name?: string;
  startPath?: number[];
  start_path?: number[];
}

export type ClientPartDescriptor =
  | ElementPartDescriptor
  | SoleTextPartDescriptor
  | RangePartDescriptor
  | [0, number[], string, string?] // [0, path, attr, prefix]
  | [1, number[]] // [1, parentPath]
  | [2, string, number[]?]; // [2, name, startPath]

export function isStartMarker(node: any): boolean {
  if (!node) return false;
  if (node.nodeType === 7 && node.target === 'start') {
    return true;
  }
  if (node.nodeType === 8 && typeof node.data === 'string') {
    return node.data.startsWith('?start') || node.data.startsWith('start name=') || node.data.startsWith('start ');
  }
  return false;
}

export function isEndMarker(node: any): boolean {
  if (!node) return false;
  if (node.nodeType === 7 && node.target === 'end') {
    return true;
  }
  if (node.nodeType === 8 && typeof node.data === 'string') {
    const data = node.data;
    return data === '?end' || data.startsWith('?end') || data === 'end' || data.startsWith('end');
  }
  return false;
}

/**
 * Steps to the Nth logical child of parent, treating each <?start>...<?end> range
 * marker pair (and its contents) as a single logical child.
 */
export function getLogicalChild(parent: any, logicalIndex: number): Node | null {
  if (!parent) return null;
  const nodes = parent.childNodes;
  if (nodes && nodes.length !== undefined) {
    let curIndex = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (curIndex === logicalIndex) {
        return node;
      }
      if (isStartMarker(node)) {
        let depth = 0;
        i++;
        while (i < nodes.length) {
          const inner = nodes[i];
          if (isStartMarker(inner)) {
            depth++;
          } else if (isEndMarker(inner)) {
            if (depth === 0) {
              break;
            }
            depth--;
          }
          i++;
        }
      }
      curIndex++;
    }
    return null;
  }
  return null;
}

/**
 * Resolves a DOM node from root container via numeric child index path.
 */
export function resolveNodeByPath(root: Node, path: number[]): Node | null {
  let cur: any = root;
  for (let i = 0; i < path.length; i++) {
    if (!cur) return null;
    cur = getLogicalChild(cur, path[i]);
  }
  return cur || null;
}

/**
 * Resolves start and end markers for range-addressed parts.
 * Supports ProcessingInstruction nodes (type 7) and Comment nodes (type 8).
 */
export function resolveRangeMarkers(root: Node, markerName: string, startPath?: number[]): { start: Node; end: Node } | null {
  let start: Node | null = null;
  const targetData = `name="${markerName}"`;
  const matchesTarget = (node: Node | null): node is Node => {
    if (!node) return false;
    if (node.nodeType === 7) {
      const pi = node as ProcessingInstruction;
      return pi.target === 'start' && (pi.data.includes(targetData) || pi.data.includes(markerName));
    }
    if (node.nodeType === 8) {
      const d = (node as Comment).data;
      return d.includes(targetData) || d.startsWith(`?start name="${markerName}"`) || d.startsWith(`start name="${markerName}"`) || d === `?start ${markerName}` || d === `?${markerName}`;
    }
    return false;
  };

  if (startPath && startPath.length > 0) {
    const candidate = resolveNodeByPath(root, startPath);
    if (matchesTarget(candidate)) start = candidate;
  }

  if (!start) {
    const doc = (root as any).ownerDocument || (globalThis as any).document;
    if (doc?.createTreeWalker) {
      const walker = doc.createTreeWalker(root, 128 | 64);
      while (walker.nextNode()) {
        if (matchesTarget(walker.currentNode)) {
          start = walker.currentNode;
          break;
        }
      }
    }
  }

  if (!start) return null;

  let end: Node | null = null;
  let depth = 0;
  let cur: Node | null = start.nextSibling;
  while (cur) {
    if (isStartMarker(cur)) {
      depth++;
    } else if (isEndMarker(cur)) {
      if (depth === 0) {
        end = cur;
        break;
      }
      depth--;
    }
    cur = cur.nextSibling;
  }

  return end ? { start, end } : null;
}

/**
 * Reconciles a keyed list between range markers with minimal DOM moves.
 */
export function reconcileKeyedList(parent: Node, start: Node, _end: Node, items: unknown[], cache: Map<string | number, Node>): void {
  const doc = (parent as any).ownerDocument || (globalThis as any).document;
  const newKeys = new Set<string | number>();
  let before: Node = start;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as any;
    const key = typeof item === 'object' && item !== null && 'key' in item ? item.key : typeof item === 'object' && item !== null && 'id' in item ? item.id : item;
    newKeys.add(key);

    let node = cache.get(key);
    if (!node) {
      if (typeof item === 'object' && item !== null && 'f' in item && typeof item.f === 'string') {
        const t = doc.createElement('template');
        t.innerHTML = item.f;
        node = t.content.firstElementChild || t.content.firstChild;
      } else {
        const span = doc.createElement('span');
        const text =
          typeof item === 'object' && item !== null && 'text' in item && typeof item.text === 'string' ? item.text : item == null ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item);
        span.textContent = text;
        node = span;
      }
      if (node && (node as any).setAttribute) {
        (node as any).setAttribute('data-lit-key', String(key));
      }
      if (node) {
        cache.set(key, node);
      }
    }

    if (node) {
      if (node.previousSibling !== before) {
        parent.insertBefore(node, before.nextSibling);
      }
      before = node;
    }
  }

  for (const [key, node] of cache) {
    if (!newKeys.has(key)) {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
      cache.delete(key);
    }
  }
}

/**
 * Migrates SSR-prepended `static styles` `<style>` elements at the start of a ShadowRoot
 * into `adoptedStyleSheets` so numeric `childNodes` DOM paths computed from the component template
 * align 1-to-1 with the live ShadowRoot DOM.
 */
export function adoptLeadingSsrStyles(el?: any, root?: any, evts?: ReadonlyArray<{ path?: number[] }>): void {
  let c = root?.adoptedStyleSheets && root.firstChild;
  if (c?.localName !== 'style') return;
  const styles: Element[] = [];
  let n = 0;
  for (; c?.localName === 'style'; c = c.nextSibling) {
    if (n === styles.length && (c.hasAttribute('data-lit-sheet') || c.hasAttribute('data-lit-local'))) n++;
    styles.push(c);
  }
  if (n < styles.length) {
    const d = (el?.constructor?.__litParts || []).find((x: any) => x?.path?.length || x?.startPath?.length) || evts?.find((x) => x?.path?.length);
    const p = d?.path || d?.startPath;
    if (p) {
      const tag = d.targetTag?.toLowerCase();
      for (let k = n; k <= styles.length; k++) {
        const h: any = resolveNodeByPath(root, [p[0] + k, ...p.slice(1)]);
        if (d.startPath ? isStartMarker(h) : h?.nodeType === 1 && (!tag || h.localName === tag)) {
          n = k;
          break;
        }
      }
    } else n = styles.length;
  }
  if (!n) return;
  const m = typeof window !== 'undefined' ? ((window as any).__litCS ||= {}) : 0;
  const sheets = [...root.adoptedStyleSheets];
  for (let i = 0; i < n; i++) {
    const s = styles[i];
    const k = s.getAttribute('data-lit-sheet');
    let sh = k && m ? m[k] : 0;
    if (!sh) {
      sh = new CSSStyleSheet();
      sh.replaceSync(s.textContent || '');
      if (k && m) m[k] = sh;
    }
    s.remove();
    if (!sheets.includes(sh)) sheets.push(sh);
  }
  root.adoptedStyleSheets = sheets;
}

/**
 * Executes surgical patches directly against an element's ShadowRoot.
 */
export function executePatches(element: HTMLElement, frames: PatchFrame | PatchFrame[]): void {
  if (!element) return;
  const patchList = Array.isArray(frames) ? frames : [frames];
  const root: Node = element.shadowRoot || element;
  adoptLeadingSsrStyles(element, root);
  const ctor = element.constructor as any;
  const partTable: ClientPartDescriptor[] | undefined = ctor?.__litParts;
  let keyCaches: Map<number, Map<string | number, Node>> = (element as any).__litKeyCaches;
  if (!keyCaches) {
    keyCaches = new Map();
    (element as any).__litKeyCaches = keyCaches;
  }

  for (let i = 0; i < patchList.length; i++) {
    const frame = patchList[i];
    if (!frame || typeof frame !== 'object') continue;

    // 1. State snapshot frame { s, sig }
    if ('s' in frame && (frame as StateSnapshotPatchFrame).s) {
      const sf = frame as StateSnapshotPatchFrame;
      (element as any).__litState = sf.s;
      if (typeof element.setAttribute === 'function') {
        element.setAttribute('data-lit-state', JSON.stringify(sf.s));
      }
      if (sf.sig) {
        (element as any).__litSig = sf.sig;
        if (typeof sf.sq === 'number') {
          (element as any).__litSnapshotSeq = sf.sq;
        }
        if (typeof element.setAttribute === 'function') {
          element.setAttribute('data-lit-sig', sf.sig);
        }
      }
      continue;
    }

    // Check for part index
    if (!('p' in frame) || typeof (frame as any).p !== 'number') {
      continue;
    }
    const partIdx = (frame as any).p;
    const desc = partTable ? partTable[partIdx] : undefined;

    const resolveSoleChildContainer = (partDesc: ClientPartDescriptor | undefined): Element | null => {
      if (!partDesc) return null;
      const isSole = Array.isArray(partDesc) ? partDesc[0] === 1 : (partDesc as any).k === 'sole-text' || (partDesc as any).kind === 'sole-text' || (partDesc as any).type === 'SoleTextChild';
      if (!isSole) return null;
      const solePath = Array.isArray(partDesc) ? partDesc[1] : (partDesc as any).path || (partDesc as any).parent_path;
      const target = Array.isArray(solePath) ? resolveNodeByPath(root, solePath) : null;
      return target && target.nodeType === 1 ? (target as Element) : null;
    };

    // 2. Structural branch swap frame
    if ('f' in frame) {
      let sf: { p?: number; h?: string; html?: string; f?: string };
      if (typeof (frame as any).f === 'object' && (frame as any).f !== null) {
        sf = (frame as any).f;
      } else {
        sf = frame as any;
      }
      const pIdx = typeof (frame as any).p === 'number' ? (frame as any).p : sf.p;
      const htmlStr = typeof sf.html === 'string' ? sf.html : typeof sf.f === 'string' ? sf.f : '';
      if (typeof pIdx === 'number' && htmlStr) {
        const markerName = (desc && (desc as any).name) || (Array.isArray(desc) && desc[0] === 2 && desc[1]) || `p${pIdx}`;
        const startPath =
          (desc && ((desc as any).startPath || (desc as any).start_path)) || (Array.isArray(desc) && desc[0] === 2 && desc[2]) || (ctor?.__litPartPaths ? ctor.__litPartPaths[pIdx] : undefined);
        const markers = resolveRangeMarkers(root, markerName, startPath);
        const doc = (root as any).ownerDocument || (globalThis as any).document;
        if (markers) {
          const { start, end } = markers;
          let cur = start.nextSibling;
          while (cur && cur !== end) {
            const next = cur.nextSibling;
            if (cur.parentNode) cur.parentNode.removeChild(cur);
            cur = next;
          }
          const t = doc.createElement('template');
          t.innerHTML = htmlStr;
          end.parentNode?.insertBefore(t.content, end);
        } else {
          const soleContainer = resolveSoleChildContainer(desc);
          if (soleContainer) {
            const t = doc.createElement('template');
            t.innerHTML = htmlStr;
            soleContainer.replaceChildren(t.content);
          }
        }
      }
      continue;
    }

    // 3. Keyed list reconciliation frame
    if ('k' in frame) {
      let pIdx: number;
      let ops: any;
      if (typeof (frame as any).k === 'object' && (frame as any).k !== null && 'ops' in (frame as any).k) {
        pIdx = (frame as any).k.p ?? (frame as any).p;
        ops = (frame as any).k.ops;
      } else {
        pIdx = (frame as any).p;
        ops = (frame as any).k;
      }

      if (typeof pIdx === 'number') {
        const markerName = (desc && (desc as any).name) || (Array.isArray(desc) && desc[0] === 2 && desc[1]) || `p${pIdx}`;
        const startPath =
          (desc && ((desc as any).startPath || (desc as any).start_path)) || (Array.isArray(desc) && desc[0] === 2 && desc[2]) || (ctor?.__litPartPaths ? ctor.__litPartPaths[pIdx] : undefined);
        const markers = resolveRangeMarkers(root, markerName, startPath);
        const soleContainer = markers ? null : resolveSoleChildContainer(desc);
        const parent = markers ? markers.end.parentNode : soleContainer;
        const endAnchor: Node | null = markers ? markers.end : null;

        if (parent) {
          let cache = keyCaches.get(pIdx);
          if (!cache) {
            cache = new Map();
            keyCaches.set(pIdx, cache);
            let cur = markers ? markers.start.nextSibling : parent.firstChild;
            while (cur && cur !== endAnchor) {
              if (cur.nodeType === 1 /* Element */) {
                const el = cur as HTMLElement;
                const k = el.getAttribute('data-lit-key') || el.getAttribute('data-key') || (el as any).__litKey;
                if (k !== null && k !== undefined) {
                  cache.set(k, el);
                }
              }
              cur = cur.nextSibling;
            }
          }

          if (Array.isArray(ops) && ops.length > 0 && typeof ops[0] === 'object' && 'op' in ops[0]) {
            const doc = (root as any).ownerDocument || (globalThis as any).document;
            const makeOpNode = (op: any): Node | null => {
              let node: Node | null;
              if (typeof op.html === 'string') {
                const t = doc.createElement('template');
                t.innerHTML = op.html;
                node = t.content.firstElementChild || t.content.firstChild;
              } else {
                const span = doc.createElement('span');
                span.textContent = typeof op.text === 'string' ? op.text : op.value == null ? '' : String(op.value);
                node = span;
              }
              if (node && (node as any).setAttribute) (node as any).setAttribute('data-lit-key', String(op.key));
              return node;
            };
            for (const op of ops) {
              if (op.op === 'remove') {
                const node = cache.get(op.key);
                if (node?.parentNode) node.parentNode.removeChild(node);
                cache.delete(op.key);
              } else if (op.op === 'insert') {
                const node = makeOpNode(op);
                if (node) {
                  parent.insertBefore(node, endAnchor);
                  cache.set(op.key, node);
                }
              } else if (op.op === 'update') {
                const oldNode = cache.get(op.key);
                const newNode = makeOpNode(op);
                if (newNode) {
                  if (oldNode?.parentNode) oldNode.parentNode.replaceChild(newNode, oldNode);
                  cache.set(op.key, newNode);
                }
              } else if (op.op === 'reorder' && Array.isArray(op.order)) {
                let before: Node | null = markers ? markers.start : null;
                for (let j = 0; j < op.order.length; j++) {
                  const key = op.order[j];
                  const node = cache.get(key);
                  if (node) {
                    const ref = before ? before.nextSibling : parent.firstChild;
                    if (node !== ref && node.previousSibling !== before) {
                      parent.insertBefore(node, ref);
                    }
                    before = node;
                  }
                }
              }
            }
          } else if (Array.isArray(ops) && markers) {
            reconcileKeyedList(parent, markers.start, markers.end, ops, cache);
          }
        }
      }
      continue;
    }

    // 4. Scalar part update frame { p, v }
    if ('v' in frame) {
      const val = (frame as ScalarPatchFrame).v;

      const kind = desc
        ? Array.isArray(desc)
          ? desc[0] === 0
            ? 'element'
            : desc[0] === 1
              ? 'sole-text'
              : 'range'
          : (desc as any).k ||
            (desc as any).kind ||
            ((desc as any).type === 'SoleTextChild' ? 'sole-text' : (desc as any).type === 'RangeAddressed' ? 'range' : (desc as any).type === 'ElementAnchored' ? 'element' : 'range')
        : undefined;

      if (kind === 'sole-text') {
        const path = Array.isArray(desc) ? desc[1] : (desc as any).path || (desc as any).parent_path;
        const target = resolveNodeByPath(root, path);
        if (target && target.nodeType === 1) {
          const str = val == null ? '' : String(val);
          if (target.textContent !== str) {
            target.textContent = str;
          }
        }
      } else if (kind === 'element') {
        const path = Array.isArray(desc) ? desc[1] : (desc as any).path;
        const attrName = Array.isArray(desc) ? desc[2] : (desc as any).attr || (desc as any).attr_name;
        const prefix = Array.isArray(desc) ? desc[3] : (desc as any).prefix;
        const target = resolveNodeByPath(root, path);
        if (target && target.nodeType === 1) {
          const el = target as HTMLElement;
          if (prefix === '.') {
            const isFocused = (root as any).activeElement === el || (typeof document !== 'undefined' && document.activeElement === el);
            const start = isFocused && 'selectionStart' in el ? (el as HTMLInputElement).selectionStart : null;
            const end = isFocused && 'selectionEnd' in el ? (el as HTMLInputElement).selectionEnd : null;
            (el as any)[attrName] = val;
            if (isFocused && start !== null && end !== null) {
              try {
                (el as HTMLInputElement).setSelectionRange(start, end);
              } catch {}
            }
          } else if (prefix === '?') {
            if (val && val !== 'false') {
              el.setAttribute(attrName, '');
            } else {
              el.removeAttribute(attrName);
            }
          } else if (!prefix || prefix === '') {
            if (val == null) {
              el.removeAttribute(attrName);
            } else {
              el.setAttribute(attrName, String(val));
            }
          }
        }
      } else {
        const markerName = (desc && (desc as any).name) || (Array.isArray(desc) && desc[0] === 2 && desc[1]) || `p${partIdx}`;
        const startPath =
          (desc && ((desc as any).startPath || (desc as any).start_path)) || (Array.isArray(desc) && desc[0] === 2 && desc[2]) || (ctor?.__litPartPaths ? ctor.__litPartPaths[partIdx] : undefined);
        const markers = resolveRangeMarkers(root, markerName, startPath);
        if (markers) {
          const { start, end } = markers;
          const first = start.nextSibling;
          const str = val == null ? '' : String(val);
          if (first && first.nextSibling === end && first.nodeType === 3 /* Text */) {
            if (first.nodeValue !== str) {
              first.nodeValue = str;
            }
          } else {
            let cur = start.nextSibling;
            while (cur && cur !== end) {
              const next = cur.nextSibling;
              if (cur.parentNode) cur.parentNode.removeChild(cur);
              cur = next;
            }
            if (str.length > 0) {
              const doc = (root as any).ownerDocument || (globalThis as any).document;
              end.parentNode?.insertBefore(doc.createTextNode(str), end);
            }
          }
        } else if (!desc) {
          const candidates: { node: HTMLElement; type: 'element' | 'sole-text' }[] = [];
          function collectCandidates(parent: Node) {
            for (let j = 0; j < parent.childNodes.length; j++) {
              const child = parent.childNodes[j];
              if (child.nodeType === 1 /* Element */) {
                const el = child as HTMLElement;
                const tag = el.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') {
                  candidates.push({ node: el, type: 'element' });
                } else if (
                  tag === 'span' ||
                  tag === 'p' ||
                  tag === 'div' ||
                  tag === 'h1' ||
                  tag === 'h2' ||
                  tag === 'h3' ||
                  tag === 'h4' ||
                  tag === 'h5' ||
                  tag === 'h6' ||
                  tag === 'td' ||
                  tag === 'li'
                ) {
                  if (el.children.length === 0) {
                    candidates.push({ node: el, type: 'sole-text' });
                  } else {
                    collectCandidates(el);
                  }
                } else {
                  collectCandidates(el);
                }
              }
            }
          }
          collectCandidates(root);

          const candidate = candidates[partIdx];
          if (candidate) {
            if (candidate.type === 'element' && (candidate.node.tagName.toLowerCase() === 'input' || candidate.node.tagName.toLowerCase() === 'textarea')) {
              const el = candidate.node as HTMLInputElement;
              const isFocused = (root as any).activeElement === el || (typeof document !== 'undefined' && document.activeElement === el);
              const start = isFocused && 'selectionStart' in el ? el.selectionStart : null;
              const end = isFocused && 'selectionEnd' in el ? el.selectionEnd : null;
              el.value = String(val);
              if (isFocused && start !== null && end !== null) {
                try {
                  el.setSelectionRange(start, end);
                } catch {}
              }
            } else {
              candidate.node.textContent = String(val);
            }
          }
        }
      }
    }
  }
}

// Automatically register global executor when in browser window
if (typeof window !== 'undefined') {
  (window as any).__litExecutePatches = executePatches;
}
