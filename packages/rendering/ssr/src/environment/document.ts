import type { CSSStyleSheetStub } from './constructable.js';
import { HTMLElementStub } from './html-element.js';

export class DocumentStub {
  readonly isServer = true;
  readonly defaultView: typeof globalThis = typeof globalThis !== 'undefined' ? globalThis : (undefined as any);
  readonly body: HTMLElementStub;
  readonly head: HTMLElementStub;
  readonly documentElement: HTMLElementStub;
  readonly activeElement: HTMLElementStub | null = null;
  readonly readyState = 'complete';
  dir = '';
  private _adoptedStyleSheets: CSSStyleSheetStub[] = [];

  constructor() {
    this.body = new HTMLElementStub('BODY');
    this.head = new HTMLElementStub('HEAD');
    this.documentElement = new HTMLElementStub('HTML');
  }

  get adoptedStyleSheets(): CSSStyleSheetStub[] {
    return this._adoptedStyleSheets;
  }

  set adoptedStyleSheets(sheets: CSSStyleSheetStub[]) {
    this._adoptedStyleSheets = sheets;
  }

  createElement(tagName: string): HTMLElementStub {
    return new HTMLElementStub(tagName);
  }

  createDocumentFragment(): HTMLElementStub {
    return new HTMLElementStub('#document-fragment');
  }

  addEventListener(_type: string, _listener: any, _options?: any): void {}
  removeEventListener(_type: string, _listener: any, _options?: any): void {}
  querySelectorAll(_selector: string): any[] {
    return [];
  }
  querySelector(_selector: string): any {
    return null;
  }
  getElementById(_id: string): any {
    return null;
  }
  createTreeWalker(root: any, _whatToShow?: number): any {
    return {
      currentNode: root,
      nextNode: () => null,
    };
  }
  createComment(data?: string): any {
    return {
      nodeType: 8,
      data: data ?? '',
      textContent: data ?? '',
    };
  }
  createTextNode(data?: string): any {
    return {
      nodeType: 3,
      data: data ?? '',
      textContent: data ?? '',
    };
  }
  importNode(node: any, _deep?: boolean): any {
    return node;
  }
}

export const defaultDocumentStub = new DocumentStub();
