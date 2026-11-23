import { escapeHtml } from '@lit-core/ssr';

/**
 * Picks where to send the browser after a form action, never leaving the site.
 *
 * The page's own `_lit_redirect` field wins, then the `Referer`, then the site root. A target is only
 * used when it resolves to the request's own origin, which rules out open redirects.
 */
export function resolveRedirectTarget(requested: string | null, referer: string | null, requestUrl: URL): string {
  for (const candidate of [requested, referer]) {
    if (!candidate) continue;
    try {
      const target = new URL(candidate, requestUrl);
      if (target.origin === requestUrl.origin) {
        // Dot segments collapse after the origin check, so `/..//host` leaves the path `//host`, which a
        // browser reads as a protocol-relative URL. A location must start with exactly one slash.
        return `/${target.pathname.replace(/^\/+/, '')}${target.search}`;
      }
    } catch {
      // An unparsable candidate is skipped, not trusted.
    }
  }
  return '/';
}

/** Post/Redirect/Get: 303 sends the browser back with a GET, so a reload never resubmits the form. */
export function redirectResponse(location: string, headers: Headers): Response {
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 303, headers });
}

/** A minimal page for a form action that failed, since there is no client script to show an error frame. */
export function errorPageResponse(status: number, message: string, headers: Headers, fields?: Readonly<Record<string, string>>): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  const items = Object.entries(fields ?? {})
    .map(([name, problem]) => `<li><strong>${escapeHtml(name)}</strong>: ${escapeHtml(problem)}</li>`)
    .join('');
  const body = `<!doctype html><meta charset="utf-8"><title>${status}</title><h1>${status}</h1><p>${escapeHtml(message)}</p>${items ? `<ul>${items}</ul>` : ''}<p><a href="javascript:history.back()">Go back</a></p>`;
  return new Response(body, { status, headers });
}
