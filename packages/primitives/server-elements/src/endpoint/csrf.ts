export interface CsrfInput {
  /** Value of the `Origin` request header, if present. */
  origin: string | null;
  /** Value of the `Sec-Fetch-Site` request header, if present. */
  secFetchSite: string | null;
  /** Whether the request carries ambient credentials (cookies). */
  hasCredentials: boolean;
  /** Origin of the URL the request was sent to. */
  serverOrigin: string;
  /** Extra origins permitted to call the endpoint. */
  allowedOrigins?: readonly string[];
}

export type CsrfVerdict = { allowed: true } | { allowed: false; message: string };

/**
 * Decides whether an action request may proceed.
 *
 * Requests carrying cookies must prove same-origin through `Origin` or `Sec-Fetch-Site`.
 * Cookie-less requests are rejected only when they positively declare a foreign origin or
 * a cross-site fetch, because they cannot ride on a victim's ambient authority.
 */
export function evaluateCsrf(input: CsrfInput): CsrfVerdict {
  const { origin, secFetchSite, hasCredentials, serverOrigin, allowedOrigins } = input;
  const isAllowlisted = origin !== null && Boolean(allowedOrigins?.includes(origin));

  if (hasCredentials) {
    const isSameOrigin = origin !== null ? origin === serverOrigin : secFetchSite === 'same-origin';
    return isSameOrigin || isAllowlisted ? { allowed: true } : { allowed: false, message: 'Action requests with credentials require matching Origin or same-origin Sec-Fetch-Site' };
  }

  if (origin !== null && origin !== serverOrigin) {
    return isAllowlisted ? { allowed: true } : { allowed: false, message: 'Cross-origin action requests forbidden' };
  }
  if (secFetchSite === 'cross-site') {
    return { allowed: false, message: 'Cross-site action requests forbidden' };
  }
  return { allowed: true };
}
