import { formatAttributes } from '@lit-core/resumable/server';

export interface RenderOptions {
  depth?: number;
  resumable?: boolean;
  domPaths?: boolean;
  cssFuse?: boolean;
  customElements?: CustomElementRegistryLike;
  state?: Record<string, unknown>;
}

export interface CustomElementRegistryLike {
  get(name: string): (new () => any) | undefined;
  define(name: string, ctor: new () => any): void;
}

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
  render(value: unknown, options?: RenderOptions): IterableIterator<string>;
  renderToStream(value: unknown, options?: RenderOptions): ReadableStream<Uint8Array>;
  collectResult(result: Iterable<string> | AsyncIterable<string>): Promise<string>;
  createIsolateEnvironment(): {
    customElements: CustomElementRegistryLike;
    HTMLElement: new (tagName?: string) => any;
  };
}

/**
 * In-memory CustomElementRegistry implementation for pure V8 isolates.
 */
export class IsolateCustomElementRegistry implements CustomElementRegistryLike {
  private readonly definitions = new Map<string, new () => any>();

  get(name: string): (new () => any) | undefined {
    return this.definitions.get(name.toLowerCase());
  }

  define(name: string, ctor: new () => any): void {
    const key = name.toLowerCase();
    if (this.definitions.has(key)) {
      throw new Error(`Custom element '${name}' is already defined`);
    }
    (ctor as any).is = key;
    this.definitions.set(key, ctor);
  }
}

/**
 * Minimal HTMLElement base class for pure V8 isolates without DOM globals.
 */
export class IsolateHTMLElement {
  tagName: string;
  attributes: Record<string, string> = {};
  shadowRoot: any = null;

  constructor(tagName?: string) {
    const ctor = this.constructor as any;
    this.tagName = (tagName || ctor.is || 'custom-element').toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name.toLowerCase()] = String(value);
  }

  attachShadow(options: { mode: 'open' | 'closed' }): any {
    this.shadowRoot = {
      mode: options.mode,
      innerHTML: '',
    };
    return this.shadowRoot;
  }
}

/**
 * Create a stateless isolate minimal environment.
 */
export function createIsolateEnvironment(): {
  customElements: CustomElementRegistryLike;
  HTMLElement: new (tagName?: string) => any;
} {
  return {
    customElements: new IsolateCustomElementRegistry(),
    HTMLElement: IsolateHTMLElement as unknown as new (tagName?: string) => any,
  };
}

/**
 * Deterministically project light DOM nodes into shadow DOM slots.
 */
export function projectSlots(shadowHtml: string, lightChildren: Array<{ slot?: string; content: string }>): { projectedShadow: string; lightRemainder: string } {
  let projected = shadowHtml;
  const assignedLightIndices = new Set<number>();

  // Project named slots: <slot name="...">fallback</slot>
  const namedSlotRegex = /<slot\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/slot>/gi;
  projected = projected.replace(namedSlotRegex, (_match, slotName, fallback) => {
    const matchedChildren: string[] = [];
    lightChildren.forEach((child, index) => {
      if (child.slot === slotName) {
        matchedChildren.push(child.content);
        assignedLightIndices.add(index);
      }
    });

    return matchedChildren.length > 0 ? matchedChildren.join('') : fallback;
  });

  // Project default slot: <slot>fallback</slot>
  const defaultSlotRegex = /<slot\s*>([\s\S]*?)<\/slot>/gi;
  projected = projected.replace(defaultSlotRegex, (_match, fallback) => {
    const defaultChildren: string[] = [];
    lightChildren.forEach((child, index) => {
      if (!child.slot && !assignedLightIndices.has(index)) {
        defaultChildren.push(child.content);
        assignedLightIndices.add(index);
      }
    });

    return defaultChildren.length > 0 ? defaultChildren.join('') : fallback;
  });

  // Light DOM elements that were not projected into slots remain as light DOM
  const lightRemainder = lightChildren
    .filter((_, index) => !assignedLightIndices.has(index))
    .map((c) => c.content)
    .join('');

  return { projectedShadow: projected, lightRemainder };
}

/**
 * Render value into clean Declarative Shadow DOM chunks.
 */
export function* render(value: unknown, options: RenderOptions = {}): IterableIterator<string> {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    yield String(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      yield* render(item, options);
    }
    return;
  }

  // Handle Lit TemplateResult-like structures
  if (typeof value === 'object' && value !== null) {
    const obj = value as any;

    // Check for component descriptor
    if (obj.tagName) {
      const tag = String(obj.tagName).toLowerCase();
      const attrMap = { ...(obj.attributes || {}) };

      if (options.domPaths || obj.domPaths) {
        attrMap['data-lit-paths'] = 'true';
      }

      const attrStr = formatAttributes(attrMap);

      let styleTag = '';
      if (obj.styles) {
        const cssContent = Array.isArray(obj.styles) ? obj.styles.join('\n') : String(obj.styles);
        if (cssContent.trim()) {
          styleTag = `<style>${cssContent.trim()}</style>`;
        }
      }

      // Slot projection
      let shadowContent = obj.shadowHtml ?? '';
      let lightDomOutput = '';

      if (Array.isArray(obj.lightDom)) {
        const normalizedChildren = obj.lightDom.map((child: any) => {
          if (typeof child === 'object' && child !== null && 'content' in child) {
            return child;
          }
          return { slot: undefined, content: String(child) };
        });

        const { projectedShadow, lightRemainder } = projectSlots(shadowContent, normalizedChildren);
        shadowContent = projectedShadow;
        lightDomOutput = lightRemainder;
      } else if (typeof obj.lightDom === 'string') {
        lightDomOutput = obj.lightDom;
      }

      let stateScript = '';
      const stateData = options.state ?? obj.state;
      if (options.resumable && stateData && Object.keys(stateData).length > 0) {
        stateScript = `<script type="lit/state">${JSON.stringify(stateData)}</script>`;
      }

      yield `<${tag}${attrStr}>`;
      yield `<template shadowrootmode="open">`;
      if (styleTag) yield styleTag;
      if (shadowContent) yield shadowContent;
      yield `</template>`;
      if (lightDomOutput) yield lightDomOutput;
      if (stateScript) yield stateScript;
      yield `</${tag}>`;
      return;
    }

    // Lit html template result (strings and values)
    if (obj.strings && Array.isArray(obj.strings)) {
      const strings = obj.strings as string[];
      const values = (obj.values || []) as unknown[];

      for (let i = 0; i < strings.length; i++) {
        yield strings[i];
        if (i < values.length) {
          yield* render(values[i], options);
        }
      }
      return;
    }

    // HTML-AOT pre-compiled descriptor
    if (obj._$litType$ !== undefined || obj.template !== undefined) {
      const html = obj.html ?? obj.template ?? '';
      yield String(html);
      return;
    }
  }

  yield String(value);
}

/**
 * Render value into a Web Standard ReadableStream<Uint8Array>.
 */
export function renderToStream(value: unknown, options: RenderOptions = {}): ReadableStream<Uint8Array> {
  const iterator = render(value, options);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const { value: chunk, done } = iterator.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(chunk));
      }
    },
    cancel() {
      if (typeof (iterator as any).return === 'function') {
        (iterator as any).return();
      }
    },
  });
}

/**
 * Asynchronously collect all chunks into a complete HTML string.
 */
export async function collectResult(result: Iterable<string> | AsyncIterable<string>): Promise<string> {
  const parts: string[] = [];

  if (Symbol.asyncIterator in result) {
    for await (const chunk of result as AsyncIterable<string>) {
      parts.push(chunk);
    }
  } else {
    for (const chunk of result as Iterable<string>) {
      parts.push(chunk);
    }
  }

  return parts.join('');
}

/**
 * Reference oracle implementation bundle.
 */
const referenceOracle: SsrEngineModule = {
  render,
  renderToStream,
  collectResult,
  createIsolateEnvironment,
};

/**
 * Dynamically resolves @lit-core/ssr module if installed, or falls back to specification reference oracle.
 */
export async function getSsrEngine(): Promise<SsrEngineModule> {
  try {
    const mod = await import('@lit-core/ssr' as any);
    if (mod && typeof mod.render === 'function') {
      return mod;
    }
  } catch {
    // Falls back to reference oracle
  }

  return referenceOracle;
}
