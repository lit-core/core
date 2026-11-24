import { installIsolateGlobals } from '@lit-core/ssr';
import type { Env } from './context.js';
import { createActionScope } from './endpoint/action-scope.js';
import { EndpointError } from './endpoint/endpoint-error.js';
import { isFormRequest } from './endpoint/form-payload.js';
import { errorPageResponse } from './endpoint/form-response.js';
import { chooseTransport, respondBuffered, respondStreaming, respondToForm } from './endpoint/responders.js';
import { validateActionRequest } from './endpoint/validate-request.js';
import type { ServerElementRegistry } from './metadata.js';
import { DEFAULT_ROUTE_PREFIX } from './protocol.js';
import type { ReplayGuard } from './replay-guard.js';
import { resolveMandatorySecret } from './secret.js';
import { createStateSealer } from './state-sealer.js';

export { createMemoryReplayGuard, type ReplayGuard } from './replay-guard.js';

export interface ActionEndpointOptions {
  /** Edge bindings environment (Cloudflare Workers env / WinterCG context) */
  env: Env;
  /** Secret key for HMAC-SHA256 signature verification */
  secret: string | CryptoKey;
  /** Custom element registry or build-time tag manifest. Defaults to the global `customElements`. */
  customElements?: ServerElementRegistry;
  /** Route prefix to match and strip (defaults to '/_lit/a/') */
  routePrefix?: string;
  /** Optional allowed origins for CSRF validation (defaults to same-origin) */
  allowedOrigins?: string[];
  /** State signature time-to-live in milliseconds (defaults to 15 minutes = 900,000ms) */
  stateTtlMs?: number;
  /** Optional custom error handler */
  onError?: (error: unknown, req: Request) => void;
  /** Optional development mode flag */
  devMode?: boolean;
  /** Optional server build identifier */
  buildId?: string;
  /** Expect encrypted state, as produced by rendering with `encryptState`. Needs a string `secret`. */
  encryptState?: boolean;
  /** Makes each signed snapshot single-use. See `ReplayGuard`. Omitted, snapshots can be replayed until they expire. */
  replayGuard?: ReplayGuard;
  /**
   * Largest request body to accept, in bytes (defaults to 64 KB). A JSON action request carries the element's
   * whole state, so an element holding a large list needs more.
   */
  maxBodyBytes?: number;
}

/**
 * Handles incoming POST /_lit/a/<actionHash> requests.
 *
 * Validates origin, size, signature and arguments first, then runs the action and answers over the
 * transport the request used: a form post redirects, `Accept: application/x-ndjson` streams patch
 * frames, anything else gets one JSON array.
 */
export async function handleActionRequest(request: Request, options: ActionEndpointOptions): Promise<Response> {
  installIsolateGlobals();

  const secret = resolveMandatorySecret({ secret: options.secret, env: options.env, devMode: options.devMode });
  const sealer = createStateSealer(secret, options.encryptState === true);

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  const url = new URL(request.url);
  const customElements: ServerElementRegistry | undefined = options.customElements ?? (globalThis as any).customElements;

  let validated: Awaited<ReturnType<typeof validateActionRequest>>;
  try {
    validated = await validateActionRequest(request, url, {
      routePrefix: options.routePrefix || DEFAULT_ROUTE_PREFIX,
      allowedOrigins: options.allowedOrigins,
      secret,
      customElements,
      buildIdFallback: options.buildId ?? (options.env?.LIT_BUILD_ID as string | undefined),
      replayGuard: options.replayGuard,
      maxBodyBytes: options.maxBodyBytes,
      sealer,
    });
  } catch (err) {
    if (err instanceof EndpointError) {
      // A browser that posted a plain form cannot read JSON, so it gets a page it can display.
      return isFormRequest(request) ? errorPageResponse(err.status, err.message, new Headers(), err.fields) : err.toResponse();
    }
    throw err;
  }

  const scope = createActionScope({
    request,
    url,
    env: options.env,
    validated,
    secret,
    stateTtlMs: options.stateTtlMs,
    customElements,
    sealer,
    reportError: (error) => options.onError?.(error, request),
  });

  switch (chooseTransport(request, validated.form !== undefined)) {
    case 'form':
      return respondToForm(scope);
    case 'ndjson':
      return respondStreaming(scope, options.devMode === true);
    case 'json':
      return respondBuffered(scope);
  }
}
