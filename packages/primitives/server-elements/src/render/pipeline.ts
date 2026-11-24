import { executeComponentLifecycleAndReflection, prepareComponentBindings, readLiveHostAttributesMap } from '@lit-core/ssr';
import type { Env } from '../context.js';
import { createSignedStateSnapshot, generateActionToken } from '../crypto.js';
import type { FormSnapshot } from '../element.js';
import { bindContext, runLoaders } from '../execution.js';
import type { ServerElementClass } from '../metadata.js';
import { FORM_TICKET_SEQ } from '../protocol.js';
import { createStateSealer } from '../state-sealer.js';
import { FORM_SNAPSHOT_SYMBOL } from '../symbols.js';
import type { ServerElementRenderOptions, WireState } from '../types.js';
import { createLoaderContext } from './loader-context.js';

const VALID_PUBLIC_ATTRIBUTE = /^[a-zA-Z_][-a-zA-Z0-9_.:]*$/;

type Input = Record<string, unknown>;
type PropDeclarations = ReturnType<typeof prepareComponentBindings>['propDeclarations'];

export interface PreparedServerElement {
  tagName: string;
  hostId: number;
  state: Record<string, unknown>;
  sig: string;
  token: string;
  buildId: string;
  /** Attributes to set on the host; `null` removes a server-side attribute. */
  hostAttributes: Record<string, string | null>;
  /** The element's `render()` output, not yet serialized. */
  shadowRenderResult: unknown;
}

/** String-valued input, the way the HTML parser would have delivered it as attributes. */
function toStaticAttributes(input: Input): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== 'data-lit-ssr' && value !== undefined && value !== null) {
      attrs[key] = String(value);
    }
  }
  return attrs;
}

/** Applies programmatic (non-string) props directly, and string props the element did not already default. */
function applyProgrammaticProps(instance: any, input: Input, staticAttrs: Record<string, string>, declarations: PropDeclarations, changed: Map<PropertyKey, unknown>): void {
  for (const [key, value] of Object.entries(input)) {
    if (key === 'data-lit-ssr') continue;
    if (typeof value !== 'string') {
      instance[key] = value;
      if (!changed.has(key)) changed.set(key, undefined);
    } else if ((!(key in staticAttrs) || declarations.has(key)) && typeof instance[key] === 'undefined') {
      instance[key] = value;
    }
  }
}

/** The signed state: every declared property that holds a serializable value, plus accumulated `__lit*` state. */
function collectState(instance: any, Ctor: ServerElementClass, declarations: PropDeclarations): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const declaredProps = ((Ctor as { properties?: Record<string, { state?: boolean }> }).properties ?? {}) as Record<string, { state?: boolean }>;
  for (const key of new Set([...declarations.keys(), ...Object.keys(declaredProps)])) {
    const value = instance[key];
    if (value !== undefined && typeof value !== 'function' && typeof value !== 'symbol') {
      state[key] = value;
    }
  }
  if (instance.__litState && typeof instance.__litState === 'object') {
    Object.assign(state, instance.__litState);
  }
  return state;
}

/** Input that is neither a reactive property nor internal: attributes the client must echo back, bound into the signature. */
function collectPublicAttributes(input: Input, Ctor: ServerElementClass, declarations: PropDeclarations): Record<string, string> {
  const declaredProps = (Ctor as { properties?: object }).properties ?? {};
  const publicAttrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('data-lit-') || key.startsWith('__lit')) continue;
    if (Object.hasOwn(declaredProps, key) || declarations.has(key)) continue;
    if (!VALID_PUBLIC_ATTRIBUTE.test(key)) {
      throw new Error(`[@lit-core/server-elements] Invalid public attribute name '${key}'.`);
    }
    publicAttrs[key] = String(value);
  }
  return publicAttrs;
}

interface HostAttributeInput {
  instance: any;
  staticAttrs: Record<string, string>;
  publicAttrs: Record<string, string>;
  hostId: number;
  sig: string;
  token: string;
  buildId: string;
  wireState: WireState;
}

function buildHostAttributes(input: HostAttributeInput): Record<string, string | null> {
  const { instance, staticAttrs, publicAttrs, hostId, sig, token, buildId, wireState } = input;
  const live = readLiveHostAttributesMap(instance);
  const attrs: Record<string, string | null> = {};

  for (const name of Object.keys(staticAttrs)) {
    if (!live.has(name.toLowerCase()) && !(name in publicAttrs)) {
      attrs[name] = null;
    }
  }
  for (const [name, value] of live.entries()) {
    attrs[name] = value;
  }
  Object.assign(attrs, publicAttrs);
  if (Object.keys(publicAttrs).length > 0) {
    attrs['data-lit-attrs'] = Object.keys(publicAttrs).join(' ');
  }

  attrs['data-lit-ssr'] = String(hostId);
  attrs['data-lit-sig'] = sig;
  attrs['data-lit-token'] = token;
  attrs['data-lit-state'] = typeof wireState === 'string' ? wireState : JSON.stringify(wireState);
  if (buildId) {
    attrs['data-lit-build-id'] = buildId;
  }
  return attrs;
}

/**
 * Runs one server element through its server lifecycle: binds props, runs loaders, runs Lit's
 * update lifecycle and attribute reflection, signs the resulting state, and evaluates `render()`.
 *
 * Shared by `renderServerElement` and the `HTMLRewriter` adapter so both paths produce identical output.
 */
export async function prepareServerElement(
  instance: any,
  Ctor: ServerElementClass,
  tagName: string,
  input: Input,
  hostId: number,
  options: ServerElementRenderOptions,
  secret: string | CryptoKey,
): Promise<PreparedServerElement> {
  const staticAttrs = toStaticAttributes(input);
  const { propDeclarations, changedProperties } = prepareComponentBindings({ instance, Ctor, tagName, staticAttrs, resumable: false });
  applyProgrammaticProps(instance, input, staticAttrs, propDeclarations, changedProperties);

  const loaderContext = createLoaderContext(options.request, options.env as Env, options.params);
  bindContext(instance, loaderContext);
  await runLoaders(instance, Ctor, loaderContext);

  // Properties a loader populated count as changed for the lifecycle and reflection that follow.
  for (const prop of propDeclarations.keys()) {
    try {
      if (instance[prop] !== undefined && !changedProperties.has(prop)) {
        changedProperties.set(prop, undefined);
      }
    } catch {}
  }
  executeComponentLifecycleAndReflection(instance, tagName, propDeclarations, changedProperties, { onError: options.onError, strictLifecycle: options.strict });

  const state = collectState(instance, Ctor, propDeclarations);
  const publicAttrs = collectPublicAttributes(input, Ctor, propDeclarations);
  const token = options.token || generateActionToken();
  const buildId = typeof Ctor.__litBuildId === 'string' ? Ctor.__litBuildId : '';
  const { sig } = await createSignedStateSnapshot(tagName, state, secret, { ttlMs: options.ttlMs, token, buildId, seq: 0, publicAttrs });
  const wireState = await createStateSealer(secret, options.encryptState === true).seal(tagName, state);
  const { sig: ticketSig } = await createSignedStateSnapshot(tagName, {}, secret, { ttlMs: options.ttlMs, token, buildId, seq: FORM_TICKET_SEQ, publicAttrs });
  const formSnapshot: FormSnapshot = { tag: tagName, sig: ticketSig, token, attrs: { ...publicAttrs, 'data-lit-token': token, ...(buildId ? { 'data-lit-build-id': buildId } : {}) } };
  instance[FORM_SNAPSHOT_SYMBOL] = formSnapshot;

  return {
    tagName,
    hostId,
    state,
    sig,
    token,
    buildId,
    hostAttributes: buildHostAttributes({ instance, staticAttrs, publicAttrs, hostId, sig, token, buildId, wireState }),
    shadowRenderResult: instance.render?.(),
  };
}
