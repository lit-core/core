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

/**
 * Sequence number a no-JavaScript form ticket is signed with.
 *
 * A form carries a ticket, which vouches for the element's identity (tag, public attributes, token and
 * build) but holds no state, so every form on a page stays a few hundred bytes however large the state
 * is. The reserved negative number keeps tickets and state snapshots apart: a snapshot's sequence is
 * never negative, so a ticket cannot be presented as a snapshot with an empty state to skip the checks
 * an action makes against its state, and a snapshot cannot be presented as a ticket.
 */
export const FORM_TICKET_SEQ = -1;

/**
 * Error codes that mean the page the action came from is out of date, not that the request was wrong.
 * Retrying the same request cannot work; reloading the page gets a fresh snapshot.
 *
 * `ACTION_STALE`: the server was deployed since the page was rendered. `STATE_REPLAYED`: this snapshot
 * was already used. `STATE_EXPIRED`: the page outlived its signed state.
 */
export const RELOAD_REQUIRED_CODES: readonly string[] = ['ACTION_STALE', 'STATE_REPLAYED', 'STATE_EXPIRED'];
