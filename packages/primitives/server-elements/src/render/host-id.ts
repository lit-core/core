const hostIdCounters = new WeakMap<Request, number>();

/**
 * Allocates the `data-lit-ssr` host id for one server element.
 *
 * An explicit id wins. Otherwise ids count up per request, so every element on a page gets a
 * unique id even when several render concurrently. Without a request there is nothing to scope
 * the counter to, so the id is always 0.
 */
export function allocateHostId(options: { hostId?: number; request?: Request }): number {
  if (typeof options.hostId === 'number') {
    return options.hostId;
  }
  if (!options.request) {
    return 0;
  }
  const next = hostIdCounters.get(options.request) ?? 0;
  hostIdCounters.set(options.request, next + 1);
  return next;
}
