import { type CustomElementRegistryLike, installIsolateGlobals, isCompiledTemplateResult, isStandardTemplateResult, type RenderOptions, renderToString } from '@lit-core/ssr';
import { parse as parseCookieHeader, serialize as serializeCookieHeader } from 'cookie';
import type { ActionContext, Env } from './context.js';
import { canonicalizeJson, createSignedStateSnapshot, hasPrototypePollution, verifyStateSignature } from './crypto.js';
import { executeServerAction, executeServerLoader } from './edge.js';
import { CONTEXT_SYMBOL } from './symbols.js';
import type { ActionRequestBody, CookieOptions, ErrorPatchFrame, PatchFrame } from './types.js';

export interface ServerElementRegistry {
  get(tagName: string): (new (...args: any[]) => any) | undefined;
}

export interface ActionEndpointOptions {
  /** Edge bindings environment (Cloudflare Workers env / WinterCG context) */
  env: Env;
  /** Secret key for HMAC-SHA256 signature verification */
  secret: string | CryptoKey;
  /** Custom element registry or build-time tag manifest */
  registry?: ServerElementRegistry;
  /** Ergonomic alias for custom element registry */
  customElements?: ServerElementRegistry;
  /** Route prefix to match and strip (defaults to '/_lit/a/') */
  routePrefix?: string;
  /** Optional allowed origins for CSRF validation (defaults to same-origin) */
  allowedOrigins?: string[];
  /** State signature time-to-live in milliseconds (defaults to 15 minutes = 900,000ms) */
  stateTtlMs?: number;
  /** Optional custom error handler */
  onError?: (error: unknown, req: Request) => void;
  /** Optional development mode flag */
  devMode?: boolean;
  /** Optional server build identifier */
  buildId?: string;
}

function createJsonResponse(status: number, body: { error?: string; message?: string; code?: string }, headersInit?: HeadersInit): Response {
  const headers = new Headers(headersInit);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function serializeCookie(name: string, value: string, opts?: CookieOptions): string {
  return serializeCookieHeader(name, value, {
    maxAge: opts?.maxAge,
    domain: opts?.domain,
    path: opts?.path,
    expires: opts?.expires,
    httpOnly: opts?.httpOnly,
    secure: opts?.secure,
    sameSite: opts?.sameSite ? (opts.sameSite.toLowerCase() as 'lax' | 'strict' | 'none') : undefined,
  });
}

function parseCookies(cookieHeader: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  const parsed = parseCookieHeader(cookieHeader);
  for (const [k, v] of Object.entries(parsed)) {
    if (k && v !== undefined) {
      map.set(k, v);
    }
  }
  return map;
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  return canonicalizeJson(a) === canonicalizeJson(b);
}

function cloneStateValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function collectDeclaredProperties(ElementClass: any): Record<string, any> {
  const merged: Record<string, any> = {};
  try {
    if (typeof ElementClass?.finalize === 'function') {
      ElementClass.finalize();
    }
  } catch {}

  if (ElementClass?.elementProperties instanceof Map) {
    for (const [key, decl] of ElementClass.elementProperties.entries()) {
      if (typeof key === 'string') {
        merged[key] = decl && typeof decl === 'object' ? decl : {};
      }
    }
  }
  if (ElementClass?.properties && typeof ElementClass.properties === 'object') {
    for (const [key, decl] of Object.entries(ElementClass.properties)) {
      if (!Object.hasOwn(merged, key)) {
        merged[key] = decl && typeof decl === 'object' ? decl : {};
      }
    }
  }
  return merged;
}

function isKeyedList(val: unknown[]): boolean {
  return (
    val.length > 0 &&
    val.every((item) => item !== null && typeof item === 'object' && ('key' in (item as any) || 'data-lit-key' in (item as any) || '__litKey' in (item as any) || 'id' in (item as any)))
  );
}

function hashTemplateQuasis(strings: readonly string[]): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c64e6d;
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const ch = s.charCodeAt(j);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function extractTemplateId(val: any): string {
  if (val && typeof val === 'object') {
    const litType = val._$litType$;
    if (litType && typeof litType === 'object') {
      if (typeof litType.h === 'string' && /^[0-9a-f]{16}$/i.test(litType.h)) {
        return litType.h;
      }
      if (typeof litType.h === 'string') {
        return litType.h;
      }
    }
    if (Array.isArray(val.strings)) {
      return hashTemplateQuasis(val.strings);
    }
  }
  return '0000000000000000';
}

function quickHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function isRepeatDirective(val: unknown): val is { _$litDirective$: any; values: unknown[] } {
  return Boolean(val && typeof val === 'object' && '_$litDirective$' in val && Array.isArray((val as any).values) && (val as any).values.length >= 2);
}

function isTemplateValue(val: unknown): boolean {
  return isCompiledTemplateResult(val) || isStandardTemplateResult(val);
}

function diffKeyedItems(
  partIdx: number,
  val: unknown,
  prevState: Record<string, unknown> | undefined,
  ssrOptions: RenderOptions,
): { ops: any[]; currentKeys: (string | number)[]; currentHashes: Record<string | number, string> } {
  interface KeyedEntry {
    key: string | number;
    html?: string;
    text?: string;
    hashSource: string;
  }
  const entries: KeyedEntry[] = [];

  if (isRepeatDirective(val)) {
    const [itemsRaw, keyFnOrTpl, maybeTpl] = (val as any).values;
    const items = Array.from(itemsRaw || []);
    const keyFn = typeof maybeTpl === 'function' ? keyFnOrTpl : (_: any, i: number) => i;
    const tplFn = typeof maybeTpl === 'function' ? maybeTpl : keyFnOrTpl;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFn(item, i);
      const tpl = tplFn(item, i);
      if (isTemplateValue(tpl)) {
        const html = renderToString(tpl, ssrOptions);
        entries.push({ key, html, hashSource: `h:${html}` });
      } else {
        const text = tpl === null || tpl === undefined ? '' : String(tpl);
        entries.push({ key, text, hashSource: `t:${text}` });
      }
    }
  } else if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      const item = val[i];
      const key = item && typeof item === 'object' ? ((item as any).key ?? (item as any)['data-lit-key'] ?? (item as any).__litKey ?? (item as any).id ?? i) : i;
      if (isTemplateValue(item)) {
        const html = renderToString(item, ssrOptions);
        entries.push({ key, html, hashSource: `h:${html}` });
      } else {
        const text = item === null || item === undefined ? '' : typeof item === 'object' ? canonicalizeJson(item) : String(item);
        entries.push({ key, text, hashSource: `t:${text}` });
      }
    }
  }

  const prevKeys: (string | number)[] = (prevState?.__lit_keys as any)?.[partIdx] || [];
  const prevHashes: Record<string | number, string> = (prevState?.__lit_item_hashes as any)?.[partIdx] || {};

  const currentKeys = entries.map((e) => e.key);
  const currentHashes: Record<string | number, string> = {};
  for (const e of entries) {
    currentHashes[e.key] = quickHash(e.hashSource);
  }

  const prevKeySet = new Set(prevKeys);
  const currentKeySet = new Set(currentKeys);
  const ops: any[] = [];

  for (const pk of prevKeys) {
    if (!currentKeySet.has(pk)) {
      ops.push({ op: 'remove', key: pk });
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!prevKeySet.has(entry.key)) {
      if (entry.html !== undefined) {
        ops.push({ op: 'insert', key: entry.key, index: i, html: entry.html });
      } else {
        ops.push({ op: 'insert', key: entry.key, index: i, text: entry.text ?? '' });
      }
    }
  }

  for (const entry of entries) {
    if (prevKeySet.has(entry.key)) {
      const prevHash = prevHashes[entry.key];
      const currHash = currentHashes[entry.key];
      if (prevHash && prevHash !== currHash) {
        if (entry.html !== undefined) {
          ops.push({ op: 'update', key: entry.key, html: entry.html });
        } else {
          ops.push({ op: 'update', key: entry.key, text: entry.text ?? '' });
        }
      }
    }
  }

  const orderChanged = prevKeys.length !== currentKeys.length || prevKeys.some((k, idx) => k !== currentKeys[idx]);
  if (orderChanged || prevKeys.length === 0) {
    ops.push({ op: 'reorder', order: currentKeys });
  }

  return { ops, currentKeys, currentHashes };
}

function resolveServerBuildId(ElementClass: any, fallback?: string): string {
  const fromClass = ElementClass?.__litBuildId;
  if (typeof fromClass === 'string' && fromClass.length > 0) return fromClass;
  return fallback ?? '';
}

/**
 * Computes selective surgical patch frames by comparing post-action instance state
 * structurally against the client snapshot, running `willUpdate`, and inspecting render output.
 */
export async function computeSurgicalPatches(
  instance: any,
  ElementClass: any,
  body: ActionRequestBody,
  actionMeta: any,
  actionResult: unknown,
  secret: string | CryptoKey,
  stateTtlMs: number | undefined,
  actionToken: string,
  buildIdFallback?: string,
  registry?: ServerElementRegistry,
  preActionInitialDefaults?: Map<string, unknown>,
): Promise<PatchFrame[]> {
  const frames: PatchFrame[] = [];
  const ssrOptions: RenderOptions = {
    mode: 'dsd',
    resumable: false,
    customElements: (registry ?? (globalThis as any).customElements) as CustomElementRegistryLike | undefined,
  };

  const postState: Record<string, unknown> = {};
  if (instance.__litState && typeof instance.__litState === 'object') {
    for (const [k, v] of Object.entries(instance.__litState)) {
      if (k.startsWith('__lit_')) {
        postState[k] = v;
      }
    }
  }

  const propertiesDef = collectDeclaredProperties(ElementClass);
  const candidateProps = new Set<string>([...Object.keys(propertiesDef), ...Object.keys(body.state || {}).filter((k) => !k.startsWith('__lit')), ...(actionMeta?.writes || [])]);

  const changedProps = new Set<string>();
  const changedPropsMap = new Map<PropertyKey, unknown>();

  const resolvePrevValue = (prop: string): unknown => {
    if (body.state && Object.hasOwn(body.state, prop)) {
      return body.state[prop];
    }
    if (body.attrs && Object.hasOwn(body.attrs, prop)) {
      return body.attrs[prop];
    }
    if (preActionInitialDefaults?.has(prop)) {
      return preActionInitialDefaults.get(prop);
    }
    return undefined;
  };

  for (const prop of candidateProps) {
    const isState = propertiesDef[prop]?.state === true;
    const currentVal = instance[prop];
    if (isState || currentVal !== undefined) {
      postState[prop] = currentVal;
    }

    const prevVal = resolvePrevValue(prop);
    const sharedObjectMutatedInPlace = currentVal !== null && typeof currentVal === 'object' && currentVal === prevVal && Array.isArray(actionMeta?.writes) && actionMeta.writes.includes(prop);
    if (!canonicalEqual(currentVal, prevVal) || sharedObjectMutatedInPlace) {
      changedProps.add(prop);
      changedPropsMap.set(prop, prevVal);
    }
  }

  const INTERNAL_INSTANCE_KEYS = new Set(['renderOptions', 'hasUpdated', 'isUpdatePending', 'updateComplete', 'tagName', 'shadowRoot', 'isConnected']);
  const isTrackableDerivedKey = (key: string): boolean => !key.startsWith('_') && !key.startsWith('$') && !INTERNAL_INSTANCE_KEYS.has(key) && !Object.hasOwn(propertiesDef, key);

  // Snapshot plain instance fields before `willUpdate` so derived non-reactive fields
  // computed inside `willUpdate(changedProperties)` participate in surgical patching.
  const preWillUpdateFields = new Map<string, unknown>();
  for (const key of Object.keys(instance)) {
    if (isTrackableDerivedKey(key)) {
      preWillUpdateFields.set(key, cloneStateValue(instance[key]));
    }
  }

  // Run Lit's pre-render lifecycle (`willUpdate` and controller `hostUpdate`) so derived state
  // computed inside `willUpdate(changedProperties)` participates in surgical patching.
  if (typeof instance.willUpdate === 'function') {
    instance.willUpdate(changedPropsMap);
  }
  if (typeof instance._invokeControllersHostUpdate === 'function') {
    instance._invokeControllersHostUpdate();
  }

  // Re-check declared properties in case `willUpdate` derived or updated reactive fields
  for (const prop of Object.keys(propertiesDef)) {
    const isState = propertiesDef[prop]?.state === true;
    const currentVal = instance[prop];
    if (isState || currentVal !== undefined) {
      postState[prop] = currentVal;
    }
    const prevVal = resolvePrevValue(prop);
    if (!canonicalEqual(currentVal, prevVal)) {
      changedProps.add(prop);
    }
  }

  if (changedProps.size > 0) {
    for (const key of Object.keys(instance)) {
      if (isTrackableDerivedKey(key)) {
        if (!preWillUpdateFields.has(key) || !canonicalEqual(instance[key], preWillUpdateFields.get(key))) {
          changedProps.add(key);
        }
      }
    }
  }

  instance.__litState = { ...postState };

  if (typeof instance.render === 'function') {
    const templateResult = instance.render();
    if (templateResult && Array.isArray(templateResult.values)) {
      const values = templateResult.values;
      const partDeps: Record<number, string[]> | string[][] | undefined = ElementClass.__litPartDeps || (instance.constructor as any).__litPartDeps;

      for (let p = 0; p < values.length; p++) {
        const val = values[p];

        if (typeof val === 'symbol' && val.description === 'lit-noChange') {
          continue;
        }

        if (partDeps) {
          const deps = Array.isArray(partDeps) ? partDeps[p] : (partDeps as Record<number, string[]>)[p];
          if (Array.isArray(deps)) {
            if (deps.length > 0) {
              const isDirty = deps.some((d) => changedProps.has(d));
              if (!isDirty) {
                continue;
              }
            } else {
              continue;
            }
          }
        }

        if (isRepeatDirective(val) || (Array.isArray(val) && isKeyedList(val))) {
          const { ops, currentKeys, currentHashes } = diffKeyedItems(p, val, body.state, ssrOptions);
          if (ops.length > 0) {
            frames.push({
              p,
              k: { p, ops },
            } as any);

            postState.__lit_keys = {
              ...(postState.__lit_keys as any),
              [p]: currentKeys,
            };
            postState.__lit_item_hashes = {
              ...(postState.__lit_item_hashes as any),
              [p]: currentHashes,
            };
          }
          continue;
        }

        if (isTemplateValue(val)) {
          const fragmentHtml = renderToString(val, ssrOptions);
          const templateId = extractTemplateId(val);
          const nestedValues = Array.isArray((val as any).values) ? (val as any).values : [];

          frames.push({
            p,
            f: {
              p,
              h: templateId,
              html: fragmentHtml,
              v: nestedValues,
            },
          } as any);
          continue;
        }

        const serializedValue = typeof val === 'symbol' && val.description === 'lit-nothing' ? null : val;
        frames.push({ p, v: serializedValue });
      }
    } else if (templateResult !== undefined) {
      frames.push({ p: 0, v: templateResult });
    }
  }

  if (actionResult !== undefined) {
    frames.push({ r: actionResult });
  }

  const nextSnapshotSeq = (body.snapshotSeq ?? 0) + 1;
  const signed = await createSignedStateSnapshot(body.tag, postState, secret, {
    ttlMs: stateTtlMs ?? 900_000,
    buildId: resolveServerBuildId(ElementClass, buildIdFallback),
    seq: nextSnapshotSeq,
    token: actionToken,
    publicAttrs: body.attrs,
  });
  frames.push({ s: signed.state, sig: signed.sig, sq: nextSnapshotSeq });

  return frames;
}

function findPrototypeAccessorDescriptor(proto: any, prop: string): PropertyDescriptor | undefined {
  let cur = proto;
  while (cur && cur !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(cur, prop);
    if (desc && (typeof desc.get === 'function' || typeof desc.set === 'function')) {
      return desc;
    }
    cur = Object.getPrototypeOf(cur);
  }
  return undefined;
}

async function runActionAndRevalidateLoaders(
  instance: any,
  ElementClass: any,
  declaredProps: Record<string, any>,
  actionContext: ActionContext,
  actionMeta: any,
  validatedArgs: unknown[],
): Promise<{ actionResult: unknown; preActionSnapshot: Map<string, unknown> }> {
  const preActionSnapshot = new Map<string, unknown>();
  const staticWrites: string[] = Array.isArray(actionMeta?.writes) ? actionMeta.writes : [];
  const trackedKeys = new Set<string>([...Object.keys(declaredProps), ...staticWrites]);
  for (const prop of trackedKeys) {
    preActionSnapshot.set(prop, cloneStateValue(instance[prop]));
  }

  const writtenByAction = new Set<string>(staticWrites);
  const savedInterceptors: Array<() => void> = [];
  const proto = Object.getPrototypeOf(instance);

  for (const prop of trackedKeys) {
    const ownDesc = Object.getOwnPropertyDescriptor(instance, prop);
    if (ownDesc && !ownDesc.configurable) continue;
    const protoAccessor = ownDesc ? (ownDesc.get || ownDesc.set ? ownDesc : undefined) : findPrototypeAccessorDescriptor(proto, prop);
    let currentValue = protoAccessor?.get ? undefined : ownDesc ? ownDesc.value : instance[prop];

    try {
      Object.defineProperty(instance, prop, {
        configurable: true,
        enumerable: ownDesc ? ownDesc.enumerable : true,
        get() {
          return protoAccessor?.get ? protoAccessor.get.call(this) : currentValue;
        },
        set(next: unknown) {
          writtenByAction.add(prop);
          if (protoAccessor?.set) {
            protoAccessor.set.call(this, next);
          } else {
            currentValue = next;
          }
        },
      });
      savedInterceptors.push(() => {
        try {
          if (ownDesc) {
            if ('value' in ownDesc) {
              Object.defineProperty(instance, prop, { ...ownDesc, value: protoAccessor?.get ? protoAccessor.get.call(instance) : currentValue });
            } else {
              Object.defineProperty(instance, prop, ownDesc);
            }
          } else if (protoAccessor) {
            delete instance[prop];
          } else if (writtenByAction.has(prop) || currentValue !== undefined) {
            Object.defineProperty(instance, prop, {
              value: currentValue,
              writable: true,
              enumerable: true,
              configurable: true,
            });
          } else {
            delete instance[prop];
          }
        } catch {}
      });
    } catch {}
  }

  let actionResult: unknown;
  try {
    actionResult = await executeServerAction(instance, actionContext, actionMeta.name, validatedArgs);
  } finally {
    for (let i = savedInterceptors.length - 1; i >= 0; i--) {
      savedInterceptors[i]();
    }
  }

  const actionMutatedProps = new Map<string, unknown>();
  for (const prop of trackedKeys) {
    if (writtenByAction.has(prop) || !canonicalEqual(instance[prop], preActionSnapshot.get(prop))) {
      actionMutatedProps.set(prop, cloneStateValue(instance[prop]));
    }
  }

  if (actionMeta.revalidate !== false) {
    const loaders = ElementClass.__lit_loaders;
    if (loaders && typeof loaders === 'object') {
      for (const [loaderName, loaderMeta] of Object.entries(loaders)) {
        const lMeta = loaderMeta as any;
        const deps: string[] | undefined = lMeta?.deps ?? lMeta?.dependencies;
        await executeServerLoader(instance, actionContext, loaderName);
        for (const [prop, val] of actionMutatedProps.entries()) {
          if (!deps?.includes(prop)) {
            instance[prop] = cloneStateValue(val);
          }
        }
      }
    } else if (typeof instance.load === 'function') {
      await executeServerLoader(instance, actionContext, 'load');
      for (const [prop, val] of actionMutatedProps.entries()) {
        instance[prop] = cloneStateValue(val);
      }
    }
  }

  return { actionResult, preActionSnapshot };
}

/**
 * Handles incoming POST /_lit/a/<actionHash> requests.
 * Enforces CSRF, HMAC state signatures, schema validation, and ndjson/batch streaming.
 */
export async function handleActionRequest(request: Request, options: ActionEndpointOptions): Promise<Response> {
  installIsolateGlobals();

  const isDev = options.devMode === true;

  let secret = options.secret || (options.env?.LIT_ACTION_SECRET as string);
  if (!secret) {
    if (isDev) {
      secret = 'lit-server-element-dev-secret';
    } else {
      throw new Error(
        '[@lit-core/server-elements] Missing mandatory secret key for HMAC state signing. ' +
          'Configure options.secret or the LIT_ACTION_SECRET binding, or pass devMode: true for local development only.',
      );
    }
  }

  const routePrefix = options.routePrefix || '/_lit/a/';
  const url = new URL(request.url);

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  if (!url.pathname.startsWith(routePrefix)) {
    return new Response('Not Found', { status: 404 });
  }

  const actionHash = url.pathname.slice(routePrefix.length).replace(/\/$/, '');
  if (!actionHash || !/^[0-9a-zA-Z_-]{16}$/.test(actionHash)) {
    return createJsonResponse(400, { error: 'Invalid action hash format', code: 'INVALID_HASH' });
  }

  const MAX_ACTION_BODY_BYTES = 64 * 1024;
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_ACTION_BODY_BYTES) {
    return createJsonResponse(413, { error: 'Request body exceeds 64 KB limit', code: 'PAYLOAD_TOO_LARGE' });
  }

  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return createJsonResponse(400, { error: 'Failed to read request body', code: 'INVALID_PAYLOAD' });
  }

  if (new TextEncoder().encode(rawText).byteLength > MAX_ACTION_BODY_BYTES) {
    return createJsonResponse(413, { error: 'Request body exceeds 64 KB limit', code: 'PAYLOAD_TOO_LARGE' });
  }

  const origin = request.headers.get('Origin');
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  const hasCookies = Boolean(request.headers.get('Cookie'));

  if (hasCookies) {
    const isSameOrigin = origin ? origin === url.origin : secFetchSite === 'same-origin';
    const isAllowedOrigin = options.allowedOrigins?.some((allowed) => allowed === origin);
    if (!isSameOrigin && !isAllowedOrigin) {
      return createJsonResponse(403, {
        error: 'Action requests with credentials require matching Origin or same-origin Sec-Fetch-Site',
        code: 'CSRF_BLOCKED',
      });
    }
  } else if (origin && origin !== url.origin) {
    if (!options.allowedOrigins?.includes(origin)) {
      return createJsonResponse(403, {
        error: 'Cross-origin action requests forbidden',
        code: 'CSRF_BLOCKED',
      });
    }
  } else if (secFetchSite === 'cross-site') {
    return createJsonResponse(403, {
      error: 'Cross-site action requests forbidden',
      code: 'CSRF_BLOCKED',
    });
  }

  let body: ActionRequestBody;
  try {
    body = JSON.parse(rawText);
  } catch {
    return createJsonResponse(400, { error: 'Invalid JSON request payload', code: 'INVALID_JSON' });
  }

  if (!body || typeof body !== 'object' || !body.tag || !Array.isArray(body.args)) {
    return createJsonResponse(400, {
      error: 'Malformed action request body',
      code: 'INVALID_PAYLOAD',
    });
  }

  if (hasPrototypePollution(body.attrs) || hasPrototypePollution(body.state) || hasPrototypePollution(body.args) || hasPrototypePollution(body)) {
    return createJsonResponse(400, {
      error: 'Prototype pollution payload rejected',
      code: 'PROTOTYPE_POLLUTION',
    });
  }

  const registry = options.customElements || options.registry || (globalThis as any).customElements;
  const ElementClass = registry?.get ? registry.get(body.tag) : undefined;
  if (!ElementClass) {
    return createJsonResponse(404, {
      error: `Element '<${body.tag}>' not found`,
      code: 'ELEMENT_NOT_FOUND',
    });
  }

  const serverBuildId = resolveServerBuildId(ElementClass, options.buildId ?? (options.env as any)?.LIT_BUILD_ID);
  const clientBuildId = body.attrs?.['data-lit-build-id'];
  if (clientBuildId !== undefined && clientBuildId !== serverBuildId) {
    return createJsonResponse(409, {
      error: `Action state is stale (build mismatch: client ${clientBuildId || 'none'} vs server ${serverBuildId || 'none'})`,
      code: 'ACTION_STALE',
    });
  }

  const state = body.state || {};
  const sig = body.sig;
  if (typeof sig !== 'string' || !/^\d+\.[0-9a-f]{64}$/i.test(sig)) {
    return createJsonResponse(403, { error: 'Missing or malformed state signature', code: 'STATE_TAMPERED' });
  }

  const snapshotSeq = body.snapshotSeq ?? 0;
  if (!Number.isSafeInteger(snapshotSeq) || snapshotSeq < 0) {
    return createJsonResponse(400, { error: 'Invalid snapshot sequence', code: 'INVALID_PAYLOAD' });
  }

  const actionToken = request.headers.get('X-Lit-Action-Token') || '';
  const bodyToken = body.attrs?.['data-lit-token'];
  if (!actionToken || (bodyToken !== undefined && bodyToken !== actionToken)) {
    return createJsonResponse(403, { error: 'Action token mismatch', code: 'TOKEN_MISMATCH' });
  }

  const isAuthentic = await verifyStateSignature(body.tag, state, sig, secret, {
    buildId: serverBuildId,
    seq: snapshotSeq,
    publicAttrs: body.attrs,
    token: actionToken,
  });
  if (!isAuthentic) {
    return createJsonResponse(403, { error: 'Invalid or expired state signature', code: 'STATE_TAMPERED' });
  }

  const actionMeta = ElementClass.__lit_actions?.[actionHash];
  if (!actionMeta) {
    return createJsonResponse(404, {
      error: `Action '${actionHash}' not found on <${body.tag}>`,
      code: 'ACTION_NOT_FOUND',
    });
  }

  let validatedArgs: unknown[];
  try {
    validatedArgs = typeof actionMeta.validate === 'function' ? actionMeta.validate(body.args) : body.args;
  } catch (err: any) {
    return createJsonResponse(400, {
      error: err.message || 'Validation error',
      code: 'VALIDATION_ERROR',
    });
  }

  const outgoingCookies: string[] = [];
  const outgoingHeaders = new Headers();

  const actionContext: ActionContext = {
    env: options.env,
    request,
    url,
    params: {},
    signal: request.signal,
    cookies: parseCookies(request.headers.get('Cookie')),
    headers: request.headers,
    seq: body.seq,
    clientState: Object.freeze({ ...state }),
    actionToken: request.headers.get('X-Lit-Action-Token') || body.attrs?.['data-lit-token'] || '',
    setCookie(name: string, value: string, cookieOpts?: CookieOptions) {
      outgoingCookies.push(serializeCookie(name, value, cookieOpts));
    },
    setHeader(name: string, value: string) {
      outgoingHeaders.append(name, value);
    },
  };

  const declaredProps = collectDeclaredProperties(ElementClass);
  const instance = new ElementClass();
  if (typeof instance.enableUpdating === 'function') {
    instance.enableUpdating = () => {};
  }

  const observed = ElementClass.observedAttributes || [];
  if (body.attrs && typeof body.attrs === 'object') {
    for (const [name, val] of Object.entries(body.attrs)) {
      if (observed.includes(name)) {
        if (typeof instance.attributeChangedCallback === 'function') {
          instance.attributeChangedCallback(name, null, val);
        }
        if (typeof instance.setAttribute === 'function') {
          instance.setAttribute(name, val);
        }
      }
    }
  }

  for (const [k, v] of Object.entries(state)) {
    if (Object.hasOwn(declaredProps, k)) {
      (instance as any)[k] = cloneStateValue(v);
    }
  }
  (instance as any).__litState = { ...state };

  if (typeof instance._setContext === 'function') {
    instance._setContext(actionContext);
  } else {
    instance[CONTEXT_SYMBOL] = actionContext;
  }

  const acceptsNdjson = (request.headers.get('Accept') || '').includes('application/x-ndjson');

  if (acceptsNdjson) {
    let actionOutcome: { actionResult: unknown; preActionSnapshot: Map<string, unknown> } | null = null;
    let actionError: any = null;

    try {
      actionOutcome = await runActionAndRevalidateLoaders(instance, ElementClass, declaredProps, actionContext, actionMeta, validatedArgs);
    } catch (err: any) {
      actionError = err;
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const responseHeaders = new Headers(outgoingHeaders);
    responseHeaders.set('Content-Type', 'application/x-ndjson; charset=utf-8');
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');
    for (const c of outgoingCookies) {
      responseHeaders.append('Set-Cookie', c);
    }

    const response = new Response(readable, { status: 200, headers: responseHeaders });

    (async () => {
      try {
        if (actionError) {
          throw actionError;
        }

        const frames = await computeSurgicalPatches(
          instance,
          ElementClass,
          body,
          actionMeta,
          actionOutcome?.actionResult,
          secret,
          options.stateTtlMs,
          actionToken,
          serverBuildId,
          registry,
          actionOutcome?.preActionSnapshot,
        );

        for (const frame of frames) {
          await writer.write(encoder.encode(`${JSON.stringify(frame)}\n`));
        }
      } catch (err: any) {
        options.onError?.(err, request);
        const errorFrame: ErrorPatchFrame = {
          e: isDev ? String(err?.message || 'Internal server error') : 'Internal server error',
          code: isDev && err?.code ? err.code : 'INTERNAL_ERROR',
        };
        await writer.write(encoder.encode(`${JSON.stringify(errorFrame)}\n`)).catch(() => {});
      } finally {
        await writer.close().catch(() => {});
      }
    })();

    return response;
  }

  try {
    const { actionResult, preActionSnapshot } = await runActionAndRevalidateLoaders(instance, ElementClass, declaredProps, actionContext, actionMeta, validatedArgs);

    const frames = await computeSurgicalPatches(instance, ElementClass, body, actionMeta, actionResult, secret, options.stateTtlMs, actionToken, serverBuildId, registry, preActionSnapshot);

    const responseHeaders = new Headers(outgoingHeaders);
    responseHeaders.set('Content-Type', 'application/json');
    for (const c of outgoingCookies) {
      responseHeaders.append('Set-Cookie', c);
    }

    return new Response(JSON.stringify(frames), { status: 200, headers: responseHeaders });
  } catch (err: any) {
    options.onError?.(err, request);
    const responseHeaders = new Headers(outgoingHeaders);
    for (const c of outgoingCookies) {
      responseHeaders.append('Set-Cookie', c);
    }
    return createJsonResponse(500, { error: 'Internal server error', code: 'INTERNAL_ERROR' }, responseHeaders);
  }
}
