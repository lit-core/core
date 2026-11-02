/**
 * Options for configuring @loader() decorators.
 */
export interface LoaderOptions {
  /**
   * Revalidation policy.
   * - 'always': Re-run loader on every action execution (default).
   * - 'action': Re-run loader only when actions explicitly trigger it.
   * - number: Time-to-live cache duration in milliseconds.
   */
  revalidate?: 'always' | 'action' | number;
  /**
   * Explicit list of reactive properties whose modification triggers this loader.
   */
  dependencies?: string[];
}

/**
 * Options for configuring @action() decorators.
 */
export interface ActionOptions {
  /**
   * Optional custom action identifier name (defaults to class method name).
   */
  name?: string;
  /**
   * Whether to re-run component loaders after this action completes (default: true).
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
export interface ActionRequestBody {
  tag: string;
  attrs: Record<string, string>;
  state: Record<string, unknown>;
  sig: string;
  args: unknown[];
  /** Client request counter, used only to order responses and drop stale ones. Not signed. */
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
 * Structural range branch swap frame with template fingerprint ({p, f, h}).
 */
export interface StructuralPatchFrame {
  p: number;
  f: string;
  h: string;
}

/**
 * Keyed list reconciliation frame ({p, k}).
 */
export interface KeyedListPatchFrame {
  p: number;
  k: unknown;
}

/**
 * Signed state snapshot frame ({s, sig}).
 */
export interface StateSnapshotPatchFrame {
  s: Record<string, unknown>;
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
}

/**
 * Action result frame ({r}).
 */
export interface ActionResultPatchFrame {
  r: unknown;
}

/**
 * Aliases for patch frame types adhering to alternate naming conventions.
 */
export type PartValuePatchFrame = ScalarPatchFrame;
export type PartTemplatePatchFrame = StructuralPatchFrame;
export type KeyedChildrenPatchFrame = KeyedListPatchFrame;
export type ActionErrorPatchFrame = ErrorPatchFrame;

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
  customElements?: any;
  registry?: any;
  mode?: 'dsd' | 'flattened';
  devMode?: boolean;
  token?: string;
  hostId?: number;
  /** Rethrow errors from `connectedCallback` instead of reporting them through `onError`. */
  strict?: boolean;
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
  streamingMode?: 'out-of-order' | 'in-order' | 'sync';
}
