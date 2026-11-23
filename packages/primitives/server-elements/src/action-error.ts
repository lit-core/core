// Server-side only: kept apart from errors.ts, which the browser runtime imports, so none of this reaches client bundles.
/** HTTP status for each error code an action may raise deliberately. */
export const ACTION_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PRECONDITION_FAILED: 412,
  UNPROCESSABLE_CONTENT: 422,
  TOO_MANY_REQUESTS: 429,
} as const;

export type ActionErrorCode = keyof typeof ACTION_ERROR_STATUS;

/** Shared across module copies, so an error thrown by a bundled component is recognized by the endpoint. */
const ACTION_ERROR_BRAND = Symbol.for('@lit-core/server-elements/action-error');

export interface ActionErrorOptions {
  /** Per-field messages, for example `{ email: 'Already registered' }`. */
  fields?: Record<string, string>;
}

/**
 * An error an action or loader raises on purpose, whose code and message are safe to show the user.
 *
 * Any other thrown error is treated as a bug: its details are redacted from the response unless
 * `devMode` is on. Throw `ActionError` for expected failures such as permission or conflict checks.
 *
 * ```ts
 * @action()
 * async remove(id: string) {
 *   if (!this.canEdit) throw new ActionError('FORBIDDEN', 'You cannot edit this list.');
 * }
 *
 * @action()
 * async register(fields: { email: string }) {
 *   if (await this.taken(fields.email)) {
 *     throw new ActionError('UNPROCESSABLE_CONTENT', 'Fix the highlighted fields.', { fields: { email: 'Already registered' } });
 *   }
 * }
 * ```
 */
export class ActionError extends Error {
  readonly code: ActionErrorCode;
  readonly status: number;
  /** Per-field messages a form can show next to its inputs, keyed by input name. */
  readonly fields?: Readonly<Record<string, string>>;
  readonly [ACTION_ERROR_BRAND] = true;

  constructor(code: ActionErrorCode, message: string = code, options: ActionErrorOptions = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.status = ACTION_ERROR_STATUS[code];
    if (options.fields) this.fields = Object.freeze({ ...options.fields });
  }
}

/** True for an `ActionError`, even one created by a different copy of this module. */
export function isActionError(value: unknown): value is ActionError {
  return value instanceof Error && (value as unknown as Record<symbol, unknown>)[ACTION_ERROR_BRAND] === true;
}
