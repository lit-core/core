import 'virtual:lit-core/install-globals';
import { handleActionRequest } from '@lit-core/server-elements/action-endpoint';
import { createDurableObjectReplayGuard } from '@lit-core/server-elements/cloudflare';
import { renderServerElement, transformServerElementsWithHtmlRewriter } from '@lit-core/server-elements/edge';
import { initSsrWasmSync } from '@lit-core/ssr';
import ssrWasmModule from './ssr_bg.wasm';
import './greeting.js';
import './stats.js';
import './todo-list.js';

export { ReplayGuardStore } from '@lit-core/server-elements/cloudflare';
export { TodoStore } from './todo-store.js';

initSsrWasmSync(ssrWasmModule);

interface WorkerEnv {
  SECRET: string;
  /** Signed state lifetime in milliseconds; the library default when absent. Tests set it small to watch pages expire. */
  STATE_TTL_MS?: string;
  CLIENT_JS: string;
  REPLAYS: Parameters<typeof createDurableObjectReplayGuard>[0];
  [binding: string]: unknown;
}

const shell = (body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Server elements demo</title><script type="module" src="/client.js"></script></head><body><h1>Tasks</h1>${body}</body></html>`;

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const lifetime = (env: WorkerEnv) => (env.STATE_TTL_MS ? Number(env.STATE_TTL_MS) : undefined);

const registry = () => (globalThis as unknown as { customElements?: never }).customElements;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/client.js') {
      return new Response(env.CLIENT_JS, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/_lit/a/')) {
      return handleActionRequest(request, { env, secret: env.SECRET, stateTtlMs: lifetime(env), customElements: registry(), replayGuard: createDurableObjectReplayGuard(env.REPLAYS) });
    }
    // Loaders finish before the page is sent, so the list and its forms are in the HTML itself and work with scripts off.
    if (url.pathname === '/') {
      const ssr = await renderServerElement('demo-todos', {}, { secret: env.SECRET, env, request, mode: 'dsd', ttlMs: lifetime(env), customElements: registry() });
      const greeting = await renderServerElement('demo-greeting', {}, { secret: env.SECRET, env, request, mode: 'dsd', ttlMs: lifetime(env), customElements: registry() });
      return html(shell(`${greeting.html}${ssr.html}`));
    }
    // The shell streams first and each element swaps in as its loaders settle. That swap is a script, so this route needs JavaScript.
    if (url.pathname === '/stream') {
      const response = transformServerElementsWithHtmlRewriter(shell('<demo-greeting></demo-greeting><demo-stats></demo-stats><demo-todos></demo-todos>'), {
        request,
        env,
        secret: env.SECRET,
        tagManifest: ['demo-greeting', 'demo-stats', 'demo-todos'],
        customElements: registry(),
      });
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(response.body, { status: response.status, headers });
    }
    // Both elements are registered, but only demo-stats is listed, so only it is expanded: the greeting's loader never runs.
    if (url.pathname === '/unlisted') {
      const response = transformServerElementsWithHtmlRewriter(shell('<demo-greeting></demo-greeting><demo-stats></demo-stats>'), {
        request,
        env,
        secret: env.SECRET,
        tagManifest: ['demo-stats'],
        customElements: registry(),
      });
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(response.body, { status: response.status, headers });
    }
    return new Response('Not found', { status: 404 });
  },
};
