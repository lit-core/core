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
