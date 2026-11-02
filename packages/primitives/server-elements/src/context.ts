import type { CookieOptions } from './types.js';

/**
 * Open extensible interface representing WinterCG / Cloudflare Workers environment bindings.
 */
export interface Env {
  [key: string]: unknown;
}

/**
 * Execution context supplied to @loader() methods.
 */
export interface LoaderContext<E = Env> {
  /** Edge bindings environment (Cloudflare Workers env / WinterCG context) */
  readonly env: E;
  /** Standard incoming HTTP Request */
  readonly request: Request;
  /** Parsed request URL */
  readonly url: URL;
  /** Matched route parameters */
  readonly params: Readonly<Record<string, string>>;
  /** Abort signal for request cancellation */
  readonly signal: AbortSignal;
  /** Parsed request cookies */
  readonly cookies: ReadonlyMap<string, string>;
  /** Incoming HTTP Headers */
  readonly headers: Headers;
}

/**
 * Execution context supplied to @action() methods.
 */
export interface ActionContext<E = Env> extends LoaderContext<E> {
  /** Monotonic invocation sequence number from client instance */
  readonly seq: number;
  /** Validated client state snapshot */
  readonly clientState: Readonly<Record<string, unknown>>;
  /** Validated per-render action token */
  readonly actionToken: string;
  /** Helper to set outgoing response cookies */
  setCookie(name: string, value: string, options?: CookieOptions): void;
  /** Helper to append outgoing HTTP response headers */
  setHeader(name: string, value: string): void;
}
