import {
  createBoundaryPayload,
  escapeAttribute,
  executeComponentLifecycleAndReflection,
  type HtmlRewriterLike,
  type HtmlRewriterServerElementAdapter,
  type HtmlRewriterSsrOptions,
  installIsolateGlobals,
  prepareComponentBindings,
  type RenderOptions,
  readLiveHostAttributesMap,
  renderToString,
  StyleDeduplicator,
  transformWithHtmlRewriter,
} from '@lit-core/ssr';
import type { ActionContext, Env, LoaderContext } from './context.js';
import { createSignedStateSnapshot, escapeJsonForHtml, generateActionToken } from './crypto.js';
import { CONTEXT_SYMBOL } from './symbols.js';
import type { Constructor, EdgeResponseOptions, ServerElementRenderOptions, ServerElementRenderResult } from './types.js';

export * from './crypto.js';

const requestHostIdCounters = new WeakMap<Request, number>();
const VALID_PUBLIC_ATTR_RE = /^[a-zA-Z_][-a-zA-Z0-9_.:]*$/;
const SERVER_ELEMENT_RESULT_BRAND = Symbol('lit-core.server-elements.render-result');

function allocateHostId(options: ServerElementRenderOptions): number {
  if (typeof options.hostId === 'number') {
    return options.hostId;
  }
  if (options.request) {
    const next = requestHostIdCounters.get(options.request) ?? 0;
    requestHostIdCounters.set(options.request, next + 1);
    return next;
  }
  return 0;
}

function resolveMandatorySecret(options: { secret?: string | CryptoKey; env?: Record<string, unknown>; devMode?: boolean }): string | CryptoKey {
  const secret = options.secret || (options.env?.LIT_ACTION_SECRET as string | CryptoKey | undefined);
  if (secret) {
    return secret;
  }
  if (options.devMode === true) {
    return 'lit-server-element-dev-secret';
  }
  throw new Error(
    '[@lit-core/server-elements] Missing mandatory secret key for HMAC state signing. ' +
      'Configure options.secret or the LIT_ACTION_SECRET binding, or pass devMode: true for local development only.',
  );
}

export function isServerElementConstructor(Ctor: any): boolean {
  if (!Ctor) return false;
  return Boolean(Ctor.__lit_loaders || Ctor.__lit_actions || typeof Ctor.prototype?.load === 'function');
}

/**
 * Creates a standard WinterCG LoaderContext from an incoming Request and environment bindings.
 */
export function createLoaderContext<E = Env>(request?: Request, env: E = {} as E, params: Record<string, string> = {}): LoaderContext<E> {
  const req = request || new Request('http://localhost/');
  const url = new URL(req.url);
  const cookieHeader = req.headers.get('cookie') || '';
  const cookies = new Map<string, string>();

  if (cookieHeader) {
    for (const rawPair of cookieHeader.split(';')) {
      const pair = rawPair.trim();
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.slice(0, idx).trim();
        if (key) {
          let val = pair.slice(idx + 1).trim();
          try {
            val = decodeURIComponent(val);
          } catch {
            // Fallback to raw value on malformed URI sequences
          }
          cookies.set(key, val);
        }
      }
    }
  }

  return {
    env,
    request: req,
    url,
    params: Object.freeze({ ...params }),
    signal: req.signal,
    cookies,
    headers: req.headers,
  };
}

/**
 * Executes a server element loader method on the edge Worker.
 */
export async function executeServerLoader(instance: any, context: LoaderContext, loaderName = 'load'): Promise<void> {
  if (typeof instance._setContext === 'function') {
    instance._setContext(context);
  } else {
    instance[CONTEXT_SYMBOL] = context;
  }

  const loaderFn = instance[loaderName];
  if (typeof loaderFn !== 'function') {
    return;
  }

  await loaderFn.call(instance, context.env, context);
}

/**
 * Executes a server element action method on the edge Worker.
 */
export async function executeServerAction<T = unknown>(instance: any, context: ActionContext, actionName: string, args: unknown[]): Promise<T> {
  if (typeof instance._setContext === 'function') {
    instance._setContext(context);
  } else {
    instance[CONTEXT_SYMBOL] = context;
  }

  const actionFn = instance[actionName];
  if (typeof actionFn !== 'function') {
    throw new Error(`Action method '${actionName}' not found on component instance.`);
  }

  return await actionFn.apply(instance, args);
}

/**
 * Renders any Lit TemplateResult, string, or component render output to an HTML string
 * delegating directly to @lit-core/ssr so untrusted strings are always HTML-escaped.
 */
export function renderTemplateToString(value: unknown, options?: RenderOptions): string {
  if (value === null || value === undefined) {
    return '';
  }
  return renderToString(value, { resumable: false, ...options });
}

interface PreparedServerElementOutput {
  tagName: string;
  hostId: number;
  state: Record<string, unknown>;
  sig: string;
  token: string;
  buildId: string;
  hostAttributes: Record<string, string | null>;
  shadowRenderResult: unknown;
}

async function executeServerElementPipeline(
  instance: any,
  Ctor: Constructor<any>,
  tagName: string,
  propsOrAttrs: Record<string, unknown>,
  hostId: number,
  options: ServerElementRenderOptions,
  secret: string | CryptoKey,
): Promise<PreparedServerElementOutput> {
  const staticAttrs: Record<string, string> = {};
  for (const [key, val] of Object.entries(propsOrAttrs)) {
    if (key === 'data-lit-ssr') continue;
    if (typeof val === 'string') {
      staticAttrs[key] = val;
    } else if (val !== undefined && val !== null) {
      staticAttrs[key] = String(val);
    }
  }

  const { propDeclarations, changedProperties } = prepareComponentBindings({
    instance,
    Ctor,
    tagName,
    staticAttrs,
    resumable: false,
  });

  // Preserve non-string property values directly when passed programmatically via props
  for (const [key, val] of Object.entries(propsOrAttrs)) {
    if (key === 'data-lit-ssr') continue;
    if (typeof val !== 'string') {
      (instance as any)[key] = val;
      if (!changedProperties.has(key)) {
        changedProperties.set(key, undefined);
      }
    } else if (!(key in staticAttrs) || propDeclarations.has(key)) {
      if (typeof (instance as any)[key] === 'undefined') {
        (instance as any)[key] = val;
      }
    }
  }

  const req = options.request || new Request('http://localhost/');
  const loaderContext = createLoaderContext(req, options.env as Env, options.params);
  if (typeof instance._setContext === 'function') {
    instance._setContext(loaderContext);
  } else {
    instance[CONTEXT_SYMBOL] = loaderContext;
  }

  const loaderMetadata = (Ctor as any).__lit_loaders;
  if (loaderMetadata && typeof loaderMetadata === 'object') {
    for (const loaderName of Object.keys(loaderMetadata)) {
      await executeServerLoader(instance, loaderContext, loaderName);
    }
  } else if (typeof instance.load === 'function') {
    await executeServerLoader(instance, loaderContext, 'load');
  }

  // Record any properties mutated by loaders into changedProperties before lifecycle and reflection
  for (const prop of propDeclarations.keys()) {
    try {
      if (instance[prop] !== undefined && !changedProperties.has(prop)) {
        changedProperties.set(prop, undefined);
      }
    } catch {}
  }

  executeComponentLifecycleAndReflection(instance, tagName, propDeclarations, changedProperties, {
    onError: options.onError,
    strictLifecycle: options.strict,
  });

  const state: Record<string, unknown> = {};
  const propsDef = (Ctor as any).properties || {};
  const allStateCandidates = new Set<string>([...propDeclarations.keys(), ...Object.keys(propsDef)]);
  for (const key of allStateCandidates) {
    const decl = propDeclarations.get(key) ?? (propsDef as any)[key];
    const val = (instance as any)[key];
    if (decl?.state === true || val !== undefined) {
      if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
        state[key] = val;
      }
    }
  }
  if ((instance as any).__litState && typeof (instance as any).__litState === 'object') {
    Object.assign(state, (instance as any).__litState);
  }

  const token = options.token || generateActionToken();
  const buildId = typeof (Ctor as any).__litBuildId === 'string' ? (Ctor as any).__litBuildId : '';
  const publicAttrs: Record<string, string> = {};
  for (const [key, val] of Object.entries(propsOrAttrs)) {
    if (key.startsWith('data-lit-') || key.startsWith('__lit')) continue;
    if (!Object.hasOwn(propsDef, key) && !propDeclarations.has(key)) {
      if (!VALID_PUBLIC_ATTR_RE.test(key)) {
        throw new Error(`[@lit-core/server-elements] Invalid public attribute name '${key}'.`);
      }
      publicAttrs[key] = String(val);
    }
  }

  const { sig } = await createSignedStateSnapshot(tagName, state, secret, options.ttlMs ?? 900_000, {
    token,
    buildId,
    seq: 0,
    publicAttrs,
  });

  const liveAttrs = readLiveHostAttributesMap(instance);
  const hostAttributes: Record<string, string | null> = {};

  for (const oldKey of Object.keys(staticAttrs)) {
    if (!liveAttrs.has(oldKey.toLowerCase()) && !(oldKey in publicAttrs)) {
      hostAttributes[oldKey] = null;
    }
  }
  for (const [attrName, attrVal] of liveAttrs.entries()) {
    hostAttributes[attrName] = attrVal;
  }
  for (const [name, value] of Object.entries(publicAttrs)) {
    hostAttributes[name] = value;
  }
  if (Object.keys(publicAttrs).length > 0) {
    hostAttributes['data-lit-attrs'] = Object.keys(publicAttrs).join(' ');
  }

  hostAttributes['data-lit-ssr'] = String(hostId);
  hostAttributes['data-lit-sig'] = sig;
  hostAttributes['data-lit-token'] = token;
  hostAttributes['data-lit-state'] = JSON.stringify(state);
  if (buildId) {
    hostAttributes['data-lit-build-id'] = buildId;
  }

  const shadowRenderResult = instance.render?.();

  return {
    tagName,
    hostId,
    state,
    sig,
    token,
    buildId,
    hostAttributes,
    shadowRenderResult,
  };
}

/**
 * Instantiates a server element, injects context, executes loaders, runs Lit lifecycle and reflection,
 * signs state, and renders Declarative Shadow DOM.
 */
export async function renderServerElement(tagOrCtor: string | Constructor<any>, props: Record<string, unknown> = {}, options: ServerElementRenderOptions = {}): Promise<ServerElementRenderResult> {
  installIsolateGlobals();
  const registry = options.customElements ?? options.registry ?? (globalThis as any).customElements;
  const Ctor = typeof tagOrCtor === 'string' ? registry?.get(tagOrCtor) : tagOrCtor;

  if (!Ctor) {
    const name = typeof tagOrCtor === 'string' ? tagOrCtor : 'Unknown';
    throw new Error(`[@lit-core/server-elements] Custom element constructor for '${name}' not found.`);
  }

  const tagName = typeof tagOrCtor === 'string' ? tagOrCtor.toLowerCase() : (Ctor as any).is?.toLowerCase() || (Ctor as any).tagName?.toLowerCase() || 'server-element';
  const secret = resolveMandatorySecret(options);
  const hostId = allocateHostId(options);
  const instance = new Ctor();

  const prepared = await executeServerElementPipeline(instance, Ctor, tagName, props, hostId, options, secret);

  const styleDeduplicator = new StyleDeduplicator();
  const extractedStyles = styleDeduplicator.processComponentStyles(Ctor);
  const combinedStyles = [...extractedStyles.sharedSheets, ...extractedStyles.localStyles];
  const styleTag = combinedStyles.length > 0 ? `<style>${combinedStyles.join('\n')}</style>` : '';

  const isDsd = (options.mode ?? 'dsd') === 'dsd';
  const innerHtml =
    prepared.shadowRenderResult !== undefined && prepared.shadowRenderResult !== null
      ? renderToString(prepared.shadowRenderResult, {
          mode: options.mode ?? 'dsd',
          customElements: registry,
          resumable: false,
        })
      : '';

  let attrHtml = '';
  for (const [k, v] of Object.entries(prepared.hostAttributes)) {
    if (v === null) continue;
    if (!isDsd && k === 'data-lit-state' && Object.keys(prepared.state).length === 0) {
      continue;
    }
    const serializedVal = k === 'data-lit-state' ? escapeJsonForHtml(v) : v;
    attrHtml += ` ${k}="${escapeAttribute(serializedVal)}"`;
  }

  const shadowContent = `${styleTag}${innerHtml}`;
  const finalHtml = isDsd ? `<${tagName}${attrHtml}><template shadowrootmode="open">${shadowContent}</template></${tagName}>` : `<${tagName}${attrHtml}>${shadowContent}</${tagName}>`;

  const result: ServerElementRenderResult = {
    tagName,
    hostId,
    html: finalHtml,
    state: prepared.state,
    sig: prepared.sig,
    token: prepared.token,
  };
  Object.defineProperty(result, SERVER_ELEMENT_RESULT_BRAND, {
    value: true,
    enumerable: false,
  });
  return result;
}

export interface ServerElementsHtmlRewriterOptions extends HtmlRewriterSsrOptions {
  request?: Request;
  env?: Record<string, unknown>;
  params?: Record<string, string>;
  secret?: string | CryptoKey;
  ttlMs?: number;
  devMode?: boolean;
}

/**
 * Creates an `HtmlRewriterServerElementAdapter` sharing the exact `executeServerElementPipeline`
 * implementation used by `renderServerElement`, running `@loader()` methods concurrently via
 * pending async boundaries without blocking `HTMLRewriter`'s tokenizer.
 */
export function createServerElementRewriterAdapter(options: ServerElementsHtmlRewriterOptions = {}): HtmlRewriterServerElementAdapter {
  return {
    canHandle(Ctor: new () => any): boolean {
      return isServerElementConstructor(Ctor);
    },
    prepareBoundary({ instance, Ctor, tagName, hostId, incomingAttrs }) {
      const secret = resolveMandatorySecret(options);
      const pendingContent = typeof instance.renderPending === 'function' ? instance.renderPending() : undefined;

      const boundaryPromise = executeServerElementPipeline(
        instance,
        Ctor,
        tagName,
        incomingAttrs,
        hostId,
        {
          request: options.request,
          env: options.env,
          params: options.params,
          secret,
          ttlMs: options.ttlMs,
          customElements: options.customElements,
          mode: options.mode,
          devMode: options.devMode,
          strict: options.strictLifecycle,
          onError: options.onError,
          hostId,
        },
        secret,
      ).then((prepared) => createBoundaryPayload(prepared.shadowRenderResult, prepared.hostAttributes));

      return {
        pendingContent,
        boundaryPromise,
      };
    },
  };
}

/**
 * Enriches `HtmlRewriterSsrOptions` with the unified server-element pipeline adapter.
 */
export function createServerElementsRewriterOptions(options: ServerElementsHtmlRewriterOptions = {}): HtmlRewriterSsrOptions {
  return {
    resumable: false,
    ...options,
    serverElementAdapter: options.serverElementAdapter ?? createServerElementRewriterAdapter(options),
  };
}

/**
 * Streams an HTML response through `HTMLRewriter`, executing `@loader()` methods concurrently,
 * reflecting host attributes, signing state, and emitting progressive Declarative Shadow DOM.
 */
export function transformServerElementsWithHtmlRewriter(input: Response | string, options: ServerElementsHtmlRewriterOptions = {}, rewriterFactory?: () => HtmlRewriterLike): Response {
  return transformWithHtmlRewriter(input, createServerElementsRewriterOptions(options), rewriterFactory);
}

/**
 * Converts a server element, render result, template, or stream into a standard streaming HTTP Response.
 */
export function renderToResponse(value: unknown, options: EdgeResponseOptions = {}): Response {
  const headers = new Headers(options.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  if (!headers.has('x-content-type-options')) {
    headers.set('x-content-type-options', 'nosniff');
  }

  const encoder = new TextEncoder();

  if (value instanceof ReadableStream) {
    return new Response(value, {
      status: options.status ?? 200,
      statusText: options.statusText,
      headers,
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const signal = options.request?.signal;
      if (signal?.aborted) {
        controller.error(signal.reason ?? new Error('Request aborted'));
        return;
      }

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        try {
          controller.error(signal?.reason ?? new Error('Request aborted'));
        } catch {}
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        let resolved = value;
        if (resolved && typeof (resolved as any).then === 'function') {
          resolved = await resolved;
        }
        if (signal?.aborted || aborted) {
          return;
        }

        if (resolved !== null && typeof resolved === 'object' && (resolved as any)[SERVER_ELEMENT_RESULT_BRAND] === true && typeof (resolved as any).html === 'string') {
          controller.enqueue(encoder.encode((resolved as any).html));
        } else if (typeof resolved === 'string') {
          controller.enqueue(encoder.encode(resolved));
        } else if (typeof resolved === 'function') {
          const res = await renderServerElement(resolved as any, {}, options);
          if (signal?.aborted || aborted) {
            return;
          }
          controller.enqueue(encoder.encode(res.html));
        } else {
          const html = renderTemplateToString(resolved, { customElements: options.customElements ?? options.registry });
          if (signal?.aborted || aborted) {
            return;
          }
          controller.enqueue(encoder.encode(html));
        }
        controller.close();
      } catch (err) {
        if (!aborted && !signal?.aborted) {
          controller.error(err);
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });

  return new Response(stream, {
    status: options.status ?? 200,
    statusText: options.statusText,
    headers,
  });
}
