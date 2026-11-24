/**
 * A request failure with a stable machine-readable code and the HTTP status it maps to.
 * Thrown by endpoint validation steps and converted to a JSON response in one place.
 */
export class EndpointError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Per-field messages, when the failure can be tied to named input fields. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'EndpointError';
  }

  toResponse(headersInit?: HeadersInit): Response {
    return jsonErrorResponse(this.status, { error: this.message, code: this.code, ...(this.fields ? { fields: this.fields } : {}) }, headersInit);
  }
}

export function jsonErrorResponse(status: number, body: { error: string; code: string; fields?: Record<string, string> }, headersInit?: HeadersInit): Response {
  const headers = new Headers(headersInit);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * The failure for a request body over the limit.
 *
 * A JSON action request carries the element's whole state, so it grows with the data the element holds,
 * and the cause is rarely the arguments. The message says so, because "body too large" alone sends people
 * looking in the wrong place.
 */
export function payloadTooLarge(limit: number, carriesState: boolean): EndpointError {
  const hint = carriesState
    ? " The element's state is sent with every action, so a large list makes every request large: raise `maxBodyBytes` on the action endpoint, or keep large data out of reactive properties."
    : '';
  return new EndpointError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds the ${limit} byte limit.${hint}`);
}
