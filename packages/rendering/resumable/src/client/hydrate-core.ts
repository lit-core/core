/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Unified Declarative Shadow DOM and Lit template hydration runtime for @lit-core.
 * Zero external runtime imports so `tsc` emits standalone ES2022 JS shared identically
 * between `@lit-core/resumable/client` and `virtual:lit-core/hydrate-support`.
 */

export function createHydrationRuntime(rawOrNormalizedLH: any) {
  const noChange = Symbol.for('lit-noChange');
  const nothing = Symbol.for('lit-nothing');
  const HYDRATE_INTERNALS_ATTR_PREFIX = 'hydrate-internals-';
  const RESUMED_EVENT_FLAG = '__lit_resumed__';

  function normalizeLitPrivateSsrSupport(raw: any): any {
    if (raw && typeof raw.ChildPart === 'function' && typeof raw.boundAttributeSuffix === 'string') {
      return raw;
    }
    if (raw && typeof raw._boundAttributeSuffix === 'string') {
      return {
        boundAttributeSuffix: raw._boundAttributeSuffix,
        marker: raw._marker,
        markerMatch: raw._markerMatch,
        HTML_RESULT: raw._HTML_RESULT,
        getTemplateHtml: raw._getTemplateHtml,
        getAttributePartCommittedValue: (part: any, value: unknown, index?: number) => {
          let committed: unknown = noChange;
          part._commitValue = (v: unknown) => {
            committed = v;
          };
          part._$setValue(value, part, index);
          return committed;
        },
        connectedDisconnectable: (props: Record<string, unknown> = {}) => ({ ...props, _$isConnected: true }),
        resolveDirective: raw._resolveDirective,
        AttributePart: raw._AttributePart,
        PropertyPart: raw._PropertyPart,
        BooleanAttributePart: raw._BooleanAttributePart,
        EventPart: raw._EventPart,
        ElementPart: raw._ElementPart,
        TemplateInstance: raw._TemplateInstance,
        ChildPart: raw._ChildPart,
        isIterable: raw._isIterable,
      };
    }
    if (raw && typeof raw.M === 'string') {
      return {
        boundAttributeSuffix: raw.M,
        marker: raw.P,
        markerMatch: raw.A,
        HTML_RESULT: raw.C,
        getTemplateHtml: raw.L,
        getAttributePartCommittedValue: (part: any, value: unknown, index?: number) => {
          let committed: unknown = noChange;
          part.j = (v: unknown) => {
            committed = v;
          };
          part._$AI(value, part, index);
          return committed;
        },
        connectedDisconnectable: (props: Record<string, unknown> = {}) => ({ ...props, _$AU: true }),
        resolveDirective: raw.V,
        AttributePart: raw.H,
        PropertyPart: raw.B,
        BooleanAttributePart: raw.N,
        EventPart: raw.U,
        ElementPart: raw.F,
        TemplateInstance: raw.R,
        ChildPart: raw.I,
        isIterable: raw.D,
      };
    }
    throw new Error('[@lit-core/resumable] Unable to initialize lit-html hydration support.');
  }

  const _$LH = normalizeLitPrivateSsrSupport(rawOrNormalizedLH);

  // Dynamically discover lit-html's internal method and property names without
  // hardcoding minified identifiers (works across both dev and prod lit-html builds).
  let setValueMethod = '_$setValue';
  try {
    const probe = new Proxy(
      {},
      {
        set() {
          return true;
        },
        get(_target, prop) {
          if (typeof prop === 'string') {
            setValueMethod = prop;
          }
          return () => {};
        },
      },
    );
    _$LH.getAttributePartCommittedValue(probe, undefined, undefined);
  } catch {}

  const sProbe: any = { __s: 1 };
  const eProbe: any = { __e: 1 };
  const sampleChildPart = new _$LH.ChildPart(sProbe, eProbe, undefined, {});
  let committedValueProp = '_$committedValue';
  let startNodeProp = '_$startNode';
  let endNodeProp = '_$endNode';
  for (const [k, v] of Object.entries(sampleChildPart)) {
    if (v === nothing) committedValueProp = k;
    else if (v === sProbe) startNodeProp = k;
    else if (v === eProbe) endNodeProp = k;
  }

  const compiledSpecCache = new WeakMap<object, any>();
  const standardSpecCache = new WeakMap<object, any>();
  const digestCache = new WeakMap<object, string>();
  const sharedTextSegments = new WeakMap<Text, Array<any>>();
  const partToSlot = new WeakMap<object, any>();
  const patchedLitElementClasses = new WeakSet<object>();
  const patchedPrototypes = new WeakSet<object>();

  function isPrimitive(value: any): boolean {
    return value === null || (typeof value !== 'object' && typeof value !== 'function');
  }

  function isTemplateLike(value: any): boolean {
    return Boolean(value && typeof value === 'object' && '_$litType$' in value && value._$litType$ !== undefined);
  }

  function isCompiledDescriptor(litType: any): boolean {
    return Boolean(litType && typeof litType === 'object' && 'h' in litType && litType.h != null);
  }

  function isNonStringIterable(value: any): boolean {
    if (typeof value === 'string' || value === null || value === undefined || typeof value !== 'object') {
      return false;
    }
    return typeof _$LH.isIterable === 'function' ? _$LH.isIterable(value) : Symbol.iterator in value;
  }

  function parseComponentState(rawState: string): Record<string, unknown> {
    if (!rawState || !rawState.trim()) {
      return {};
    }
    return JSON.parse(rawState.trim());
  }

  function restoreStateFromHostAttribute(host: any): Record<string, unknown> | null {
    if (!host || typeof host.hasAttribute !== 'function' || !host.hasAttribute('data-lit-state')) {
      return null;
    }
    const raw = host.getAttribute('data-lit-state');
    if (!raw || !raw.trim()) {
      host.removeAttribute('data-lit-state');
      return null;
    }
    try {
      const parsed = JSON.parse(raw.trim());
      for (const [key, value] of Object.entries(parsed)) {
        try {
          host[key] = value;
        } catch {}
      }
      host.removeAttribute('data-lit-state');
      return parsed;
    } catch (err) {
      console.error('[lit-hydrate] Failed to parse data-lit-state attribute:', err);
      return null;
    }
  }

  const restoreComponentState = restoreStateFromHostAttribute;

  function classifyCompiledPartKind(part: any): { kind: string; cleanName: string } {
    if (part.type === 6) {
      return { kind: 'element', cleanName: '' };
    }
    const rawName = typeof part.name === 'string' ? part.name : '';
    if (part.ctor === _$LH.EventPart || part.ctorType === 5 || rawName.startsWith('@') || typeof part.ctor?.prototype?.handleEvent === 'function') {
      return { kind: 'event', cleanName: rawName.replace(/^@/, '') };
    }
    if (part.ctor === _$LH.BooleanAttributePart || part.ctorType === 4 || rawName.startsWith('?')) {
      return { kind: 'boolean', cleanName: rawName.replace(/^\?/, '') };
    }
    if (part.ctor === _$LH.PropertyPart || part.ctorType === 3 || rawName.startsWith('.')) {
      return { kind: 'property', cleanName: rawName.replace(/^\./, '') };
    }
    return { kind: 'attribute', cleanName: rawName };
  }

  function firstSignificantTag(fragment: DocumentFragment): string | null {
    let cur = fragment.firstChild;
    while (cur) {
      if (cur.nodeType === 1) return (cur as Element).localName;
      if (cur.nodeType === 3 && (cur.textContent || '').trim().length > 0) return null;
      cur = cur.nextSibling;
    }
    return null;
  }

  function getOrBuildTemplateSpec(tpl: any, doc: Document): any {
    const litType = tpl._$litType$;
    if (isCompiledDescriptor(litType)) {
      const cached = compiledSpecCache.get(litType);
      if (cached) return cached;

      const htmlStr = typeof litType.h === 'string' ? litType.h : Array.isArray(litType.h) ? String(litType.h[0] ?? '') : String(litType.h ?? '');
      const tmpl = doc.createElement('template');
      tmpl.innerHTML = htmlStr;

      const walkedNodes: Node[] = [];
      const walker = doc.createTreeWalker(tmpl.content, 129);
      let n = walker.nextNode();
      while (n) {
        walkedNodes.push(n);
        n = walker.nextNode();
      }

      const rawParts = Array.isArray(litType.parts) ? litType.parts : [];
      const partsInOrder: any[] = [];
      const elementPartsByProtoNode = new Map<Element, any[]>();
      const childPartByProtoComment = new Map<Comment, any>();

      let valueCursor = 0;
      for (let i = 0; i < rawParts.length; i++) {
        const p = rawParts[i];
        const nodeIdx = typeof p.index === 'number' ? p.index : -1;
        const targetNode = nodeIdx >= 0 && nodeIdx < walkedNodes.length ? walkedNodes[nodeIdx] : null;

        if (p.type === 2 || p.type === 7) {
          const childSpec = { valueIndex: valueCursor };
          valueCursor += 1;
          partsInOrder.push({ nodeIndex: nodeIdx, spec: childSpec, isChild: true });
          if (targetNode && targetNode.nodeType === 8) {
            childPartByProtoComment.set(targetNode as Comment, childSpec);
          }
        } else if (p.type === 1 || p.type === 6) {
          const { kind, cleanName } = classifyCompiledPartKind(p);
          const strings = Array.isArray(p.strings) ? p.strings : undefined;
          const valueCount = strings ? Math.max(1, strings.length - 1) : 1;
          const elemSpec = { kind, name: cleanName, strings, valueIndex: valueCursor, valueCount };
          valueCursor += valueCount;
          partsInOrder.push({ nodeIndex: nodeIdx, spec: elemSpec, isChild: false });
          if (targetNode && targetNode.nodeType === 1) {
            let list = elementPartsByProtoNode.get(targetNode as Element);
            if (!list) {
              list = [];
              elementPartsByProtoNode.set(targetNode as Element, list);
            }
            list.push(elemSpec);
          }
        }
      }

      const parsed = {
        key: litType,
        isSvg: false,
        startsWithStyle: firstSignificantTag(tmpl.content) === 'style',
        tmpl,
        partsInOrder,
        elementPartsByProtoNode,
        childPartByProtoComment,
      };
      compiledSpecCache.set(litType, parsed);
      return parsed;
    }

    if (typeof litType === 'number' && tpl.strings) {
      const cached = standardSpecCache.get(tpl.strings);
      if (cached) return cached;

      const [trustableHtml, attrNames] = _$LH.getTemplateHtml(tpl.strings, litType);
      const tmpl = doc.createElement('template');
      tmpl.innerHTML = typeof trustableHtml === 'string' ? trustableHtml : String(trustableHtml);

      // Unwrap <svg> (litType === 2) or <math> (litType === 3) root wrapper emitted by getTemplateHtml
      if (litType === 2 || litType === 3) {
        const wrapper = tmpl.content.firstChild as Element | null;
        if (wrapper && typeof wrapper.replaceWith === 'function') {
          wrapper.replaceWith(...Array.from(wrapper.childNodes));
        }
      }

      const suffix = _$LH.boundAttributeSuffix;
      const marker = _$LH.marker;
      const markerMatch = _$LH.markerMatch;
      const partCount = tpl.strings.length - 1;
      const partsInOrder: any[] = [];
      const elementPartsByProtoNode = new Map<Element, any[]>();
      const childPartByProtoComment = new Map<Comment, any>();

      const walker = doc.createTreeWalker(tmpl.content, 129);
      let nodeIndex = -1;
      let attrNameIndex = 0;
      let valueCursor = 0;
      let n = walker.nextNode();

      while (n && valueCursor < partCount) {
        nodeIndex += 1;
        if (n.nodeType === 1) {
          const el = n as Element;
          const elemAttrNames = typeof el.getAttributeNames === 'function' ? el.getAttributeNames() : Array.from(el.attributes || [], (a: any) => a.name);
          if (elemAttrNames.length > 0) {
            const attrsToRemove: string[] = [];
            for (let a = 0; a < elemAttrNames.length; a++) {
              const rawAttrName = elemAttrNames[a];
              if (rawAttrName.endsWith(suffix)) {
                const attrVal = el.getAttribute(rawAttrName) ?? '';
                const rawEntry = attrNames[attrNameIndex++];
                const realRawName = rawEntry === undefined ? '' : String(rawEntry);
                attrsToRemove.push(rawAttrName);
                const statics = attrVal.split(marker);
                let kind = 'attribute';
                let cleanName = realRawName;
                if (!realRawName) {
                  kind = 'element';
                } else if (realRawName[0] === '@') {
                  kind = 'event';
                  cleanName = realRawName.slice(1);
                } else if (realRawName[0] === '?') {
                  kind = 'boolean';
                  cleanName = realRawName.slice(1);
                } else if (realRawName[0] === '.') {
                  kind = 'property';
                  cleanName = realRawName.slice(1);
                }
                const valueCount = Math.max(1, statics.length - 1);
                const elemSpec = {
                  kind,
                  name: cleanName,
                  strings: statics.length > 2 || statics[0] !== '' || statics[1] !== '' ? statics : undefined,
                  valueIndex: valueCursor,
                  valueCount,
                };
                valueCursor += valueCount;
                partsInOrder.push({ nodeIndex, spec: elemSpec, isChild: false });
                let list = elementPartsByProtoNode.get(el);
                if (!list) {
                  list = [];
                  elementPartsByProtoNode.set(el, list);
                }
                list.push(elemSpec);
              } else if (rawAttrName.startsWith(marker)) {
                attrsToRemove.push(rawAttrName);
                const elemSpec = {
                  kind: 'element',
                  name: '',
                  strings: undefined,
                  valueIndex: valueCursor,
                  valueCount: 1,
                };
                valueCursor += 1;
                partsInOrder.push({ nodeIndex, spec: elemSpec, isChild: false });
                let list = elementPartsByProtoNode.get(el);
                if (!list) {
                  list = [];
                  elementPartsByProtoNode.set(el, list);
                }
                list.push(elemSpec);
              }
            }
            for (const rem of attrsToRemove) {
              el.removeAttribute(rem);
            }
          }

          const lowerTag = el.tagName.toLowerCase();
          if (lowerTag === 'script' || lowerTag === 'style' || lowerTag === 'textarea' || lowerTag === 'title') {
            const rawText = el.textContent ?? '';
            const strings = rawText.split(marker);
            const lastIndex = strings.length - 1;
            if (lastIndex > 0) {
              el.textContent = '';
              for (let i = 0; i < lastIndex; i++) {
                if (strings[i].length > 0) {
                  el.appendChild(doc.createTextNode(strings[i]));
                }
                const markerComment = doc.createComment('');
                el.appendChild(markerComment);
                walker.nextNode();
                nodeIndex += 1;
                const childSpec = { valueIndex: valueCursor };
                valueCursor += 1;
                partsInOrder.push({ nodeIndex, spec: childSpec, isChild: true });
                childPartByProtoComment.set(markerComment, childSpec);
              }
              if (strings[lastIndex].length > 0) {
                el.appendChild(doc.createTextNode(strings[lastIndex]));
              }
              const trailingComment = doc.createComment('');
              el.appendChild(trailingComment);
            }
          }
        } else if (n.nodeType === 8) {
          const comment = n as Comment;
          if (comment.data === markerMatch) {
            const childSpec = { valueIndex: valueCursor };
            valueCursor += 1;
            partsInOrder.push({ nodeIndex, spec: childSpec, isChild: true });
            childPartByProtoComment.set(comment, childSpec);
          } else {
            let searchIdx = -1;
            while ((searchIdx = comment.data.indexOf(marker, searchIdx + 1)) !== -1) {
              const childSpec = { valueIndex: valueCursor };
              valueCursor += 1;
              partsInOrder.push({ nodeIndex, spec: childSpec, isChild: true });
              childPartByProtoComment.set(comment, childSpec);
            }
          }
        }
        n = walker.nextNode();
      }

      const parsed = {
        key: tpl.strings,
        isSvg: litType === 2,
        startsWithStyle: firstSignificantTag(tmpl.content) === 'style',
        tmpl,
        partsInOrder,
        elementPartsByProtoNode,
        childPartByProtoComment,
      };
      standardSpecCache.set(tpl.strings, parsed);
      return parsed;
    }

    return null;
  }

  function bindDataActionDelegation(root: any, host: any): void {
    if (!host || !root || typeof root.querySelectorAll !== 'function') return;
    const actionElements = root.querySelectorAll('[data-action]');
    actionElements.forEach((el: any) => {
      const actionName = el.getAttribute('data-action');
      if (actionName && typeof host[actionName] === 'function' && !el.__litActionBound) {
        el.__litActionBound = true;
        el.addEventListener('click', (e: Event) => host[actionName](e));
      }
    });
  }

  function isDirtyPreTypedInput(el: any, propName: string): boolean {
    if (propName === 'value' && el && 'defaultValue' in el && 'value' in el) {
      return el.value !== '' && el.value !== el.defaultValue;
    }
    return false;
  }

  function createAndCommitElementBinding(el: Element, spec: any, values: unknown[], disconnectParent: any, ctx: any, isHydrating: boolean): any {
    const strings = spec.strings ? Array.from(spec.strings) : ['', ''];
    let helperPart: any;
    if (spec.kind === 'element') {
      helperPart = new _$LH.ElementPart(el, disconnectParent, ctx.renderOptions);
    } else if (spec.kind === 'event') {
      helperPart = new _$LH.EventPart(el, spec.name, strings, disconnectParent, ctx.renderOptions);
    } else if (spec.kind === 'boolean') {
      helperPart = new _$LH.BooleanAttributePart(el, spec.name, strings, disconnectParent, ctx.renderOptions);
    } else if (spec.kind === 'property') {
      helperPart = new _$LH.PropertyPart(el, spec.name, strings, disconnectParent, ctx.renderOptions);
    } else {
      helperPart = new _$LH.AttributePart(el, spec.name, strings, disconnectParent, ctx.renderOptions);
    }
    const binding = { spec, element: el, helperPart };
    applyElementBindingValue(binding, values, isHydrating);
    return binding;
  }

  function applyElementBindingValue(binding: any, values: unknown[], isHydrating: boolean): void {
    const { spec, element, helperPart } = binding;
    if (spec.kind === 'element') {
      if (typeof helperPart[setValueMethod] === 'function') {
        helperPart[setValueMethod](values[spec.valueIndex]);
      } else {
        _$LH.resolveDirective(helperPart, values[spec.valueIndex]);
      }
      return;
    }

    const isMulti = Boolean(spec.strings && (spec.strings.length > 2 || spec.strings[0] !== '' || spec.strings[1] !== ''));
    const arg = isMulti ? values : values[spec.valueIndex];
    const valueIdx = isMulti ? spec.valueIndex : undefined;

    if (isHydrating) {
      const shouldCommit = spec.kind === 'event' || (spec.kind === 'property' && !isDirtyPreTypedInput(element, spec.name));
      helperPart[setValueMethod](arg, helperPart, valueIdx, !shouldCommit);
    } else {
      helperPart[setValueMethod](arg, helperPart, valueIdx, false);
    }
  }

  function isStartMarkerComment(node: Node | null): node is Comment | ProcessingInstruction {
    if (!node) return false;
    if (node.nodeType === 8) return (node as Comment).data.startsWith('?start');
    if (node.nodeType === 7) return node.nodeName === 'start' || (node as ProcessingInstruction).target === 'start';
    return false;
  }

  function isEndMarkerComment(node: Node | null): node is Comment | ProcessingInstruction {
    if (!node) return false;
    if (node.nodeType === 8) return (node as Comment).data.trim() === '?end';
    if (node.nodeType === 7) return node.nodeName === 'end' || (node as ProcessingInstruction).target === 'end';
    return false;
  }

  function findMatchingEndMarker(startComment: Comment | ProcessingInstruction, endBoundary: Node | null): Comment | ProcessingInstruction | null {
    let depth = 1;
    let cur = startComment.nextSibling;
    while (cur && cur !== endBoundary) {
      if (isStartMarkerComment(cur)) {
        depth += 1;
      } else if (isEndMarkerComment(cur)) {
        depth -= 1;
        if (depth === 0) {
          return cur;
        }
      }
      cur = cur.nextSibling;
    }
    return null;
  }

  function recordSharedTextSegment(textNode: Text, entry: any): void {
    let list = sharedTextSegments.get(textNode);
    if (!list) {
      list = [];
      sharedTextSegments.set(textNode, list);
    }
    list.push(entry);
  }

  function attachSlotAnchors(slot: any, startComment: Comment | ProcessingInstruction, endComment: Comment | ProcessingInstruction): void {
    slot.start = startComment;
    slot.end = endComment;
    slot.helperChildPart[startNodeProp] = startComment;
    slot.helperChildPart[endNodeProp] = endComment;
  }

  function materializeSharedTextNode(textNode: Text, doc: Document): void {
    const segments = sharedTextSegments.get(textNode);
    if (!segments) return;
    sharedTextSegments.delete(textNode);
    const parent = textNode.parentNode;
    if (!parent) return;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.kind === 'static') {
        if (seg.text.length > 0) {
          parent.insertBefore(doc.createTextNode(seg.text), textNode);
        }
      } else if (seg.kind === 'slot') {
        const s = seg.slot;
        const txt = s.state.kind === 'shared-text' ? s.state.text : '';
        const sStart = doc.createComment('');
        const sText = doc.createTextNode(txt);
        const sEnd = doc.createComment('');
        parent.insertBefore(sStart, textNode);
        parent.insertBefore(sText, textNode);
        parent.insertBefore(sEnd, textNode);
        attachSlotAnchors(s, sStart, sEnd);
        s.firstManagedNode = sText;
        s.lastManagedNode = sText;
        s.state = { kind: 'text', text: txt, node: sText };
      }
    }
    parent.removeChild(textNode);
  }

  function getSlotFirstDomNode(slot: any): Node | null {
    if (slot.start && slot.start.parentNode === slot.parent) {
      return slot.start;
    }
    if (slot.state.kind === 'text' || slot.state.kind === 'shared-text' || slot.state.kind === 'node') {
      if (slot.state.node && slot.state.node.parentNode === slot.parent) {
        return slot.state.node;
      }
    }
    if (slot.state.kind === 'template') {
      const inst = slot.state.instance;
      if (inst.firstNode && inst.firstNode.parentNode === slot.parent) {
        return inst.firstNode;
      }
    }
    if (slot.state.kind === 'iterable') {
      for (const item of slot.state.items) {
        const f = getSlotFirstDomNode(item);
        if (f && f.parentNode === slot.parent) return f;
      }
    }
    if (slot.firstManagedNode && slot.firstManagedNode.parentNode === slot.parent) {
      return slot.firstManagedNode;
    }
    return null;
  }

  function getSlotAfterDomNode(slot: any): Node | null {
    if (slot.end && slot.end.parentNode === slot.parent) {
      return slot.end;
    }
    if (slot.state.kind === 'text' || slot.state.kind === 'shared-text' || slot.state.kind === 'node') {
      if (slot.state.node && slot.state.node.parentNode === slot.parent) {
        return slot.state.node.nextSibling;
      }
    }
    if (slot.state.kind === 'template') {
      const inst = slot.state.instance;
      if (inst.lastNode && inst.lastNode.parentNode === slot.parent) {
        return inst.lastNode.nextSibling;
      }
    }
    if (slot.state.kind === 'iterable') {
      for (let i = slot.state.items.length - 1; i >= 0; i--) {
        const l = getSlotLastDomNode(slot.state.items[i]);
        if (l && l.parentNode === slot.parent) return l.nextSibling;
      }
    }
    if (slot.lastManagedNode && slot.lastManagedNode.parentNode === slot.parent) {
      return slot.lastManagedNode.nextSibling;
    }
    if (slot.insertionPoint && slot.insertionPoint.parentNode === slot.parent) {
      return slot.insertionPoint;
    }
    return null;
  }

  function getSlotLastDomNode(slot: any): Node | null {
    if (slot.end && slot.end.parentNode === slot.parent && isEndMarkerComment(slot.end)) {
      return slot.end;
    }
    if (slot.state.kind === 'text' || slot.state.kind === 'shared-text' || slot.state.kind === 'node') {
      if (slot.state.node && slot.state.node.parentNode === slot.parent) {
        return slot.state.node;
      }
    }
    if (slot.state.kind === 'template') {
      const inst = slot.state.instance;
      if (inst.lastNode && inst.lastNode.parentNode === slot.parent) {
        return inst.lastNode;
      }
    }
    if (slot.state.kind === 'iterable') {
      for (let i = slot.state.items.length - 1; i >= 0; i--) {
        const l = getSlotLastDomNode(slot.state.items[i]);
        if (l && l.parentNode === slot.parent) return l;
      }
    }
    if (slot.lastManagedNode && slot.lastManagedNode.parentNode === slot.parent) {
      return slot.lastManagedNode;
    }
    return null;
  }

  function ensureSlotAnchors(slot: any, doc: Document): void {
    if (slot.state.kind === 'shared-text' && slot.state.node) {
      materializeSharedTextNode(slot.state.node, doc);
    }
    if (slot.start && slot.end && slot.ownsEndAnchor && slot.start.parentNode && slot.end.parentNode) {
      return;
    }
    const parent = slot.parent;
    if (!parent) return;

    const firstNode = getSlotFirstDomNode(slot);
    const afterNode = getSlotAfterDomNode(slot);

    if (!slot.start || !slot.start.parentNode) {
      const s = doc.createComment('');
      parent.insertBefore(s, firstNode ?? afterNode);
      slot.start = s;
      slot.helperChildPart[startNodeProp] = s;
    }
    if (!slot.end || !slot.ownsEndAnchor || !slot.end.parentNode) {
      const e = doc.createComment('');
      parent.insertBefore(e, afterNode);
      slot.end = e;
      slot.ownsEndAnchor = true;
      slot.helperChildPart[endNodeProp] = e;
    }
  }

  function setInstanceConnected(instance: any, isConnected: boolean): void {
    instance.isConnected = isConnected;
    if (instance.disconnectRoot && typeof instance.disconnectRoot.setConnected === 'function') {
      instance.disconnectRoot.setConnected(isConnected);
    }
    for (let i = 0; i < instance.childBindings.length; i++) {
      setSlotConnected(instance.childBindings[i].slot, isConnected);
    }
  }

  function setSlotConnected(slot: any, isConnected: boolean): void {
    slot.isConnected = isConnected;
    if (slot.disconnectRoot && typeof slot.disconnectRoot.setConnected === 'function') {
      slot.disconnectRoot.setConnected(isConnected);
    }
    if (slot.state.kind === 'template') {
      setInstanceConnected(slot.state.instance, isConnected);
    } else if (slot.state.kind === 'iterable') {
      for (let i = 0; i < slot.state.items.length; i++) {
        setSlotConnected(slot.state.items[i], isConnected);
      }
    }
    if (Array.isArray(slot.committedParts)) {
      for (let i = 0; i < slot.committedParts.length; i++) {
        const p = slot.committedParts[i];
        const mapped = partToSlot.get(p);
        if (mapped) {
          setSlotConnected(mapped, isConnected);
        } else if (p && typeof p.setConnected === 'function') {
          p.setConnected(isConnected);
        }
      }
    }
  }

  function disconnectSlotValueState(slot: any): void {
    if (slot.state.kind === 'template') {
      setInstanceConnected(slot.state.instance, false);
    } else if (slot.state.kind === 'iterable') {
      for (let i = 0; i < slot.state.items.length; i++) {
        setSlotConnected(slot.state.items[i], false);
      }
    }
    if (Array.isArray(slot.committedParts)) {
      for (let i = 0; i < slot.committedParts.length; i++) {
        const p = slot.committedParts[i];
        const mapped = partToSlot.get(p);
        if (mapped) {
          setSlotConnected(mapped, false);
        }
      }
      slot.committedParts = null;
    }
  }

  function clearSlotDom(slot: any, doc: Document): void {
    ensureSlotAnchors(slot, doc);
    disconnectSlotValueState(slot);
    let cur = slot.start.nextSibling;
    while (cur && cur !== slot.end) {
      const next = cur.nextSibling;
      cur.parentNode?.removeChild(cur);
      cur = next;
    }
    slot.firstManagedNode = null;
    slot.lastManagedNode = null;
  }

  function materializeIterableCommittedParts(slot: any, ctx: any): any[] {
    if (Array.isArray(slot.committedParts)) {
      return slot.committedParts;
    }
    ensureSlotAnchors(slot, ctx.doc);
    const items = slot.state.kind === 'iterable' ? slot.state.items : [];
    const parts: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const itemSlot = items[i];
      if (itemSlot.state.kind === 'shared-text' && itemSlot.state.node) {
        materializeSharedTextNode(itemSlot.state.node, ctx.doc);
      }
      ensureSlotAnchors(itemSlot, ctx.doc);
      parts.push(itemSlot.helperChildPart);
    }
    slot.committedParts = parts;
    return parts;
  }

  function createChildSlot(parent: Node, start: Comment | ProcessingInstruction | null, end: Node | null, ownsEndAnchor: boolean, parentDisconnectable: any, ctx: any): any {
    const disconnectRoot = parentDisconnectable ?? new _$LH.ChildPart(null, null, undefined, ctx.renderOptions);
    const helperChildPart = new _$LH.ChildPart(start, end, parentDisconnectable ? parentDisconnectable : undefined, ctx.renderOptions);
    const slot: any = {
      parent,
      start,
      end,
      ownsEndAnchor,
      insertionPoint: end,
      firstManagedNode: null,
      lastManagedNode: null,
      disconnectRoot: parentDisconnectable ? null : disconnectRoot,
      helperChildPart,
      ctx,
      state: { kind: 'empty' },
      renderPassCount: 0,
      inDirectiveResolve: false,
      committedParts: null,
      rawCommitted: nothing,
      isConnected: Boolean(ctx.renderOptions?.isConnected ?? true),
    };

    partToSlot.set(helperChildPart, slot);

    Object.defineProperty(helperChildPart, 'parentNode', {
      configurable: true,
      get() {
        const sNode = helperChildPart[startNodeProp];
        if (sNode && sNode.parentNode) {
          if (sNode.parentNode.nodeType === 11 && slot.parent && slot.parent.nodeType !== 11) {
            return slot.parent;
          }
          return sNode.parentNode;
        }
        return slot.parent;
      },
    });

    Object.defineProperty(helperChildPart, committedValueProp, {
      configurable: true,
      get() {
        if (slot.committedParts !== null) {
          return slot.committedParts;
        }
        if (slot.inDirectiveResolve && slot.renderPassCount >= 2 && slot.state.kind === 'iterable') {
          return materializeIterableCommittedParts(slot, slot.ctx);
        }
        return slot.rawCommitted;
      },
      set(val: any) {
        if (Array.isArray(val)) {
          ensureSlotAnchors(slot, slot.ctx.doc);
          slot.committedParts = val;
        } else {
          slot.committedParts = null;
          slot.rawCommitted = val;
        }
      },
    });

    helperChildPart[setValueMethod] = (nextValue: unknown, directiveParent?: any) => {
      updateChildSlot(slot, nextValue, slot.ctx, directiveParent);
    };

    return slot;
  }

  function protoHasAdjacentTextOrChildAfter(protoNodes: ArrayLike<Node>, index: number, childMap: Map<Comment, any>): boolean {
    for (let i = index + 1; i < protoNodes.length; i++) {
      const n = protoNodes[i];
      if (n.nodeType === 1) return false;
      if (n.nodeType === 3 && (n.textContent ?? '').length > 0) return true;
      if (n.nodeType === 8 && childMap.has(n as Comment)) return true;
    }
    return false;
  }

  function protoIsSoleChildInParent(protoNodes: ArrayLike<Node>, index: number, childMap: Map<Comment, any>): boolean {
    for (let i = 0; i < protoNodes.length; i++) {
      if (i === index) continue;
      const n = protoNodes[i];
      if (n.nodeType === 1) return false;
      if (n.nodeType === 3 && (n.textContent ?? '').length > 0) return false;
      if (n.nodeType === 8 && childMap.has(n as Comment)) return false;
    }
    return true;
  }

  function hydrateChildValue(
    liveParent: Node,
    cursorState: { node: Node | null; textOffset: number },
    endBoundary: Node | null,
    rawValue: unknown,
    parentDisconnectable: any,
    ctx: any,
    sharesFollowingText = false,
    isSoleChild = false,
  ): { slot: any } {
    let slot: any;
    let innerEndBoundary = endBoundary;

    if (cursorState.textOffset === 0 && cursorState.node !== endBoundary && isStartMarkerComment(cursorState.node)) {
      const startComment = cursorState.node;
      const matchingEnd = findMatchingEndMarker(startComment, endBoundary);
      if (matchingEnd) {
        slot = createChildSlot(liveParent, startComment, matchingEnd, true, parentDisconnectable, ctx);
        cursorState.node = startComment.nextSibling;
        cursorState.textOffset = 0;
        innerEndBoundary = matchingEnd;
        hydrateSlotInner(slot, liveParent, cursorState, innerEndBoundary, rawValue, ctx, false, true);
        cursorState.node = matchingEnd.nextSibling;
        cursorState.textOffset = 0;
        return { slot };
      }
    }

    slot = createChildSlot(liveParent, null, endBoundary, false, parentDisconnectable, ctx);
    hydrateSlotInner(slot, liveParent, cursorState, innerEndBoundary, rawValue, ctx, sharesFollowingText, isSoleChild && cursorState.textOffset === 0);
    return { slot };
  }

  function hydrateSlotInner(
    slot: any,
    liveParent: Node,
    cursorState: { node: Node | null; textOffset: number },
    endBoundary: Node | null,
    rawValue: unknown,
    ctx: any,
    sharesFollowingText: boolean,
    ownsRangeToBoundary = false,
  ): void {
    slot.inDirectiveResolve = true;
    let value: any;
    try {
      value = _$LH.resolveDirective(slot.helperChildPart, rawValue);
    } finally {
      slot.inDirectiveResolve = false;
    }

    if (value === null || value === undefined || value === nothing || value === noChange || value === '') {
      if (ownsRangeToBoundary && cursorState.textOffset === 0 && cursorState.node && cursorState.node !== endBoundary) {
        const firstInRange = cursorState.node;
        let lastInRange: Node = firstInRange;
        while (lastInRange.nextSibling && lastInRange.nextSibling !== endBoundary) {
          lastInRange = lastInRange.nextSibling;
        }
        cursorState.node = endBoundary;
        if (firstInRange === lastInRange && firstInRange.nodeType === 3) {
          const tNode = firstInRange as Text;
          slot.firstManagedNode = tNode;
          slot.lastManagedNode = tNode;
          slot.state = { kind: 'text', text: tNode.data, node: tNode };
        } else {
          slot.firstManagedNode = firstInRange;
          slot.lastManagedNode = lastInRange;
          slot.state = { kind: 'unmatched-ssr' };
        }
        slot.rawCommitted = value === noChange ? nothing : (value ?? '');
        return;
      }
      if (cursorState.node && cursorState.node.nodeType === 3 && (cursorState.textOffset > 0 || sharesFollowingText)) {
        recordSharedTextSegment(cursorState.node as Text, { kind: 'slot', slot });
        slot.state = { kind: 'shared-text', text: '', node: cursorState.node as Text };
      } else {
        slot.insertionPoint = cursorState.node;
        slot.state = { kind: 'empty' };
      }
      slot.rawCommitted = value === noChange ? nothing : (value ?? '');
      return;
    }

    if (isTemplateLike(value)) {
      if (cursorState.textOffset > 0 && cursorState.node) {
        cursorState.node = cursorState.node.nextSibling;
        cursorState.textOffset = 0;
      }
      const spec = getOrBuildTemplateSpec(value, ctx.doc);
      if (spec) {
        const vals = Array.isArray(value.values) ? value.values : [];
        const hydrated = hydrateTemplateInstance(liveParent, cursorState, endBoundary, spec, vals, ctx);
        slot.firstManagedNode = hydrated.instance.firstNode;
        slot.lastManagedNode = hydrated.instance.lastNode;
        slot.insertionPoint = cursorState.node;
        slot.state = { kind: 'template', instance: hydrated.instance };
        return;
      }
    }

    if (isNonStringIterable(value)) {
      const rawItems = Array.from(value as Iterable<unknown>);
      const items: any[] = [];
      for (let idx = 0; idx < rawItems.length; idx++) {
        const hasMoreItems = idx + 1 < rawItems.length || sharesFollowingText;
        const itemHydrated = hydrateChildValue(liveParent, cursorState, endBoundary, rawItems[idx], slot.disconnectRoot ?? slot.helperChildPart, ctx, hasMoreItems);
        items.push(itemHydrated.slot);
      }
      slot.firstManagedNode = items.length > 0 ? getSlotFirstDomNode(items[0]) : null;
      slot.lastManagedNode = items.length > 0 ? getSlotLastDomNode(items[items.length - 1]) : null;
      slot.insertionPoint = cursorState.node;
      slot.state = { kind: 'iterable', items };
      slot.rawCommitted = nothing;
      return;
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      if (cursorState.textOffset > 0 && cursorState.node) {
        cursorState.node = cursorState.node.nextSibling;
        cursorState.textOffset = 0;
      }
      slot.firstManagedNode = value;
      slot.lastManagedNode = value;
      slot.state = { kind: 'node', node: value };
      slot.rawCommitted = value;
      return;
    }

    const str = String(value);
    const rangeFirstNode = ownsRangeToBoundary && cursorState.textOffset === 0 && cursorState.node !== endBoundary ? cursorState.node : null;
    while (cursorState.node && cursorState.node !== endBoundary && (cursorState.node.nodeType === 8 || cursorState.node.nodeType === 7)) {
      cursorState.node = cursorState.node.nextSibling;
      cursorState.textOffset = 0;
    }

    if (ownsRangeToBoundary && rangeFirstNode && (!cursorState.node || cursorState.node === endBoundary || cursorState.node.nodeType !== 3 || cursorState.node.nextSibling !== endBoundary)) {
      let lastInRange: Node = rangeFirstNode;
      while (lastInRange.nextSibling && lastInRange.nextSibling !== endBoundary) {
        lastInRange = lastInRange.nextSibling;
      }
      slot.firstManagedNode = rangeFirstNode;
      slot.lastManagedNode = lastInRange;
      slot.state = { kind: 'unmatched-ssr' };
      slot.rawCommitted = isPrimitive(value) ? value : str;
      cursorState.node = endBoundary;
      cursorState.textOffset = 0;
      return;
    }

    if (cursorState.node && cursorState.node !== endBoundary && cursorState.node.nodeType === 3) {
      const textNode = cursorState.node as Text;
      const remaining = textNode.data.length - cursorState.textOffset;
      const isShared = cursorState.textOffset > 0 || (sharesFollowingText && remaining > str.length);

      if (isShared) {
        recordSharedTextSegment(textNode, { kind: 'slot', slot });
        slot.firstManagedNode = textNode;
        slot.lastManagedNode = textNode;
        slot.state = { kind: 'shared-text', text: str, node: textNode };
        slot.rawCommitted = isPrimitive(value) ? value : str;
        const nextOffset = cursorState.textOffset + str.length;
        if (nextOffset >= textNode.data.length) {
          cursorState.node = textNode.nextSibling;
          cursorState.textOffset = 0;
        } else {
          cursorState.textOffset = nextOffset;
        }
        return;
      }

      slot.firstManagedNode = textNode;
      slot.lastManagedNode = textNode;
      slot.state = { kind: 'text', text: str, node: textNode };
      slot.rawCommitted = isPrimitive(value) ? value : str;
      cursorState.node = textNode.nextSibling;
      cursorState.textOffset = 0;
      return;
    }

    slot.insertionPoint = cursorState.node;
    slot.state = { kind: 'empty' };
    slot.rawCommitted = isPrimitive(value) ? value : str;
  }

  function hydrateTemplateInstance(liveParent: Node, cursorState: { node: Node | null; textOffset: number }, endBoundary: Node | null, spec: any, values: unknown[], ctx: any): { instance: any } {
    const disconnectRoot = new _$LH.ChildPart(null, null, undefined, ctx.renderOptions);
    const elementBindings: any[] = [];
    const childBindings: any[] = [];
    const beforeFirst = cursorState.node;
    hydrateNodesInParent(liveParent, cursorState, endBoundary, spec.tmpl.content.childNodes, spec, values, disconnectRoot, elementBindings, childBindings, ctx);
    const firstNode: Node | null = beforeFirst !== cursorState.node ? beforeFirst : null;
    let lastNode: Node | null = null;
    if (firstNode) {
      let scan: Node | null = firstNode;
      while (scan && scan !== cursorState.node && scan !== endBoundary) {
        lastNode = scan;
        scan = scan.nextSibling;
      }
    }
    return {
      instance: {
        spec,
        disconnectRoot,
        elementBindings,
        childBindings,
        firstNode,
        lastNode,
        isConnected: Boolean(ctx.renderOptions?.isConnected ?? true),
      },
    };
  }

  function hydrateNodesInParent(
    liveParent: Node,
    cursorState: { node: Node | null; textOffset: number },
    endBoundary: Node | null,
    protoNodes: NodeListOf<ChildNode> | ChildNode[],
    spec: any,
    values: unknown[],
    disconnectRoot: any,
    elementBindings: any[],
    childBindings: any[],
    ctx: any,
  ): void {
    for (let i = 0; i < protoNodes.length; i++) {
      const pNode = protoNodes[i];

      if (pNode.nodeType === 8) {
        const childSpec = spec.childPartByProtoComment.get(pNode as Comment);
        if (childSpec) {
          const sharesAfter = protoHasAdjacentTextOrChildAfter(protoNodes, i, spec.childPartByProtoComment);
          const isSole = protoIsSoleChildInParent(protoNodes, i, spec.childPartByProtoComment);
          const hydrated = hydrateChildValue(liveParent, cursorState, endBoundary, values[childSpec.valueIndex], disconnectRoot, ctx, sharesAfter, isSole);
          childBindings.push({ valueIndex: childSpec.valueIndex, slot: hydrated.slot });
        } else if (
          cursorState.textOffset === 0 &&
          cursorState.node &&
          cursorState.node !== endBoundary &&
          (cursorState.node.nodeType === 8 || cursorState.node.nodeType === 7) &&
          !isStartMarkerComment(cursorState.node) &&
          !isEndMarkerComment(cursorState.node)
        ) {
          cursorState.node = cursorState.node.nextSibling;
        }
        continue;
      }

      if (pNode.nodeType === 3) {
        const protoText = pNode.textContent ?? '';
        if (!protoText.length) continue;

        if (!protoText.trim().length) {
          if (cursorState.node && cursorState.node !== endBoundary && cursorState.node.nodeType === 3) {
            const liveText = cursorState.node as Text;
            const rem = liveText.data.slice(cursorState.textOffset);
            if (!rem.trim().length) {
              cursorState.node = liveText.nextSibling;
              cursorState.textOffset = 0;
            } else if (protoHasAdjacentTextOrChildAfter(protoNodes, i, spec.childPartByProtoComment) && rem.startsWith(protoText)) {
              recordSharedTextSegment(liveText, { kind: 'static', text: protoText });
              cursorState.textOffset += protoText.length;
              if (cursorState.textOffset >= liveText.data.length) {
                cursorState.node = liveText.nextSibling;
                cursorState.textOffset = 0;
              }
            }
          }
          continue;
        }

        while (
          cursorState.textOffset === 0 &&
          cursorState.node &&
          cursorState.node !== endBoundary &&
          (cursorState.node.nodeType === 8 || cursorState.node.nodeType === 7) &&
          !isStartMarkerComment(cursorState.node) &&
          !isEndMarkerComment(cursorState.node)
        ) {
          cursorState.node = cursorState.node.nextSibling;
        }

        if (cursorState.node && cursorState.node !== endBoundary && cursorState.node.nodeType === 3) {
          const liveText = cursorState.node as Text;
          const sharesAfter = protoHasAdjacentTextOrChildAfter(protoNodes, i, spec.childPartByProtoComment);
          const remLen = liveText.data.length - cursorState.textOffset;
          if ((cursorState.textOffset > 0 || (sharesAfter && remLen > protoText.length)) && remLen >= protoText.length) {
            recordSharedTextSegment(liveText, { kind: 'static', text: protoText });
            const nextOffset = cursorState.textOffset + protoText.length;
            if (nextOffset >= liveText.data.length) {
              cursorState.node = liveText.nextSibling;
              cursorState.textOffset = 0;
            } else {
              cursorState.textOffset = nextOffset;
            }
          } else {
            cursorState.node = liveText.nextSibling;
            cursorState.textOffset = 0;
          }
        }
        continue;
      }

      if (pNode.nodeType === 1) {
        if (cursorState.textOffset > 0 && cursorState.node) {
          cursorState.node = cursorState.node.nextSibling;
          cursorState.textOffset = 0;
        }
        while (
          cursorState.node &&
          cursorState.node !== endBoundary &&
          ((cursorState.node.nodeType === 3 && !(cursorState.node.textContent ?? '').trim().length) ||
            ((cursorState.node.nodeType === 8 || cursorState.node.nodeType === 7) && !isEndMarkerComment(cursorState.node)))
        ) {
          cursorState.node = cursorState.node.nextSibling;
        }

        if (cursorState.node && cursorState.node !== endBoundary && cursorState.node.nodeType === 1 && (cursorState.node as Element).localName === (pNode as Element).localName) {
          const liveElem = cursorState.node as Element;
          if (ctx.host && liveElem.hasAttribute('defer-hydration')) {
            liveElem.removeAttribute('defer-hydration');
          }
          const elemSpecs = spec.elementPartsByProtoNode.get(pNode as Element);
          if (elemSpecs) {
            for (let sIdx = 0; sIdx < elemSpecs.length; sIdx++) {
              elementBindings.push(createAndCommitElementBinding(liveElem, elemSpecs[sIdx], values, disconnectRoot, ctx, true));
            }
          }
          if (pNode.childNodes.length > 0) {
            const innerCursor = { node: liveElem.firstChild, textOffset: 0 };
            hydrateNodesInParent(liveElem, innerCursor, null, pNode.childNodes, spec, values, disconnectRoot, elementBindings, childBindings, ctx);
          }
          cursorState.node = liveElem.nextSibling;
          cursorState.textOffset = 0;
        }
      }
    }
  }

  function mountTemplateInstanceBefore(endAnchor: Comment, spec: any, values: unknown[], ctx: any): any {
    const disconnectRoot = new _$LH.ChildPart(null, null, undefined, ctx.renderOptions);
    const fragment = spec.tmpl.content.cloneNode(true) as DocumentFragment;
    const walkedNodes: Node[] = [];
    const walker = ctx.doc.createTreeWalker(fragment, 129);
    let n = walker.nextNode();
    while (n) {
      walkedNodes.push(n);
      n = walker.nextNode();
    }

    const realParent = endAnchor.parentNode!;
    const elementBindings: any[] = [];
    const childBindings: any[] = [];

    for (let i = 0; i < spec.partsInOrder.length; i++) {
      const entry = spec.partsInOrder[i];
      const targetNode = entry.nodeIndex >= 0 && entry.nodeIndex < walkedNodes.length ? walkedNodes[entry.nodeIndex] : null;
      if (!targetNode) continue;
      if (entry.isChild) {
        const fragParent = targetNode.parentNode;
        if (!fragParent) continue;
        (targetNode as Comment).data = '';
        const startAnchor = ctx.doc.createComment('');
        fragParent.insertBefore(startAnchor, targetNode);
        const slotParent = fragParent === fragment ? realParent : fragParent;
        const slot = createChildSlot(slotParent, startAnchor, targetNode as Comment, true, disconnectRoot, ctx);
        slot.renderPassCount = 2;
        updateChildSlot(slot, values[entry.spec.valueIndex], ctx);
        childBindings.push({ valueIndex: entry.spec.valueIndex, slot });
      } else {
        elementBindings.push(createAndCommitElementBinding(targetNode as Element, entry.spec, values, disconnectRoot, ctx, false));
      }
    }

    bindDataActionDelegation(fragment, ctx.host);
    const firstNode = fragment.firstChild;
    const lastNode = fragment.lastChild;
    realParent.insertBefore(fragment, endAnchor);
    return {
      spec,
      disconnectRoot,
      elementBindings,
      childBindings,
      firstNode,
      lastNode,
      isConnected: Boolean(ctx.renderOptions?.isConnected ?? true),
    };
  }

  function updateLiveTemplateInstance(instance: any, values: unknown[], ctx: any): void {
    for (let i = 0; i < instance.elementBindings.length; i++) {
      applyElementBindingValue(instance.elementBindings[i], values, false);
    }
    for (let i = 0; i < instance.childBindings.length; i++) {
      const cb = instance.childBindings[i];
      updateChildSlot(cb.slot, values[cb.valueIndex], ctx);
    }
  }

  function updateChildSlot(slot: any, rawValue: unknown, ctx: any, directiveParent?: any): void {
    slot.renderPassCount += 1;
    slot.inDirectiveResolve = true;
    let value: any;
    try {
      value = _$LH.resolveDirective(slot.helperChildPart, rawValue, directiveParent ?? slot.helperChildPart);
    } finally {
      slot.inDirectiveResolve = false;
    }

    if (value === noChange) {
      return;
    }

    if (value === null || value === undefined || value === nothing || value === '') {
      if (slot.state.kind === 'empty') {
        slot.rawCommitted = value ?? '';
        return;
      }
      if (slot.state.kind === 'shared-text' && slot.state.text === '') {
        slot.rawCommitted = value ?? '';
        return;
      }
      if (slot.state.kind === 'text' && slot.state.text === '') {
        slot.rawCommitted = value ?? '';
        return;
      }
      clearSlotDom(slot, ctx.doc);
      slot.state = { kind: 'empty' };
      slot.rawCommitted = value ?? '';
      return;
    }

    if (isTemplateLike(value)) {
      const nextSpec = getOrBuildTemplateSpec(value, ctx.doc);
      if (nextSpec) {
        const vals = Array.isArray(value.values) ? value.values : [];
        if (slot.state.kind === 'template' && slot.state.instance.spec === nextSpec) {
          updateLiveTemplateInstance(slot.state.instance, vals, ctx);
          return;
        }
        clearSlotDom(slot, ctx.doc);
        const mounted = mountTemplateInstanceBefore(slot.end, nextSpec, vals, ctx);
        slot.firstManagedNode = mounted.firstNode;
        slot.lastManagedNode = mounted.lastNode;
        slot.state = { kind: 'template', instance: mounted };
        return;
      }
    }

    if (isNonStringIterable(value)) {
      const nextItems = Array.from(value as Iterable<unknown>);

      // If `cache()` or `repeat()` or a prior pass already materialized `slot.committedParts`:
      if (Array.isArray(slot.committedParts)) {
        ensureSlotAnchors(slot, ctx.doc);
        const parts = slot.committedParts;
        const commonLen = Math.min(parts.length, nextItems.length);
        for (let i = 0; i < commonLen; i++) {
          const existingPart = parts[i];
          const mappedSlot = partToSlot.get(existingPart);
          if (mappedSlot) {
            updateChildSlot(mappedSlot, nextItems[i], ctx);
          } else {
            existingPart[setValueMethod](nextItems[i]);
          }
        }
        if (nextItems.length > parts.length) {
          const parent = slot.end.parentNode;
          if (parent) {
            for (let i = parts.length; i < nextItems.length; i++) {
              const iStart = ctx.doc.createComment('');
              const iEnd = ctx.doc.createComment('');
              parent.insertBefore(iStart, slot.end);
              parent.insertBefore(iEnd, slot.end);
              const itemSlot = createChildSlot(parent, iStart, iEnd, true, slot.disconnectRoot ?? slot.helperChildPart, ctx);
              itemSlot.renderPassCount = 2;
              updateChildSlot(itemSlot, nextItems[i], ctx);
              parts.push(itemSlot.helperChildPart);
            }
          }
        } else if (nextItems.length < parts.length) {
          for (let i = nextItems.length; i < parts.length; i++) {
            const deadPart = parts[i];
            const mappedSlot = partToSlot.get(deadPart);
            if (mappedSlot) {
              clearSlotDom(mappedSlot, ctx.doc);
              mappedSlot.start?.parentNode?.removeChild(mappedSlot.start);
              mappedSlot.end?.parentNode?.removeChild(mappedSlot.end);
            } else if (deadPart) {
              deadPart._$clear?.();
              deadPart[startNodeProp]?.remove?.();
              deadPart[endNodeProp]?.remove?.();
            }
          }
          parts.length = nextItems.length;
        }
        return;
      }

      if (slot.state.kind === 'iterable') {
        const prevSlots = slot.state.items;
        if (prevSlots.length === nextItems.length && slot.renderPassCount <= 1) {
          for (let i = 0; i < prevSlots.length; i++) {
            updateChildSlot(prevSlots[i], nextItems[i], ctx);
          }
          return;
        }
        // Materialize real ChildParts for pass 2+ iterable updates
        materializeIterableCommittedParts(slot, ctx);
        slot.renderPassCount -= 1;
        updateChildSlot(slot, nextItems, ctx);
        return;
      }

      clearSlotDom(slot, ctx.doc);
      const parent = slot.end.parentNode;
      const parts: any[] = [];
      const items: any[] = [];
      if (parent) {
        for (let i = 0; i < nextItems.length; i++) {
          const iStart = ctx.doc.createComment('');
          const iEnd = ctx.doc.createComment('');
          parent.insertBefore(iStart, slot.end);
          parent.insertBefore(iEnd, slot.end);
          const itemSlot = createChildSlot(parent, iStart, iEnd, true, slot.disconnectRoot ?? slot.helperChildPart, ctx);
          itemSlot.renderPassCount = 2;
          updateChildSlot(itemSlot, nextItems[i], ctx);
          items.push(itemSlot);
          parts.push(itemSlot.helperChildPart);
        }
      }
      slot.state = { kind: 'iterable', items };
      slot.committedParts = parts;
      return;
    }

    if (typeof Node !== 'undefined' && value instanceof Node) {
      if (slot.state.kind === 'node' && slot.state.node === value) {
        return;
      }
      clearSlotDom(slot, ctx.doc);
      slot.end.parentNode?.insertBefore(value, slot.end);
      slot.firstManagedNode = value;
      slot.lastManagedNode = value;
      slot.state = { kind: 'node', node: value };
      slot.rawCommitted = value;
      return;
    }

    // Primitive or generic Object / Function stringified
    if (isPrimitive(value) && Object.is(slot.rawCommitted, value) && (slot.state.kind === 'text' || slot.state.kind === 'shared-text')) {
      return;
    }

    const nextStr = String(value);
    if (slot.state.kind === 'shared-text') {
      if (slot.state.text === nextStr) {
        slot.rawCommitted = isPrimitive(value) ? value : nextStr;
        return;
      }
      if (slot.state.node) {
        materializeSharedTextNode(slot.state.node, ctx.doc);
      }
    }

    if (slot.state.kind === 'text' && slot.state.node && slot.state.node.parentNode) {
      if (slot.state.text !== nextStr) {
        slot.state.node.data = nextStr;
        slot.state.text = nextStr;
      }
      slot.rawCommitted = isPrimitive(value) ? value : nextStr;
      return;
    }

    clearSlotDom(slot, ctx.doc);
    const textNode = ctx.doc.createTextNode(nextStr);
    slot.end.parentNode?.insertBefore(textNode, slot.end);
    slot.firstManagedNode = textNode;
    slot.lastManagedNode = textNode;
    slot.state = { kind: 'text', text: nextStr, node: textNode };
    slot.rawCommitted = isPrimitive(value) ? value : nextStr;
  }

  function hydrateInternal(templateResult: unknown, container: any, options: any = {}): any {
    const doc = container.ownerDocument ?? document;
    const renderOptions = {
      ...options,
      host: options.host,
      isConnected: options.isConnected ?? true,
    };
    const ctx = {
      doc,
      host: options.host,
      renderOptions,
    };

    bindDataActionDelegation(container, options.host);

    let templateStartsWithStyle = false;
    if (isTemplateLike(templateResult)) {
      const spec = getOrBuildTemplateSpec(templateResult, doc);
      if (spec) {
        templateStartsWithStyle = spec.startsWithStyle;
      }
    }

    let firstContentNode: Node | null = container.firstChild;
    if (!templateStartsWithStyle) {
      while (firstContentNode) {
        if (firstContentNode.nodeType === 1 && (firstContentNode as Element).localName === 'style') {
          firstContentNode = firstContentNode.nextSibling;
          continue;
        }
        if (firstContentNode.nodeType === 3 && !(firstContentNode.textContent ?? '').trim().length) {
          const next = firstContentNode.nextSibling;
          if (next && next.nodeType === 1 && (next as Element).localName === 'style') {
            firstContentNode = next.nextSibling;
            continue;
          }
        }
        break;
      }
    }

    const endBoundary = options.renderBefore ?? null;
    const cursorState = { node: firstContentNode, textOffset: 0 };
    const hydrated = hydrateChildValue(container, cursorState, endBoundary, templateResult, null, ctx, false);

    const rootController: any = {
      type: 2,
      options: renderOptions,
      get parentNode() {
        return container;
      },
      get startNode() {
        return hydrated.slot.start;
      },
      get endNode() {
        return hydrated.slot.end;
      },
      setConnected(isConnected: boolean) {
        ctx.renderOptions.isConnected = isConnected;
        setSlotConnected(hydrated.slot, isConnected);
      },
    };
    rootController[setValueMethod] = (nextValue: unknown) => {
      updateChildSlot(hydrated.slot, nextValue, ctx);
    };

    return {
      container,
      rootSlot: hydrated.slot,
      ctx,
      rootPart: rootController,
    };
  }

  function hydrate(rootValue: unknown, container: any, options: any = {}): any {
    if (!container) {
      throw new TypeError(`The container to hydrate into may not be ${container}`);
    }
    const partOwnerNode = options?.renderBefore ?? container;
    if (partOwnerNode._$litPart$ !== undefined) {
      throw new Error('container already contains a live render');
    }
    const hydrated = hydrateInternal(rootValue, container, options);
    partOwnerNode._$litPart$ = hydrated.rootPart;
    return hydrated.rootPart;
  }

  function hydrateTemplateRoot(templateResult: unknown, container: any, options: any = {}): any {
    if (!container) return null;
    const partOwnerNode = options?.renderBefore ?? container;
    const hydrated = hydrateInternal(templateResult, container, options);
    partOwnerNode._$litPart$ = hydrated.rootPart;
    return hydrated;
  }

  function updateHydratedRoot(hydrated: any, nextResult: unknown): boolean {
    if (!hydrated?.rootSlot) return false;
    updateChildSlot(hydrated.rootSlot, nextResult, hydrated.ctx);
    return true;
  }

  function bindTemplateEventHandlers(shadowRoot: any, templateResult: any, host: any): any {
    return hydrateTemplateRoot(templateResult, shadowRoot, { host });
  }

  function hydrateShadowRoots(root: any = document): void {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const templates = root.querySelectorAll('template[shadowrootmode], template[shadowroot]');
    templates.forEach((tmpl: any) => {
      const parent = tmpl.parentElement;
      if (!parent) return;
      const modeAttr = tmpl.getAttribute('shadowrootmode') || tmpl.getAttribute('shadowroot');
      const mode = modeAttr === 'closed' ? 'closed' : 'open';
      const delegatesFocus = tmpl.hasAttribute('shadowrootdelegatesfocus');
      const shadow = parent.shadowRoot ?? parent.attachShadow({ mode, delegatesFocus });
      shadow.appendChild(tmpl.content);
      tmpl.remove();
      hydrateShadowRoots(shadow);
    });
  }

  function digestForTemplateResult(templateResult: any): string {
    const strings = templateResult?.strings;
    if (!strings) return '';
    let digest = digestCache.get(strings);
    if (digest !== undefined) return digest;
    const hashes = new Uint32Array(2).fill(5381);
    for (const s of strings) {
      for (let i = 0; i < s.length; i++) {
        hashes[i % 2] = (hashes[i % 2] * 33) ^ s.charCodeAt(i);
      }
    }
    const bytes = new Uint8Array(hashes.buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    digest = typeof btoa === 'function' ? btoa(str) : str;
    digestCache.set(strings, digest);
    return digest;
  }

  function migrateLeadingStylesForDomPaths(host: any, renderRoot: any, templateResult: unknown): void {
    if (!Array.isArray(host?.constructor?.__litPartPaths) || typeof CSSStyleSheet !== 'function') {
      return;
    }
    if (!renderRoot || !('adoptedStyleSheets' in renderRoot)) {
      return;
    }
    const doc = renderRoot.ownerDocument ?? document;
    if (isTemplateLike(templateResult)) {
      const spec = getOrBuildTemplateSpec(templateResult as any, doc);
      if (spec?.startsWithStyle) return;
    }
    const sheetsToAdopt: CSSStyleSheet[] = [];
    const nodesToRemove: Node[] = [];
    let cur = renderRoot.firstChild;
    while (cur) {
      if (cur.nodeType === 1 && (cur as Element).localName === 'style') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cur.textContent ?? '');
        sheetsToAdopt.push(sheet);
        nodesToRemove.push(cur);
        cur = cur.nextSibling;
        continue;
      }
      if (cur.nodeType === 3 && !(cur.textContent ?? '').trim().length) {
        const next = cur.nextSibling;
        if (next && next.nodeType === 1 && (next as Element).localName === 'style') {
          nodesToRemove.push(cur);
          cur = next;
          continue;
        }
      }
      break;
    }
    if (sheetsToAdopt.length > 0) {
      const existing = Array.isArray(renderRoot.adoptedStyleSheets) ? renderRoot.adoptedStyleSheets : [];
      renderRoot.adoptedStyleSheets = [...existing, ...sheetsToAdopt];
      for (const n of nodesToRemove) {
        n.parentNode?.removeChild(n);
      }
    }
  }

  function findReactiveSuperUpdate(proto: any): ((changedProperties: Map<PropertyKey, unknown>) => void) | null {
    let cur = Object.getPrototypeOf(proto);
    while (cur && cur !== Object.prototype && (typeof HTMLElement === 'undefined' || cur !== HTMLElement.prototype)) {
      if (Object.hasOwn(cur, 'update') && typeof cur.update === 'function' && !Object.hasOwn(cur, 'render')) {
        return cur.update;
      }
      cur = Object.getPrototypeOf(cur);
    }
    return null;
  }

  function stripHydrateInternalsAttributes(host: any): void {
    if (typeof host.getAttributeNames !== 'function') return;
    const names = host.getAttributeNames();
    for (let i = 0; i < names.length; i++) {
      const attrName = names[i];
      if (attrName.startsWith(HYDRATE_INTERNALS_ATTR_PREFIX)) {
        const ariaAttr = attrName.slice(HYDRATE_INTERNALS_ATTR_PREFIX.length);
        host.removeAttribute(ariaAttr);
        host.removeAttribute(attrName);
      }
    }
  }

  function patchLitElementClass(LitElement: any): void {
    if (!LitElement || !LitElement.prototype || patchedLitElementClasses.has(LitElement)) {
      return;
    }
    patchedLitElementClasses.add(LitElement);
    patchedPrototypes.add(LitElement.prototype);

    let observedGet: (() => string[] | undefined) | null = null;
    for (let c = LitElement; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
      const desc = Object.getOwnPropertyDescriptor(c, 'observedAttributes');
      if (desc && typeof desc.get === 'function') {
        observedGet = desc.get;
        break;
      }
    }
    if (observedGet) {
      const baseGetter = observedGet;
      Object.defineProperty(LitElement, 'observedAttributes', {
        configurable: true,
        get() {
          const base = baseGetter.call(this) || [];
          return base.includes('defer-hydration') ? base : [...base, 'defer-hydration'];
        },
      });
    }

    const origConnectedCallback = LitElement.prototype.connectedCallback;
    const origDisconnectedCallback = LitElement.prototype.disconnectedCallback;
    const origAttributeChangedCallback = LitElement.prototype.attributeChangedCallback;
    const origCreateRenderRoot = LitElement.prototype.createRenderRoot;
    const origLitUpdate = LitElement.prototype.update;
    const reactiveSuperUpdate = findReactiveSuperUpdate(LitElement.prototype) ?? Object.getPrototypeOf(LitElement.prototype)?.update;

    LitElement.prototype.attributeChangedCallback = function (name: string, old: string | null, value: string | null) {
      if (name === 'defer-hydration' && value === null) {
        restoreStateFromHostAttribute(this);
        if (typeof origConnectedCallback === 'function') {
          origConnectedCallback.call(this);
        }
        this._$hydratedChildPart?.setConnected(true);
      }
      if (typeof origAttributeChangedCallback === 'function') {
        origAttributeChangedCallback.call(this, name, old, value);
      }
    };

    LitElement.prototype.connectedCallback = function () {
      if (!this.hasAttribute('defer-hydration')) {
        restoreStateFromHostAttribute(this);
        if (typeof origConnectedCallback === 'function') {
          origConnectedCallback.call(this);
        }
        this._$hydratedChildPart?.setConnected(true);
      }
    };

    if (typeof origDisconnectedCallback === 'function') {
      LitElement.prototype.disconnectedCallback = function () {
        origDisconnectedCallback.call(this);
        this._$hydratedChildPart?.setConnected(false);
      };
    }

    LitElement.prototype.createRenderRoot = function () {
      if (this.shadowRoot) {
        this._$needsHydration = true;
        return this.shadowRoot;
      }
      return typeof origCreateRenderRoot === 'function' ? origCreateRenderRoot.call(this) : this.attachShadow({ mode: 'open' });
    };

    LitElement.prototype.update = function (changedProperties: Map<PropertyKey, unknown>) {
      this.renderOptions ??= { host: this };
      if (this._$needsHydration) {
        this._$needsHydration = false;
        stripHydrateInternalsAttributes(this);

        // If `update()` was invoked directly in a unit test without going through `performUpdate()`
        const directCall = !this.isUpdatePending && !this.hasUpdated;
        if (directCall && typeof this.willUpdate === 'function') {
          this.willUpdate(changedProperties);
        }

        const value = typeof this.render === 'function' ? this.render() : noChange;
        if (!this.hasUpdated && this.renderOptions) {
          this.renderOptions.isConnected = this.isConnected;
        }
        if (typeof reactiveSuperUpdate === 'function') {
          reactiveSuperUpdate.call(this, changedProperties);
        }

        const renderRoot = this.renderRoot || this.shadowRoot;
        // If a subclass manually called `attachShadow` in its constructor on a client-created element
        // (empty shadowRoot, non-empty template), fall back to standard Lit render.
        let shouldHydrate = true;
        if (renderRoot && renderRoot.childNodes.length === 0 && isTemplateLike(value)) {
          const doc = renderRoot.ownerDocument ?? document;
          const spec = getOrBuildTemplateSpec(value, doc);
          if (spec && spec.tmpl.content.childNodes.length > 0) {
            shouldHydrate = false;
          }
        }

        if (shouldHydrate && renderRoot) {
          migrateLeadingStylesForDomPaths(this, renderRoot, value);
          this._$hydratedChildPart = hydrate(value, renderRoot, this.renderOptions ?? { host: this });
        } else if (typeof origLitUpdate === 'function') {
          origLitUpdate.call(this, changedProperties);
        }

        if (directCall) {
          this.hasUpdated = true;
          this.firstUpdated?.(changedProperties);
          this.updated?.(changedProperties);
        }
        return;
      }

      this._$hydratedChildPart = undefined;
      if (typeof origLitUpdate === 'function') {
        origLitUpdate.call(this, changedProperties);
      }
    };
  }

  function patchPrototypeForHydration(targetProto: any): void {
    if (!targetProto || patchedPrototypes.has(targetProto)) {
      return;
    }
    let cur: any = targetProto.constructor;
    while (cur && cur !== Function.prototype) {
      if (Object.hasOwn(cur, '_$litElement$')) {
        patchLitElementClass(cur);
        return;
      }
      cur = Object.getPrototypeOf(cur);
    }
    if (targetProto.constructor) {
      patchLitElementClass(targetProto.constructor);
    }
  }

  function withResumable<T extends new (...args: any[]) => any>(Base: T): T {
    let cur: any = Base;
    while (cur && cur !== Function.prototype) {
      if (Object.hasOwn(cur, '_$litElement$')) {
        patchLitElementClass(cur);
        break;
      }
      cur = Object.getPrototypeOf(cur);
    }
    return class extends Base {
      connectedCallback() {
        if (!this.hasAttribute('defer-hydration')) {
          restoreStateFromHostAttribute(this);
        }
        if (typeof super.connectedCallback === 'function') {
          super.connectedCallback();
        }
      }
    };
  }

  function installLitHydrationSupport(LitElementOrReactiveElementClass?: any): void {
    const g = globalThis as any;
    g.litElementHydrateSupport = ({ LitElement }: { LitElement: any }) => {
      if (LitElement) {
        patchLitElementClass(LitElement);
      }
    };

    if (typeof customElements !== 'undefined' && !(customElements as any).__litHydratePatched) {
      (customElements as any).__litHydratePatched = true;
      const origDefine = customElements.define;
      customElements.define = function (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) {
        let curr: any = ctor;
        while (curr && curr !== Function.prototype && (typeof HTMLElement === 'undefined' || curr !== HTMLElement)) {
          if (Object.hasOwn(curr, '_$litElement$')) {
            patchLitElementClass(curr);
            break;
          }
          curr = Object.getPrototypeOf(curr);
        }
        return origDefine.call(this, name, ctor, options);
      };
    }

    if (LitElementOrReactiveElementClass) {
      const ctor = typeof LitElementOrReactiveElementClass === 'function' ? LitElementOrReactiveElementClass : LitElementOrReactiveElementClass.constructor;
      if (ctor) {
        patchPrototypeForHydration(ctor.prototype);
      }
    } else if (typeof window !== 'undefined' && (window as any).LitElement) {
      patchLitElementClass((window as any).LitElement);
    }
  }

  const installResumableAdapter = installLitHydrationSupport;

  function createReplayedEvent(origEvent: any): Event {
    const type = origEvent.type;
    const baseInit = {
      bubbles: origEvent.bubbles ?? true,
      cancelable: origEvent.cancelable ?? true,
      composed: origEvent.composed ?? true,
    };
    let replayed: Event;
    try {
      if (typeof PointerEvent !== 'undefined' && origEvent instanceof PointerEvent) {
        replayed = new PointerEvent(type, {
          ...baseInit,
          clientX: origEvent.clientX,
          clientY: origEvent.clientY,
          screenX: origEvent.screenX,
          screenY: origEvent.screenY,
          button: origEvent.button,
          buttons: origEvent.buttons,
          ctrlKey: origEvent.ctrlKey,
          shiftKey: origEvent.shiftKey,
          altKey: origEvent.altKey,
          metaKey: origEvent.metaKey,
          pointerId: origEvent.pointerId,
          pointerType: origEvent.pointerType,
          pressure: origEvent.pressure,
          tiltX: origEvent.tiltX,
          tiltY: origEvent.tiltY,
          width: origEvent.width,
          height: origEvent.height,
          isPrimary: origEvent.isPrimary,
        });
      } else if (typeof MouseEvent !== 'undefined' && origEvent instanceof MouseEvent) {
        replayed = new MouseEvent(type, {
          ...baseInit,
          clientX: origEvent.clientX,
          clientY: origEvent.clientY,
          screenX: origEvent.screenX,
          screenY: origEvent.screenY,
          button: origEvent.button,
          buttons: origEvent.buttons,
          ctrlKey: origEvent.ctrlKey,
          shiftKey: origEvent.shiftKey,
          altKey: origEvent.altKey,
          metaKey: origEvent.metaKey,
        });
      } else if (typeof KeyboardEvent !== 'undefined' && origEvent instanceof KeyboardEvent) {
        replayed = new KeyboardEvent(type, {
          ...baseInit,
          key: origEvent.key,
          code: origEvent.code,
          location: origEvent.location,
          ctrlKey: origEvent.ctrlKey,
          shiftKey: origEvent.shiftKey,
          altKey: origEvent.altKey,
          metaKey: origEvent.metaKey,
          repeat: origEvent.repeat,
        });
      } else if (typeof FocusEvent !== 'undefined' && origEvent instanceof FocusEvent) {
        replayed = new FocusEvent(type, {
          ...baseInit,
          relatedTarget: origEvent.relatedTarget,
        });
      } else if (typeof CustomEvent !== 'undefined') {
        replayed = new CustomEvent(type, {
          ...baseInit,
          detail: origEvent.detail,
        });
      } else {
        replayed = new Event(type, baseInit);
      }
    } catch {
      replayed = new CustomEvent(type, baseInit);
    }
    Object.defineProperty(replayed, RESUMED_EVENT_FLAG, {
      value: true,
      enumerable: false,
      configurable: true,
    });
    return replayed;
  }

  function replayEvent(buffered: { event: Event; target?: Element | null; host?: Element | null }): boolean {
    const { event: origEvent, target, host } = buffered;
    const dispatchTarget = target && target.isConnected ? target : host;
    if (!dispatchTarget || typeof dispatchTarget.dispatchEvent !== 'function') {
      return false;
    }
    const replayed = createReplayedEvent(origEvent);
    return dispatchTarget.dispatchEvent(replayed);
  }

  function replayQueue(queue: Array<{ event: Event; target?: Element | null; host?: Element | null }>): void {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item) {
        replayEvent(item);
      }
    }
  }

  return {
    RESUMED_EVENT_FLAG,
    parseComponentState,
    restoreComponentState,
    restoreStateFromHostAttribute,
    hydrate,
    hydrateTemplateRoot,
    updateHydratedRoot,
    bindTemplateEventHandlers,
    bindDataActionDelegation,
    hydrateShadowRoots,
    digestForTemplateResult,
    withResumable,
    patchPrototypeForHydration,
    installLitHydrationSupport,
    installResumableAdapter,
    createReplayedEvent,
    replayEvent,
    replayQueue,
  };
}
