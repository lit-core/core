import type { Env, LoaderContext } from '../context.js';
import { parseCookies } from '../cookies.js';

/** Creates the standard WinterCG `LoaderContext` for a request and its environment bindings. */
export function createLoaderContext<E = Env>(request?: Request, env: E = {} as E, params: Record<string, string> = {}): LoaderContext<E> {
  const req = request || new Request('http://localhost/');
  return {
    env,
    request: req,
    url: new URL(req.url),
    params: Object.freeze({ ...params }),
    signal: req.signal,
    cookies: parseCookies(req.headers.get('cookie')),
    headers: req.headers,
  };
}
