/**
 * Constants of the action wire protocol, shared by the server endpoint, the server renderer and the
 * browser runtime. Dependency free, so importing it never pulls either runtime into the other side.
 */

/** URL prefix action requests are posted under. */
export const DEFAULT_ROUTE_PREFIX = '/_lit/a/';

/** Shape of the compiler-generated action identifier at the end of an action URL. */
export const ACTION_HASH_PATTERN = /^[0-9a-zA-Z_-]{16}$/;

/** Attribute listing the actions a client element is waiting on, space separated. It is removed when none are pending. */
export const PENDING_ATTRIBUTE = 'data-lit-pending';

/** DOM events a client element fires when one of its actions settles. Both bubble and cross shadow boundaries. */
export const ACTION_SUCCESS_EVENT = 'lit-action-success';
export const ACTION_ERROR_EVENT = 'lit-action-error';

/** Prefix of the hidden form fields that carry the signed snapshot in a no-JavaScript form post. */
export const FORM_FIELD_PREFIX = '_lit_';
