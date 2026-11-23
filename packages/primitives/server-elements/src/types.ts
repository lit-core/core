import type { ServerElementRegistry } from './metadata.js';

/**
 * Options for configuring @loader() decorators.
 */
export interface LoaderOptions {
  /**
   * Reactive properties this loader depends on. After an action, the loader re-runs only when the
   * action wrote at least one of them. Omit to re-run after every action. Must be a literal array.
   */
  dependencies?: string[];
}

/**
 * Options for configuring @action() decorators.
 */
export interface ActionOptions {
  /**
   * Whether to re-run component loaders after this action completes (default: true).
   * Must be a boolean literal.
   */
  revalidate?: boolean;
}

/**
 * Reactive status for action execution.
 */
export type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * Reactive action state snapshot.
 */
export interface ActionState<TResult = unknown> {
  readonly status: ActionStatus;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly isError: boolean;
  readonly error: Error | null;
  readonly data: TResult | null;
}

/**
 * Standard HTTP cookie serialization options.
 */
export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

/**
 * Wire protocol request payload for action invocations.
 */
/**
 * State as it crosses the wire: readable JSON, or an opaque ciphertext string when `encryptState` is on.
 */
export type WireState = Record<string, unknown> | string;

export interface ActionRequestBody {
  tag: string;
  attrs: Record<string, string>;
  state: WireState;
  sig: string;
  args: unknown[];
  /** Client request counter, exposed to actions as `ActionContext.seq`. Not signed. */
  seq: number;
  /**
   * Sequence number of the signed snapshot (`sig`) the client holds. Bound into the signature;
   * defaults to 0, the snapshot issued by the initial server render.
   */
  snapshotSeq?: number;
}

/**
 * Scalar part update frame ({p: partIndex, v: value}).
 */
export interface ScalarPatchFrame {
  p: number;
  v: unknown;
}

/**
 * Structural range branch swap frame ({p, f}). `f` carries the template fingerprint, the
 * rendered fragment, and the nested binding values.
 */
export interface StructuralPatchFrame {
  p: number;
  f: {
    p: number;
    /** Template fingerprint (build-time id for compiled templates, content hash otherwise). */
    h: string;
    html: string;
    v: unknown[];
  };
}

/**
 * One keyed list reconciliation operation.
 */
export type KeyedOp =
  | { op: 'remove'; key: string | number }
  | { op: 'insert'; key: string | number; index: number; html?: string; text?: string }
  | { op: 'update'; key: string | number; html?: string; text?: string }
  | { op: 'reorder'; order: Array<string | number> }
  /** Clears the whole range and re-renders every item. Sent when the client holds no acknowledged key state for the part. */
  | { op: 'replace'; items: KeyedItem[] };

/** One rendered keyed list item: raw markup for template items, text otherwise. */
export interface KeyedItem {
  key: string | number;
  html?: string;
  text?: string;
}

/**
 * Keys and item fingerprints of a keyed list part, as last acknowledged by the client.
 */
export interface KeyedPartState {
  keys: Array<string | number>;
  fingerprints: Record<string | number, string>;
}

/**
 * Keyed list reconciliation frame ({p, k}).
 */
export interface KeyedListPatchFrame {
  p: number;
  k: { p: number; ops: KeyedOp[] };
}

/**
 * Signed state snapshot frame ({s, sig}).
 */
export interface StateSnapshotPatchFrame {
  s: WireState;
  sig: string;
  /** Sequence number this snapshot was signed with; send it back as `snapshotSeq`. */
  sq: number;
}

/**
 * Error boundary patch frame ({e, code}).
 */
export interface ErrorPatchFrame {
  e: string;
  code?: string;
  /** Per-field messages from an `ActionError`, keyed by input name. */
  fields?: Record<string, string>;
}

/**
 * Action result frame ({r}).
 */
export interface ActionResultPatchFrame {
  r: unknown;
}

/**
 * Union of all streamed action response patch frames.
 */
export type PatchFrame = ScalarPatchFrame | StructuralPatchFrame | KeyedListPatchFrame | StateSnapshotPatchFrame | ErrorPatchFrame | ActionResultPatchFrame;

/**
 * Generic class constructor type.
 */
export type Constructor<T = object> = new (...args: any[]) => T;

/**
 * Options for rendering a server element to Declarative Shadow DOM.
 */
export interface ServerElementRenderOptions {
  request?: Request;
  env?: Record<string, unknown>;
  params?: Record<string, string>;
  secret?: string | CryptoKey;
  ttlMs?: number;
  customElements?: ServerElementRegistry;
  mode?: 'dsd' | 'flattened';
  devMode?: boolean;
  token?: string;
  hostId?: number;
  /** Rethrow errors from `connectedCallback` instead of reporting them through `onError`. */
  strict?: boolean;
  /** Encrypt state in the page and in action responses. Needs a string `secret`; the action endpoint must enable it too. */
  encryptState?: boolean;
  /** Receives non-fatal lifecycle errors raised while rendering. */
  onError?: (error: unknown, info: { tagName?: string; phase: string }) => void;
}

/**
 * Result of rendering a server element.
 */
export interface ServerElementRenderResult {
  tagName: string;
  hostId: number;
  html: string;
  state: Record<string, unknown>;
  sig: string;
  token: string;
}

/**
 * Options for rendering a server element or template to a streaming HTTP Response.
 */
export interface EdgeResponseOptions extends ServerElementRenderOptions {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}
