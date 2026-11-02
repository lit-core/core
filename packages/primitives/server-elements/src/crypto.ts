/**
 * Cryptographic state signing, verification, and action token utilities
 * for Lit server elements using the Web Crypto API (crypto.subtle).
 *
 * Protocol (single canonical format, no fallbacks):
 *
 *   signature = `${expiresAt}.${hex(HMAC-SHA256(secret, payload))}`
 *   payload   = length-prefixed fields:
 *               version, tag, buildId, snapshotSeq, canonicalState, canonicalPublicAttrs, token, expiresAt
 *
 * Every field is always bound. Verification recomputes the one expected payload from
 * the caller's explicit inputs; there are no candidate loops and no legacy formats.
 *
 * Replay model: the signature is stateless. A snapshot can be replayed at exactly the
 * `snapshotSeq` it was issued with until it expires (`ttlMs`). Presenting an old snapshot
 * under a different `snapshotSeq` always fails. Preventing replay of an old snapshot at its
 * own sequence number requires server-side state (for example a nonce store) and is out of
 * scope for the stateless protocol; bound the exposure with a short `ttlMs`.
 */

const PAYLOAD_VERSION = 'lit-state-v1';
const SIGNATURE_HEX_PATTERN = /^[0-9a-f]{64}$/;

const keyCache = new Map<string, CryptoKey>();

/**
 * Retrieves or imports a CryptoKey for HMAC-SHA256 operations.
 */
export async function getHmacKey(secret: string | CryptoKey): Promise<CryptoKey> {
  if (typeof secret !== 'string') {
    return secret;
  }
  let key = keyCache.get(secret);
  if (!key) {
    const encoder = new TextEncoder();
    key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

/**
 * Checks recursively whether an object contains prototype-pollution keys
 * (__proto__, constructor, prototype).
 */
export function hasPrototypePollution(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasPrototypePollution);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return true;
    }
    if (hasPrototypePollution((value as Record<string, unknown>)[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Serializes an object to deterministic canonical JSON with sorted keys
 * and prototype pollution properties stripped.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const k of sortedKeys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      continue;
    }
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') {
      parts.push(`${JSON.stringify(k)}:${canonicalizeJson(v)}`);
    }
  }
  return `{${parts.join(',')}}`;
}

/**
 * Generates a 16-hex character cryptographically secure random token.
 */
export function generateActionToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SignedStateSnapshotOptions {
  /** Server build identifier bound into the signature (empty string when unversioned). */
  buildId?: string;
  /** Snapshot sequence number bound into the signature (0 for the initial render). */
  seq?: number;
  /** Public host attributes bound into the signature. `data-lit-*` and `__lit*` keys are ignored. */
  publicAttrs?: Record<string, string>;
  /** Per-element action token. Generated when omitted while signing; mandatory while verifying. */
  token?: string;
  ttlMs?: number;
}

export interface VerifyStateOptions {
  /** Server build identifier that the snapshot must have been issued under. */
  buildId?: string;
  /** Snapshot sequence number that the snapshot must have been issued with. */
  seq?: number;
  /** Public host attributes that the snapshot must have been issued with. */
  publicAttrs?: Record<string, string>;
  /** Per-element action token. Mandatory. */
  token: string;
}

export interface SignedStateResult {
  state: Record<string, unknown>;
  sig: string;
  token: string;
}

function canonicalPublicAttrs(rawAttrs: Record<string, string> | undefined): string {
  if (!rawAttrs || typeof rawAttrs !== 'object') {
    return '{}';
  }
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (!k.startsWith('data-lit-') && !k.startsWith('__lit')) {
      attrs[k] = String(v);
    }
  }
  return canonicalizeJson(attrs);
}

function encodeLengthPrefixed(fields: readonly string[]): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = fields.map((f) => encoder.encode(f));
  let total = 0;
  for (const bytes of encoded) {
    total += 4 + bytes.byteLength;
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const bytes of encoded) {
    view.setUint32(offset, bytes.byteLength, false);
    offset += 4;
    out.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return out;
}

/**
 * Builds the canonical length-prefixed binary payload for HMAC-SHA256.
 * Length prefixing makes field boundaries unambiguous, so no value can be shifted across fields.
 */
export function buildHmacPayload(
  tag: string,
  state: Record<string, unknown>,
  expiresAt: number | string,
  options: { buildId?: string; seq?: number; publicAttrs?: Record<string, string>; token: string },
): Uint8Array {
  return encodeLengthPrefixed([
    PAYLOAD_VERSION,
    tag.toLowerCase(),
    options.buildId ?? '',
    String(options.seq ?? 0),
    canonicalizeJson(state),
    canonicalPublicAttrs(options.publicAttrs),
    options.token,
    String(expiresAt),
  ]);
}

/**
 * Escapes sensitive HTML and Unicode control characters from JSON strings
 * before embedding in HTML attributes or scripts.
 */
export function escapeJsonForHtml(jsonStr: string): string {
  return jsonStr
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Signs a component state dictionary using HMAC-SHA256 with timestamp expiry.
 * Signature format: `${expiresAt}.${sigHex}`.
 */
export async function createSignedStateSnapshot(
  tag: string,
  state: Record<string, unknown>,
  secret: string | CryptoKey,
  ttlMsOrOptions?: number | SignedStateSnapshotOptions,
  maybeOptions?: SignedStateSnapshotOptions,
): Promise<SignedStateResult> {
  if (hasPrototypePollution(state)) {
    throw new Error('Prototype pollution detected in state payload');
  }

  const options: SignedStateSnapshotOptions = typeof ttlMsOrOptions === 'object' && ttlMsOrOptions !== null ? ttlMsOrOptions : maybeOptions || {};
  const ttlMs = typeof ttlMsOrOptions === 'number' ? ttlMsOrOptions : (options.ttlMs ?? 900_000);

  const token = options.token || generateActionToken();
  const expiresAt = Date.now() + ttlMs;
  const data = buildHmacPayload(tag, state, expiresAt, { buildId: options.buildId, seq: options.seq, publicAttrs: options.publicAttrs, token });

  const key = await getHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  return { state, sig: `${expiresAt}.${toHex(sigBuffer)}`, token };
}

/**
 * Alias for createSignedStateSnapshot adhering to alternate naming convention.
 */
export const signStateSnapshot = createSignedStateSnapshot;

/**
 * Verifies an HMAC-SHA256 state signature and timestamp expiry against exactly the
 * inputs supplied. The token is mandatory; every other bound field is compared exactly.
 */
export async function verifyStateSignature(tag: string, state: Record<string, unknown>, sig: string, secret: string | CryptoKey, options: VerifyStateOptions): Promise<boolean> {
  if (typeof sig !== 'string' || hasPrototypePollution(state)) {
    return false;
  }
  if (typeof options?.token !== 'string' || options.token.length === 0) {
    return false;
  }
  const parts = sig.split('.');
  if (parts.length !== 2) {
    return false;
  }
  const [expStr, sigHex] = parts;
  const expiresAt = Number(expStr);
  if (!/^\d+$/.test(expStr) || !Number.isSafeInteger(expiresAt) || Date.now() > expiresAt) {
    return false;
  }
  if (!SIGNATURE_HEX_PATTERN.test(sigHex)) {
    return false;
  }

  const key = await getHmacKey(secret);
  const data = buildHmacPayload(tag, state, expStr, { buildId: options.buildId, seq: options.seq, publicAttrs: options.publicAttrs, token: options.token });
  return crypto.subtle.verify('HMAC', key, fromHex(sigHex) as BufferSource, data as BufferSource);
}

export interface VerifyStateResult {
  valid: boolean;
  state: Record<string, unknown>;
  error?: string;
}

/**
 * Verifies an incoming state snapshot payload (as object or JSON string) with error diagnostics.
 */
export async function verifyStateSnapshot(
  tag: string,
  stateOrJson: Record<string, unknown> | string,
  sig: string,
  secret: string | CryptoKey,
  options: VerifyStateOptions,
): Promise<VerifyStateResult> {
  let state: Record<string, unknown>;
  if (typeof stateOrJson === 'string') {
    try {
      state = JSON.parse(stateOrJson);
    } catch {
      return { valid: false, state: {}, error: 'MALFORMED_JSON' };
    }
  } else {
    state = stateOrJson;
  }

  if (hasPrototypePollution(state)) {
    return { valid: false, state: {}, error: 'PROTOTYPE_POLLUTION_DETECTED' };
  }

  const parts = typeof sig === 'string' ? sig.split('.') : [];
  if (parts.length !== 2) {
    return { valid: false, state: {}, error: 'INVALID_SIGNATURE_FORMAT' };
  }

  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, state: {}, error: 'EXPIRED_SNAPSHOT' };
  }

  if (!(await verifyStateSignature(tag, state, sig, secret, options))) {
    return { valid: false, state: {}, error: 'INVALID_SIGNATURE' };
  }

  return { valid: true, state };
}
