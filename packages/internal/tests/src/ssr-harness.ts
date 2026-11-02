import {
  type CustomElementRegistryLike,
  collectResult,
  createIsolateEnvironment,
  HTMLElementStub,
  IsolateCustomElementRegistry,
  type RenderOptions,
  render,
  renderToStream,
  renderToString,
  unsafeCSS,
  unsafeHTML,
} from '@lit-core/ssr';
import { html } from 'lit';

export type { CustomElementRegistryLike, RenderOptions };
export { collectResult, createIsolateEnvironment, HTMLElementStub, IsolateCustomElementRegistry, render, renderToStream, renderToString };

export interface ComponentRenderDescriptor {
  tagName: string;
  shadowHtml?: string;
  styles?: string | string[];
  attributes?: Record<string, string | number | boolean | null | undefined>;
  lightDom?: string | Array<string | { slot?: string; content: string }>;
  state?: Record<string, unknown> | null;
  domPaths?: boolean;
}

export interface SsrEngineModule {
  render: typeof render;
  renderToStream: typeof renderToStream;
  renderToString: typeof renderToString;
  collectResult: typeof collectResult;
  createIsolateEnvironment: typeof createIsolateEnvironment;
}

function escapeAttrValue(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectSlotAttr(markup: string, slotName: string): string {
  const match = /^(\s*<[a-zA-Z0-9-]+)([\s/>])/.exec(markup);
  if (!match) {
    return `<span slot="${escapeAttrValue(slotName)}">${markup}</span>`;
  }
  if (/\sslot\s*=/.test(markup)) {
    return markup;
  }
  return `${match[1]} slot="${escapeAttrValue(slotName)}"${markup.slice(match[1].length)}`;
}

/**
 * Register a genuine custom element class in an isolate registry and build a Lit template invoking it.
 */
export function buildRegisteredComponentFixture(
  spec: ComponentRenderDescriptor,
  existingRegistry?: CustomElementRegistryLike,
): {
  template: unknown;
  customElements: CustomElementRegistryLike;
  options: RenderOptions;
} {
  const customElements = existingRegistry ?? createIsolateEnvironment().customElements;
  const tag = spec.tagName.toLowerCase();
  const stylesArray = spec.styles ? (Array.isArray(spec.styles) ? spec.styles.map((s) => unsafeCSS(s)) : [unsafeCSS(spec.styles)]) : [];
  const shadowMarkup = spec.shadowHtml ?? '';
  const initialState = spec.state && typeof spec.state === 'object' ? { ...spec.state } : {};

  if (!customElements.get(tag)) {
    class TestRegisteredElement extends HTMLElementStub {
      static styles = stylesArray;
      constructor() {
        super(tag);
        Object.assign(this, initialState);
      }
      render() {
        const shadowStrings = Object.assign([shadowMarkup], { raw: [shadowMarkup] }) as unknown as TemplateStringsArray;
        return { _$litType$: 1, strings: shadowStrings, values: [] };
      }
    }
    customElements.define(tag, TestRegisteredElement);
  }

  let attrMarkup = '';
  if (spec.attributes) {
    for (const [rawKey, rawVal] of Object.entries(spec.attributes)) {
      if (!/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/.test(rawKey)) continue;
      if (rawVal === null || rawVal === undefined || rawVal === false) continue;
      if (rawVal === true) {
        attrMarkup += ` ${rawKey}`;
      } else {
        attrMarkup += ` ${rawKey}="${escapeAttrValue(String(rawVal))}"`;
      }
    }
  }

  let lightMarkup = '';
  if (typeof spec.lightDom === 'string') {
    lightMarkup = spec.lightDom;
  } else if (Array.isArray(spec.lightDom)) {
    lightMarkup = spec.lightDom
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry.slot) return injectSlotAttr(entry.content, entry.slot);
        return entry.content;
      })
      .join('');
  }

  const rawHostHtml = `<${tag}${attrMarkup}>${lightMarkup}</${tag}>`;
  const strings = Object.assign([rawHostHtml], { raw: [rawHostHtml] }) as unknown as TemplateStringsArray;
  const template = { _$litType$: 1, strings, values: [] };

  const options: RenderOptions = {
    customElements,
    ...(spec.domPaths ? { domPaths: true } : {}),
    ...(spec.state && Object.keys(spec.state).length > 0 ? { state: spec.state } : {}),
  };

  return { template, customElements, options };
}

/**
 * Returns the real `@lit-core/ssr` engine module.
 */
export async function getSsrEngine(): Promise<SsrEngineModule> {
  return {
    render,
    renderToStream,
    renderToString,
    collectResult,
    createIsolateEnvironment,
  };
}
