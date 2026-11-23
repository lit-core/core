import type { ActionRequestBody, WireState } from './types.js';

/**
 * Turns element state into the form that crosses the wire, and back.
 *
 * By default state travels as readable JSON, protected by an HMAC signature that proves it was not
 * altered. With encryption on, it travels as an opaque AES-GCM ciphertext, so data loaded into state
 * (a database row, a user's email) is no longer readable by whoever can read the page. The signature
 * still covers the plaintext, binding it to the element, build, sequence and token.
 */
export interface StateSealer {
  readonly encrypted: boolean;
  /** Plaintext state to wire form. */
  seal(tag: string, state: Record<string, unknown>): Promise<WireState>;
  /** Wire form back to plaintext state. Rejects with `StateOpenError` when it cannot be trusted. */
  open(tag: string, wire: WireState): Promise<Record<string, unknown>>;
}

export class StateOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateOpenError';
  }
}

const plainSealer: StateSealer = {
  encrypted: false,
  async seal(_tag, state) {
    return state;
  },
  async open(_tag, wire) {
    if (typeof wire === 'string') {
      throw new StateOpenError('Encrypted state was sent to an endpoint that does not expect it.');
    }
    return wire;
  },
};

const ENCRYPTION_INFO = new TextEncoder().encode('@lit-core/server-elements state encryption v1');
const IV_BYTES = 12;
const keyCache = new Map<string, Promise<CryptoKey>>();

/** Derives the AES key from the signing secret, so one secret configures both integrity and confidentiality. */
function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey'])
      .then((material) =>
        crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: ENCRYPTION_INFO }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
      );
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function createEncryptingSealer(secret: string): StateSealer {
  return {
    encrypted: true,
    async seal(tag, state) {
      const key = await deriveEncryptionKey(secret);
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const additionalData = new TextEncoder().encode(tag.toLowerCase());
      const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, new TextEncoder().encode(JSON.stringify(state))));
      const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
      out.set(iv);
      out.set(ciphertext, IV_BYTES);
      return toBase64Url(out);
    },
    async open(tag, wire) {
      if (typeof wire !== 'string') {
        throw new StateOpenError('State must be encrypted for this endpoint.');
      }
      try {
        const bytes = fromBase64Url(wire);
        const key = await deriveEncryptionKey(secret);
        const additionalData = new TextEncoder().encode(tag.toLowerCase());
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData }, key, bytes.slice(IV_BYTES));
        return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
      } catch {
        throw new StateOpenError('State could not be decrypted.');
      }
    },
  };
}

/**
 * Chooses how state is sealed. Encryption derives its key from the signing secret, so the secret must
 * be a string: a non-extractable `CryptoKey` cannot be used for key derivation.
 */
export function createStateSealer(secret: string | CryptoKey, encrypt: boolean): StateSealer {
  if (!encrypt) return plainSealer;
  if (typeof secret !== 'string') {
    throw new Error('[@lit-core/server-elements] encryptState requires the signing secret to be a string, not a CryptoKey.');
  }
  return createEncryptingSealer(secret);
}

/** A request whose state has been opened to plaintext, as the rest of the endpoint sees it. */
export type OpenedActionRequest = Omit<ActionRequestBody, 'state'> & { state: Record<string, unknown> };
