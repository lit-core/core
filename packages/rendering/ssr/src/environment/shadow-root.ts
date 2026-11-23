import { type Options as CssSelectOptions, selectAll as cssSelectAll, selectOne as cssSelectOne } from 'css-select';
import type { CSSStyleSheetStub } from './constructable.js';
import { HTMLElementStub } from './html-element.js';
import { EMPTY_STYLE_SHEETS } from './shared.js';

export class ShadowRootStub {
  readonly host: HTMLElementStub;
  readonly mode: ShadowRootMode;
  readonly delegatesFocus: boolean;
  private _adoptedStyleSheets: CSSStyleSheetStub[] = EMPTY_STYLE_SHEETS;
  private _childNodes: any[] | null = null;
  private _children: any[] | null = null;
  activeElement: any = null;
  innerHTML = '';

  constructor(host: HTMLElementStub, init: ShadowRootInit = { mode: 'open' }) {
    this.host = host;
    this.mode = init.mode;
    this.delegatesFocus = init.delegatesFocus ?? false;
  }

  get childNodes(): any[] {
    return (this._childNodes ??= []);
  }

  set childNodes(nodes: any[]) {
    this._childNodes = nodes;
  }

  get children(): any[] {
    return (this._children ??= []);
  }

  set children(nodes: any[]) {
    this._children = nodes;
  }

  get adoptedStyleSheets(): CSSStyleSheetStub[] {
    return this._adoptedStyleSheets;
  }

  set adoptedStyleSheets(sheets: CSSStyleSheetStub[]) {
    this._adoptedStyleSheets = sheets;
  }

  appendChild<T>(node: T): T {
    (this._childNodes ??= []).push(node);
    return node;
  }

  removeChild<T>(node: T): T {
    return node;
  }

  insertBefore<T>(node: T, _ref?: any): T {
    (this._childNodes ??= []).push(node);
    return node;
  }

  append(...nodes: any[]): void {
    (this._childNodes ??= []).push(...nodes);
  }

  prepend(...nodes: any[]): void {
    (this._childNodes ??= []).unshift(...nodes);
  }

  querySelector(selector: string): any {
    const children = this.children.length > 0 ? this.children : this.childNodes;
    if (!selector?.trim() || children.length === 0) return null;
    try {
      return cssSelectOne(selector, children, { adapter: ssrDomAdapter });
    } catch {
      return null;
    }
  }

  querySelectorAll(selector: string): any[] {
    const children = this.children.length > 0 ? this.children : this.childNodes;
    if (!selector?.trim() || children.length === 0) return [];
    try {
      return cssSelectAll(selector, children, { adapter: ssrDomAdapter });
    } catch {
      return [];
    }
  }

  getElementById(id: string): any {
    if (!id) return null;
    return this.querySelector(`#${id}`);
  }

  addEventListener(_type: string, _listener: any, _options?: any): void {}
  removeEventListener(_type: string, _listener: any, _options?: any): void {}
  dispatchEvent(_event: any): boolean {
    return true;
  }
}

export const ssrDomAdapter: NonNullable<CssSelectOptions<any, HTMLElementStub>['adapter']> = {
  isTag: (node: any): node is HTMLElementStub => node instanceof HTMLElementStub && node.nodeType === 1,
  getAttributeValue: (el: HTMLElementStub, name: string) => el.getAttribute(name) ?? undefined,
  getChildren: (node: any) => {
    if (node instanceof HTMLElementStub) {
      return node._ssrLightChildNodes.length > 0 ? node._ssrLightChildNodes : node._ssrLightChildren;
    }
    if (node instanceof ShadowRootStub) {
      return node.children.length > 0 ? node.children : node.childNodes;
    }
    return [];
  },
  getName: (el: HTMLElementStub) => el.localName,
  getParent: (el: HTMLElementStub) => el._ssrParentHost,
  getSiblings: (node: any) => {
    if (node instanceof HTMLElementStub && node._ssrParentHost) {
      const parent = node._ssrParentHost;
      return parent._ssrLightChildNodes.length > 0 ? parent._ssrLightChildNodes : parent._ssrLightChildren;
    }
    return [node];
  },
  getText: (node: any) => {
    if (!node) return '';
    if (node.nodeType === 3) return node.data ?? node.textContent ?? '';
    return typeof node.textContent === 'string' ? node.textContent : '';
  },
  hasAttrib: (el: HTMLElementStub, name: string) => el.hasAttribute(name),
  removeSubsets: (nodes: any[]) => {
    const out: any[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const candidate = nodes[i];
      if (out.includes(candidate)) continue;
      let hasAncestor = false;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const other = nodes[j];
        if (other instanceof HTMLElementStub && other !== candidate && other.contains(candidate)) {
          hasAncestor = true;
          break;
        }
      }
      if (!hasAncestor) out.push(candidate);
    }
    return out;
  },
};
