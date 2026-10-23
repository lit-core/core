/**
 * Parse state from serialized script text content.
 */
export function parseComponentState(scriptContent: string): Record<string, unknown> {
  if (!scriptContent?.trim()) {
    return {};
  }
  return JSON.parse(scriptContent.trim());
}

export interface ResumableElement extends HTMLElement {
  hasUpdated?: boolean;
  renderRoot?: DocumentFragment | HTMLElement;
  render?: () => any;
  update?: (changedProperties: Map<PropertyKey, unknown>) => void;
  willUpdate?: (changedProperties: Map<PropertyKey, unknown>) => void;
  firstUpdated?: (changedProperties: Map<PropertyKey, unknown>) => void;
  updated?: (changedProperties: Map<PropertyKey, unknown>) => void;
  connectedCallback?: () => void;
}

/**
 * Extract and restore reactive properties from <script type="lit/state"> inside the element.
 */
export function restoreComponentState(host: HTMLElement): Record<string, unknown> | null {
  if (!host || typeof host.querySelector !== 'function') {
    return null;
  }

  // Look for direct child script with type="lit/state"
  let stateScript: HTMLScriptElement | null = null;
  const children = host.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName.toLowerCase() === 'script' && child.getAttribute('type') === 'lit/state') {
      stateScript = child as HTMLScriptElement;
      break;
    }
  }

  if (!stateScript?.textContent) {
    return null;
  }

  try {
    const state = parseComponentState(stateScript.textContent);
    for (const [key, value] of Object.entries(state)) {
      try {
        (host as any)[key] = value;
      } catch {
        // In case property is read-only
      }
    }
    // Remove state script from DOM to maintain clean tree
    stateScript.remove();
    return state;
  } catch (err) {
    console.error('[resumable] Failed to parse lit/state snapshot:', err);
    return null;
  }
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

interface FlatTemplate {
  strings: string[];
  values: unknown[];
}

interface TemplateBinding {
  exprIndex: number;
  elementIndex: number;
  kind: 'event' | 'boolean-attr' | 'prop' | 'attr' | 'child';
  name?: string;
  prefix?: string;
  suffix?: string;
  isSoleTextChild?: boolean;
}

function compiledToStandard(tpl: any): FlatTemplate {
  const litType = tpl._$litType$;
  const values = Array.isArray(tpl.values) ? tpl.values : [];
  const htmlText = typeof litType.h === 'string' ? litType.h : Array.isArray(litType.h) ? (litType.h[0] ?? '') : String(litType.h ?? '');
  const parts = Array.isArray(litType.parts) ? litType.parts : [];
  const attrPartsByElem = new Map<number, Array<{ part: any; partIndex: number }>>();
  const childPartsInOrder: Array<{ part: any; partIndex: number }> = [];

  for (let pIdx = 0; pIdx < parts.length; pIdx++) {
    const p = parts[pIdx];
    if (p.type === 1) {
      let list = attrPartsByElem.get(p.index);
      if (!list) {
        list = [];
        attrPartsByElem.set(p.index, list);
      }
      list.push({ part: p, partIndex: pIdx });
    } else if (p.type === 2) {
      childPartsInOrder.push({ part: p, partIndex: pIdx });
    }
  }

  const strings: string[] = [];
  const outValues: unknown[] = [];
  let curStr = '';
  let childCursor = 0;
  let nodeIndex = -1;
  let i = 0;
  const len = htmlText.length;

  while (i < len) {
    if (i + 2 < len && htmlText[i] === '<' && htmlText[i + 1] === '?' && htmlText[i + 2] === '>') {
      nodeIndex++;
      strings.push(curStr);
      curStr = '';
      const childInfo = childPartsInOrder[childCursor++];
      outValues.push(childInfo ? values[childInfo.partIndex] : '');
      i += 3;
      continue;
    }
    if (i + 6 < len && htmlText.slice(i, i + 7) === '<!---->') {
      nodeIndex++;
      strings.push(curStr);
      curStr = '';
      const childInfo = childPartsInOrder[childCursor++];
      outValues.push(childInfo ? values[childInfo.partIndex] : '');
      i += 7;
      continue;
    }
    if (htmlText[i] === '<' && i + 1 < len && /[a-zA-Z_]/.test(htmlText[i + 1])) {
      nodeIndex++;
      const elemAttrs = attrPartsByElem.get(nodeIndex);
      if (elemAttrs && elemAttrs.length > 0) {
        let tagEnd = i + 1;
        let inQuote: string | null = null;
        while (tagEnd < len) {
          const ch = htmlText[tagEnd];
          if (inQuote) {
            if (ch === inQuote) inQuote = null;
          } else if (ch === '"' || ch === "'") {
            inQuote = ch;
          } else if (ch === '>') {
            break;
          }
          tagEnd++;
        }
        if (tagEnd < len) {
          const isSelfClose = htmlText[tagEnd - 1] === '/';
          const insertAt = isSelfClose ? tagEnd - 1 : tagEnd;
          curStr += htmlText.slice(i, insertAt);
          for (const { part, partIndex } of elemAttrs) {
            const ctorName = part.ctor?.name ? String(part.ctor.name) : '';
            const valAtPart = values[partIndex];
            const ctorType =
              part.ctorType ??
              (part.name?.startsWith('?') || ctorName.includes('Boolean')
                ? 4
                : part.name?.startsWith('@') || ctorName.includes('Event') || typeof valAtPart === 'function'
                  ? 5
                  : part.name?.startsWith('.') || ctorName.includes('Property')
                    ? 3
                    : 1);
            const rawName = (part.name || '').replace(/^[?@.]/, '');
            const prefix = ctorType === 4 ? '?' : ctorType === 5 ? '@' : ctorType === 3 ? '.' : '';
            curStr += ` ${prefix}${rawName}=`;
            strings.push(curStr);
            outValues.push(valAtPart);
            curStr = '';
          }
          curStr += isSelfClose ? '/>' : '>';
          i = tagEnd + 1;
          continue;
        }
      }
    }
    curStr += htmlText[i];
    i++;
  }
  strings.push(curStr);
  return { strings, values: outValues };
}

export function flattenTemplateResult(tpl: any): FlatTemplate | null {
  if (!tpl || typeof tpl !== 'object') {
    return null;
  }
  let base: FlatTemplate | null = null;
  if (Array.isArray(tpl.strings) && Array.isArray(tpl.values)) {
    base = { strings: Array.from(tpl.strings), values: Array.from(tpl.values) };
  } else if (tpl._$litType$ && typeof tpl._$litType$ === 'object' && 'h' in tpl._$litType$) {
    base = compiledToStandard(tpl);
  } else {
    return null;
  }

  const flatStrings: string[] = [];
  const flatValues: unknown[] = [];
  let accString = base.strings[0] ?? '';

  for (let i = 0; i < base.values.length; i++) {
    const val = base.values[i];
    const nextString = base.strings[i + 1] ?? '';
    const nested = flattenTemplateResult(val);
    if (nested) {
      accString += nested.strings[0] ?? '';
      for (let j = 0; j < nested.values.length; j++) {
        flatStrings.push(accString);
        flatValues.push(nested.values[j]);
        accString = nested.strings[j + 1] ?? '';
      }
      accString += nextString;
    } else if (Array.isArray(val) && val.length > 0 && val.every((item) => flattenTemplateResult(item) !== null)) {
      for (const item of val) {
        const itemFlat = flattenTemplateResult(item);
        if (itemFlat) {
          accString += itemFlat.strings[0] ?? '';
          for (let j = 0; j < itemFlat.values.length; j++) {
            flatStrings.push(accString);
            flatValues.push(itemFlat.values[j]);
            accString = itemFlat.strings[j + 1] ?? '';
          }
        }
      }
      accString += nextString;
    } else {
      flatStrings.push(accString);
      flatValues.push(val);
      accString = nextString;
    }
  }
  flatStrings.push(accString);
  return { strings: flatStrings, values: flatValues };
}

function parseTemplateBindings(flat: FlatTemplate): TemplateBinding[] {
  const { strings, values } = flat;
  const bindings: TemplateBinding[] = [];
  let currentElementIndex = -1;
  const openStack: number[] = [];
  let inOpenTag = false;
  let currentTagName = '';
  let quoteChar: string | null = null;
  const attrMatchRegex = /(?:^|\s)([?@.]?[a-zA-Z0-9_.:-]+)=\s*(["']?)([^"']*)$/;

  for (let i = 0; i < values.length; i++) {
    const chunk = strings[i] ?? '';
    let j = 0;
    let lastGtIndex = -1;
    while (j < chunk.length) {
      const ch = chunk[j];
      if (inOpenTag) {
        if (quoteChar) {
          if (ch === quoteChar) quoteChar = null;
        } else if (ch === '"' || ch === "'") {
          quoteChar = ch;
        } else if (ch === '>') {
          const isSelfClosing = j > 0 && chunk[j - 1] === '/';
          inOpenTag = false;
          lastGtIndex = j;
          if (isSelfClosing || VOID_TAGS.has(currentTagName)) {
            openStack.pop();
          }
        }
        j++;
      } else {
        if (ch === '<') {
          if (chunk.slice(j, j + 4) === '<!--') {
            const endComment = chunk.indexOf('-->', j + 4);
            if (endComment !== -1) {
              j = endComment + 3;
              continue;
            }
          }
          const closeMatch = /^<\/\s*([a-zA-Z][a-zA-Z0-9._-]*)\s*>/.exec(chunk.slice(j));
          if (closeMatch) {
            openStack.pop();
            j += closeMatch[0].length;
            lastGtIndex = j - 1;
            continue;
          }
          const openMatch = /^<([a-zA-Z][a-zA-Z0-9._-]*)(?=[\s>/]|$)/.exec(chunk.slice(j));
          if (openMatch) {
            currentTagName = openMatch[1].toLowerCase();
            currentElementIndex++;
            openStack.push(currentElementIndex);
            inOpenTag = true;
            quoteChar = null;
            j += openMatch[0].length;
            continue;
          }
        }
        j++;
      }
    }

    if (inOpenTag) {
      const attrMatch = attrMatchRegex.exec(chunk);
      if (attrMatch) {
        const rawAttr = attrMatch[1];
        const openQuote = attrMatch[2];
        const attrPrefix = attrMatch[3] || '';
        if (openQuote && quoteChar === openQuote) {
          quoteChar = null;
        }
        const kind = rawAttr.startsWith('@') ? 'event' : rawAttr.startsWith('?') ? 'boolean-attr' : rawAttr.startsWith('.') ? 'prop' : 'attr';
        const name = rawAttr.replace(/^[?@.]/, '');
        bindings.push({
          exprIndex: i,
          elementIndex: currentElementIndex,
          kind,
          name,
          prefix: attrPrefix,
        });
      }
    } else {
      const parentElemIndex = openStack.length > 0 ? openStack[openStack.length - 1] : -1;
      const textPrefix = lastGtIndex !== -1 ? chunk.slice(lastGtIndex + 1) : chunk;
      const nextChunk = strings[i + 1] ?? '';
      const nextLtIndex = nextChunk.indexOf('<');
      const textSuffix = nextLtIndex !== -1 ? nextChunk.slice(0, nextLtIndex) : nextChunk;
      const isClosedImmediately = nextLtIndex !== -1 && nextChunk.slice(nextLtIndex, nextLtIndex + 2) === '</';
      const isSoleTextChild = lastGtIndex !== -1 && isClosedImmediately && !textPrefix.includes('<');
      bindings.push({
        exprIndex: i,
        elementIndex: parentElemIndex,
        kind: 'child',
        prefix: textPrefix,
        suffix: textSuffix,
        isSoleTextChild,
      });
    }
  }
  return bindings;
}

/**
 * Scan a TemplateResult or CompiledTemplateResult for event handlers and bind them to matching DOM nodes in shadow root.
 */
export function bindTemplateEventHandlers(shadowRoot: DocumentFragment | HTMLElement, templateResult: any, host: any): void {
  // Bind data-action delegation (@lit-core/event-hoist integration)
  const actionElements = shadowRoot.querySelectorAll('[data-action]');
  actionElements.forEach((el: any) => {
    const actionName = el.getAttribute('data-action');
    if (actionName && typeof host[actionName] === 'function') {
      if (!el.__litActionBound) {
        el.__litActionBound = true;
        el.addEventListener('click', (e: Event) => host[actionName](e));
      }
    }
  });

  const flat = flattenTemplateResult(templateResult);
  if (!flat) {
    return;
  }

  const hasStyleInTemplate = /<style[\s>]/i.test(flat.strings.join(''));
  const allElements = Array.from(shadowRoot.querySelectorAll('*')).filter((el) => hasStyleInTemplate || el.tagName.toLowerCase() !== 'style') as any[];
  const bindings = parseTemplateBindings(flat);

  for (const b of bindings) {
    if (b.kind === 'event' && b.name) {
      const handler = flat.values[b.exprIndex];
      if (typeof handler === 'function' && allElements.length > 0 && b.elementIndex >= 0) {
        const targetEl = allElements[Math.min(b.elementIndex, allElements.length - 1)];
        if (targetEl) {
          if (!targetEl.__litResumedEvents) {
            targetEl.__litResumedEvents = new Set<string>();
          }
          if (!targetEl.__litResumedEvents.has(b.name)) {
            targetEl.__litResumedEvents.add(b.name);
            targetEl.addEventListener(b.name, handler.bind(host));
          }
        }
      }
    }
  }
}

function updateResumableDomInPlace(shadowRoot: DocumentFragment | HTMLElement, prevFlat: FlatTemplate, nextFlat: FlatTemplate): boolean {
  if (!prevFlat || !nextFlat || prevFlat.strings.length !== nextFlat.strings.length) {
    return false;
  }
  for (let i = 0; i < prevFlat.strings.length; i++) {
    if (prevFlat.strings[i] !== nextFlat.strings[i]) {
      return false;
    }
  }
  const hasStyleInTemplate = /<style[\s>]/i.test(nextFlat.strings.join(''));
  const allElements = Array.from(shadowRoot.querySelectorAll('*')).filter((el) => hasStyleInTemplate || el.tagName.toLowerCase() !== 'style') as any[];
  const bindings = parseTemplateBindings(nextFlat);

  for (const b of bindings) {
    const prevVal = prevFlat.values[b.exprIndex];
    const nextVal = nextFlat.values[b.exprIndex];
    if (Object.is(prevVal, nextVal) || b.kind === 'event') {
      continue;
    }
    if (typeof nextVal === 'object' && nextVal !== null) {
      return false;
    }
    if (b.elementIndex < 0 || b.elementIndex >= allElements.length) {
      return false;
    }
    if (b.kind === 'child' && !b.isSoleTextChild) {
      return false;
    }
  }

  for (const b of bindings) {
    const prevVal = prevFlat.values[b.exprIndex];
    const nextVal = nextFlat.values[b.exprIndex];
    if (Object.is(prevVal, nextVal) || b.kind === 'event') {
      continue;
    }
    const targetEl = allElements[b.elementIndex];
    if (!targetEl) continue;
    if (b.kind === 'boolean-attr' && b.name) {
      if (nextVal) {
        targetEl.setAttribute(b.name, '');
      } else {
        targetEl.removeAttribute(b.name);
      }
    } else if (b.kind === 'prop' && b.name) {
      targetEl[b.name] = nextVal;
    } else if (b.kind === 'attr' && b.name) {
      if (nextVal === null || nextVal === undefined || nextVal === false) {
        targetEl.removeAttribute(b.name);
      } else {
        targetEl.setAttribute(b.name, (b.prefix || '') + String(nextVal));
      }
    } else if (b.kind === 'child') {
      const nextText = (b.prefix || '') + String(nextVal ?? '') + (b.suffix || '');
      if (targetEl.firstChild && targetEl.firstChild.nodeType === 3 && targetEl.childNodes.length === 1) {
        targetEl.firstChild.data = nextText;
      } else {
        targetEl.textContent = nextText;
      }
    }
  }
  return true;
}

function clearStaticSsrNodes(root: any): void {
  if (!root || root._$litPart$ || !root.childNodes) {
    return;
  }
  const nodes = Array.from(root.childNodes) as any[];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.nodeType === 1 && node.tagName && node.tagName.toLowerCase() === 'style') {
      continue;
    }
    if (typeof node.remove === 'function') {
      node.remove();
    } else if (typeof root.removeChild === 'function') {
      root.removeChild(node);
    }
  }
}

/**
 * Class mixin adding resumable hydration-free upgrade to any LitElement or ReactiveElement.
 */
export function withResumable<T extends new (...args: any[]) => any>(Base: T): T {
  return class extends Base {
    connectedCallback() {
      // 1. Restore state from snapshot before initial render
      restoreComponentState(this as unknown as HTMLElement);

      if (typeof super.connectedCallback === 'function') {
        super.connectedCallback();
      }

      if (typeof (this as any).requestUpdate === 'function') {
        (this as any).requestUpdate();
      }
    }

    createRenderRoot() {
      // 2. Attach to existing ShadowRoot (Declarative Shadow DOM)
      if (this.shadowRoot) {
        return this.shadowRoot;
      }
      return typeof super.createRenderRoot === 'function' ? super.createRenderRoot() : this.attachShadow({ mode: 'open' });
    }

    update(changedProperties: Map<PropertyKey, unknown>) {
      const isFirstUpdate = !this.hasUpdated;
      const root = (this.renderRoot || this.shadowRoot) as any;

      // 3. Suppress initial render teardown if ShadowRoot already populated from DSD
      if (isFirstUpdate && root && root.childNodes.length > 0) {
        this.hasUpdated = true;
        if ((this as any).renderOptions) {
          (this as any).renderOptions.isConnected = this.isConnected;
        }
        if (typeof (this as any)._$markUpdated === 'function') {
          (this as any)._$markUpdated();
        } else {
          (this as any).isUpdatePending = false;
        }

        if (typeof this.willUpdate === 'function') {
          this.willUpdate(changedProperties);
        }

        // Call render to get template bindings without tearing down DOM
        let renderResult: any;
        if (typeof this.render === 'function') {
          renderResult = this.render();
          (this as any).__resumablePrevFlat = flattenTemplateResult(renderResult);
          bindTemplateEventHandlers(root, renderResult, this);
        }

        if (typeof this.firstUpdated === 'function') {
          this.firstUpdated(changedProperties);
        }
        if (typeof this.updated === 'function') {
          this.updated(changedProperties);
        }
        return;
      }

      if (root && !root._$litPart$) {
        if ((this as any).__resumablePrevFlat && typeof this.render === 'function') {
          const nextResult = this.render();
          const nextFlat = flattenTemplateResult(nextResult);
          if (nextFlat && updateResumableDomInPlace(root, (this as any).__resumablePrevFlat, nextFlat)) {
            (this as any).__resumablePrevFlat = nextFlat;
            if (typeof (this as any)._$markUpdated === 'function') {
              (this as any)._$markUpdated();
            } else {
              (this as any).isUpdatePending = false;
            }
            return;
          }
          (this as any).__resumablePrevFlat = null;
        }
        clearStaticSsrNodes(root);
        if ((this as any).renderOptions) {
          (this as any).renderOptions.renderBefore = undefined;
          (this as any).renderOptions.isConnected = this.isConnected;
        }
      }

      // Subsequent updates perform standard reactive DOM updates
      if (typeof super.update === 'function') {
        super.update(changedProperties);
      }
    }
  };
}

let isAdapterInstalled = false;
const patchedPrototypes = new WeakSet<object>();

function patchReactivePrototype(targetProto: any): void {
  if (!targetProto || patchedPrototypes.has(targetProto)) {
    return;
  }
  patchedPrototypes.add(targetProto);

  const origRequestUpdate = targetProto.requestUpdate;
  if (typeof origRequestUpdate === 'function') {
    targetProto.requestUpdate = function (name?: PropertyKey, oldValue?: unknown, options?: unknown) {
      if (this.hasUpdated && name === undefined && (!this._$changedProperties || this._$changedProperties.size === 0)) {
        return this.updateComplete;
      }
      return origRequestUpdate.call(this, name, oldValue, options);
    };
  }

  const origConnected = targetProto.connectedCallback;
  targetProto.connectedCallback = function () {
    const restored = restoreComponentState(this);
    if (typeof origConnected === 'function') {
      origConnected.call(this);
    }
    if (restored && typeof origRequestUpdate === 'function') {
      origRequestUpdate.call(this);
    }
  };

  const origCreateRenderRoot = targetProto.createRenderRoot;
  targetProto.createRenderRoot = function () {
    if (this.shadowRoot) {
      return this.shadowRoot;
    }
    return origCreateRenderRoot ? origCreateRenderRoot.call(this) : this.attachShadow({ mode: 'open' });
  };

  const origUpdate = targetProto.update;
  targetProto.update = function (changedProperties: Map<PropertyKey, unknown>) {
    const isFirstUpdate = !this.hasUpdated;
    const root = (this.renderRoot || this.shadowRoot) as any;

    if (isFirstUpdate) {
      const hasSsrContent =
        root &&
        root.childNodes &&
        root.childNodes.length > 0 &&
        Array.from(root.childNodes as NodeListOf<ChildNode>).some(
          (n: any) => (n.nodeType === 1 && (!n.tagName || n.tagName.toLowerCase() !== 'style')) || (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0),
        );
      if (hasSsrContent) {
        this.hasUpdated = true;
        if (this.renderOptions) {
          this.renderOptions.isConnected = this.isConnected;
        }
        if (typeof this._$markUpdated === 'function') {
          this._$markUpdated();
        } else {
          this.isUpdatePending = false;
        }

        if (typeof this.willUpdate === 'function') {
          this.willUpdate(changedProperties);
        }

        if (typeof this.render === 'function') {
          const renderResult = this.render();
          this.__resumablePrevFlat = flattenTemplateResult(renderResult);
          bindTemplateEventHandlers(root, renderResult, this);
        }

        if (typeof this.firstUpdated === 'function') {
          this.firstUpdated(changedProperties);
        }
        if (typeof this.updated === 'function') {
          this.updated(changedProperties);
        }
        return;
      }
    } else if (!changedProperties || changedProperties.size === 0) {
      if (typeof this._$markUpdated === 'function') {
        this._$markUpdated();
      } else {
        this.isUpdatePending = false;
      }
      return;
    }

    if (root && !root._$litPart$) {
      if (this.__resumablePrevFlat && typeof this.render === 'function') {
        const nextResult = this.render();
        const nextFlat = flattenTemplateResult(nextResult);
        if (nextFlat && updateResumableDomInPlace(root, this.__resumablePrevFlat, nextFlat)) {
          this.__resumablePrevFlat = nextFlat;
          if (typeof this._$markUpdated === 'function') {
            this._$markUpdated();
          } else {
            this.isUpdatePending = false;
          }
          return;
        }
        this.__resumablePrevFlat = null;
      }
      clearStaticSsrNodes(root);
      if (this.renderOptions) {
        this.renderOptions.renderBefore = undefined;
        this.renderOptions.isConnected = this.isConnected;
      }
    }

    if (typeof origUpdate === 'function') {
      origUpdate.call(this, changedProperties);
    }
  };
}

/**
 * Globally install the resumable adapter on Lit's ReactiveElement prototype.
 */
export function installResumableAdapter(LitElementOrReactiveElementClass?: any): void {
  if (typeof customElements !== 'undefined' && !(customElements as any).__litResumablePatched) {
    (customElements as any).__litResumablePatched = true;
    const origDefine = customElements.define;
    customElements.define = function (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) {
      let curr: any = ctor;
      let targetBase: any = null;
      while (curr && curr !== HTMLElement && curr !== Function.prototype) {
        if (curr.prototype && (Object.hasOwn(curr.prototype, 'update') || Object.hasOwn(curr.prototype, 'performUpdate'))) {
          targetBase = curr.prototype;
          break;
        }
        curr = Object.getPrototypeOf(curr);
      }
      if (targetBase) {
        patchReactivePrototype(targetBase);
      }
      return origDefine.call(this, name, ctor, options);
    };
  }

  if (isAdapterInstalled && !LitElementOrReactiveElementClass) {
    return;
  }

  let targetProto: any = null;

  if (LitElementOrReactiveElementClass?.prototype) {
    targetProto = LitElementOrReactiveElementClass.prototype;
  } else if (typeof window !== 'undefined') {
    const maybeLit = (window as any).LitElement || (window as any).ReactiveElement;
    if (maybeLit?.prototype) {
      targetProto = maybeLit.prototype;
    }
  }

  if (targetProto) {
    patchReactivePrototype(targetProto);
  }

  isAdapterInstalled = true;
}
