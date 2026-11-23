import { parse as parseCookieHeader, serialize as serializeCookieHeader } from 'cookie';
import type { CookieOptions } from './types.js';

/** Parses a `Cookie` request header into an ordered name to value map. */
export function parseCookies(cookieHeader: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }
  for (const [name, value] of Object.entries(parseCookieHeader(cookieHeader))) {
    if (name && value !== undefined) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/** Serializes one `Set-Cookie` header value. */
export function serializeCookie(name: string, value: string, options?: CookieOptions): string {
  return serializeCookieHeader(name, value, {
    maxAge: options?.maxAge,
    domain: options?.domain,
    path: options?.path,
    expires: options?.expires,
    httpOnly: options?.httpOnly,
    secure: options?.secure,
    sameSite: options?.sameSite?.toLowerCase() as CookieOptions['sameSite'],
  });
}
