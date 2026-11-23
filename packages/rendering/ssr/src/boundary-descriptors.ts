import { LIT_NOTHING, SSR_ASYNC_BOUNDARY } from './sentinels.js';

export const SSR_BOUNDARY_PAYLOAD = Symbol('lit-core.ssr.boundary-payload');

export interface SsrBoundaryPayload {
  readonly [SSR_BOUNDARY_PAYLOAD]: true;
  readonly content: unknown;
  readonly hostAttributes?: Record<string, string | null>;
}

export function createBoundaryPayload(content: unknown, hostAttributes?: Record<string, string | null>): SsrBoundaryPayload {
  return {
    [SSR_BOUNDARY_PAYLOAD]: true,
    content,
    hostAttributes,
  };
}

export function isBoundaryPayload(value: unknown): value is SsrBoundaryPayload {
  return value !== null && typeof value === 'object' && (value as any)[SSR_BOUNDARY_PAYLOAD] === true;
}

/**
 * How the boundaries of one group are revealed to the browser.
 *
 * - `together`: nothing in the group is swapped in until every boundary in it has settled, then all swap at once.
 * - `forwards`: boundaries swap in registration (document) order, so a slow one holds back the ones after it.
 *
 * Boundaries without a group swap in as soon as they settle.
 */
export type RevealOrder = 'together' | 'forwards';

export interface BoundaryGroup {
  /** Boundaries sharing an id are revealed according to `reveal`. */
  readonly id: string;
  readonly reveal: RevealOrder;
}

export interface AsyncBoundaryOptions {
  readonly errorFallback?: (error: unknown) => unknown;
  /** Reveal this boundary together with, or in order with, others. */
  readonly group?: BoundaryGroup;
}

export interface SsrAsyncBoundaryDescriptor {
  readonly [SSR_ASYNC_BOUNDARY]: true;
  readonly promise: Promise<unknown>;
  readonly fallback: unknown;
  readonly errorFallback?: (error: unknown) => unknown;
  readonly group?: BoundaryGroup;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as any).then === 'function';
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any)[Symbol.asyncIterator] === 'function';
}

export function isAsyncBoundaryDescriptor(value: unknown): value is SsrAsyncBoundaryDescriptor {
  return value !== null && typeof value === 'object' && (value as any)[SSR_ASYNC_BOUNDARY] === true;
}

export function createAsyncBoundary(promise: PromiseLike<unknown>, fallback: unknown = LIT_NOTHING, options: AsyncBoundaryOptions | ((error: unknown) => unknown) = {}): SsrAsyncBoundaryDescriptor {
  const { errorFallback, group } = typeof options === 'function' ? { errorFallback: options, group: undefined } : options;
  return {
    [SSR_ASYNC_BOUNDARY]: true,
    promise: Promise.resolve(promise),
    fallback,
    errorFallback,
    group,
  };
}
