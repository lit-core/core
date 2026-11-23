import type { ActionContext, Env } from '../context.js';
import { parseCookies, serializeCookie } from '../cookies.js';
import { bindContext } from '../execution.js';
import type { ActionMeta } from '../metadata.js';
import type { OpenedActionRequest, StateSealer } from '../state-sealer.js';
import type { CookieOptions } from '../types.js';
import type { ActionFrameSource } from './action-frames.js';
import { cloneStateValue, collectDeclaredProperties, type DeclaredProperties } from './element-state.js';
import type { ValidatedActionRequest } from './validate-request.js';

/** Response metadata an action may set through its context. */
export interface OutgoingResponseState {
  headers: Headers;
  cookies: string[];
  /** Set once response headers are on the wire; later `setCookie` and `setHeader` calls can no longer take effect. */
  sealed: boolean;
}

/**
 * Everything one action request needs while it runs and while it is answered: the rehydrated
 * element, the context the action sees, and the response metadata the action may add to.
 */
export interface ActionScope {
  request: Request;
  url: URL;
  instance: any;
  ElementClass: ValidatedActionRequest['ElementClass'];
  declared: DeclaredProperties;
  context: ActionContext;
  actionMeta: ActionMeta;
  validatedArgs: unknown[];
  outgoing: OutgoingResponseState;
  /** What `actionFrames` needs to compute the response. */
  frameSource: ActionFrameSource;
  /** Set when the request was a plain form post, with the page's requested redirect. */
  form?: ValidatedActionRequest['form'];
  /** Reports an unexpected failure to the application's `onError` hook. */
  reportError: (error: unknown) => void;
}

function assertHeadersOpen(outgoing: OutgoingResponseState, what: string): void {
  if (outgoing.sealed) {
    throw new Error(`Cannot ${what}: the response has already started streaming. Set cookies and headers in the action itself, not in a loader that revalidates after it.`);
  }
}

function createActionContext(request: Request, url: URL, env: Env, body: OpenedActionRequest, token: string, outgoing: OutgoingResponseState): ActionContext {
  return {
    env,
    request,
    url,
    params: {},
    signal: request.signal,
    cookies: parseCookies(request.headers.get('Cookie')),
    headers: request.headers,
    seq: body.seq,
    clientState: Object.freeze({ ...body.state }),
    actionToken: token,
    setCookie(name: string, value: string, cookieOptions?: CookieOptions) {
      assertHeadersOpen(outgoing, 'set a cookie');
      outgoing.cookies.push(serializeCookie(name, value, cookieOptions));
    },
    setHeader(name: string, value: string) {
      assertHeadersOpen(outgoing, 'set a header');
      outgoing.headers.append(name, value);
    },
  };
}

/** Builds an element instance holding exactly the state and public attributes the client echoed. */
function rehydrateInstance(ElementClass: any, declared: DeclaredProperties, body: OpenedActionRequest, context: ActionContext): any {
  const instance = new ElementClass();
  if (typeof instance.enableUpdating === 'function') {
    instance.enableUpdating = () => {};
  }

  const observed: string[] = ElementClass.observedAttributes || [];
  for (const [name, value] of Object.entries(body.attrs ?? {})) {
    if (observed.includes(name)) {
      instance.attributeChangedCallback?.(name, null, value);
      instance.setAttribute?.(name, value);
    }
  }

  const state = body.state ?? {};
  for (const [key, value] of Object.entries(state)) {
    if (Object.hasOwn(declared, key)) {
      instance[key] = cloneStateValue(value);
    }
  }
  instance.__litState = { ...state };

  bindContext(instance, context);
  return instance;
}

export interface ActionScopeInput {
  request: Request;
  url: URL;
  env: Env;
  validated: ValidatedActionRequest;
  secret: string | CryptoKey;
  stateTtlMs?: number;
  customElements?: { get(tagName: string): unknown };
  sealer: StateSealer;
  reportError: (error: unknown) => void;
}

/** Rehydrates the element a validated request addresses and gathers everything needed to run and answer it. */
export function createActionScope(input: ActionScopeInput): ActionScope {
  const { request, url, validated } = input;
  const { body, ElementClass, actionMeta, validatedArgs, actionToken, serverBuildId } = validated;

  const outgoing: OutgoingResponseState = { headers: new Headers(), cookies: [], sealed: false };
  const context = createActionContext(request, url, input.env, body, actionToken || body.attrs?.['data-lit-token'] || '', outgoing);
  const declared = collectDeclaredProperties(ElementClass);
  const instance = rehydrateInstance(ElementClass, declared, body, context);

  return {
    request,
    url,
    instance,
    ElementClass,
    declared,
    context,
    actionMeta,
    validatedArgs,
    outgoing,
    form: validated.form,
    reportError: input.reportError,
    frameSource: {
      instance,
      ElementClass,
      body,
      actionWrites: actionMeta.writes,
      secret: input.secret,
      stateTtlMs: input.stateTtlMs,
      actionToken,
      buildIdFallback: serverBuildId,
      customElements: input.customElements,
      sealer: input.sealer,
    },
  };
}

/** Merges response headers with the headers and cookies the action set, later values winning. */
export function applyOutgoing(headers: Headers, outgoing: OutgoingResponseState): Headers {
  const merged = new Headers(outgoing.headers);
  for (const [name, value] of headers) {
    merged.set(name, value);
  }
  for (const cookie of outgoing.cookies) {
    merged.append('Set-Cookie', cookie);
  }
  return merged;
}
