import { describe, expect, it } from 'vitest';
import { MIN_SECRET_LENGTH, resolveMandatorySecret } from '../../src/secret.js';

describe('resolveMandatorySecret', () => {
  const strong = 'a-secret-that-is-comfortably-long-enough!';

  it('accepts a secret of the minimum length or more, from the options or from the environment', () => {
    expect(resolveMandatorySecret({ secret: strong })).toBe(strong);
    expect(resolveMandatorySecret({ env: { LIT_ACTION_SECRET: strong } })).toBe(strong);
    expect(resolveMandatorySecret({ secret: 'x'.repeat(MIN_SECRET_LENGTH) })).toHaveLength(MIN_SECRET_LENGTH);
  });

  it('refuses a short secret, since the signature and the data it covers are both in the page and a short key can be guessed offline', () => {
    for (const weak of ['x', 'test-secret', 'x'.repeat(MIN_SECRET_LENGTH - 1)]) {
      expect(() => resolveMandatorySecret({ secret: weak })).toThrow(/at least 32 characters/);
      expect(() => resolveMandatorySecret({ env: { LIT_ACTION_SECRET: weak } })).toThrow(/at least 32 characters/);
    }
  });

  it('never repeats the secret it refused in the error', () => {
    try {
      resolveMandatorySecret({ secret: 'hunter2' });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('hunter2');
      return;
    }
    throw new Error('expected a refusal');
  });

  it('leaves a CryptoKey alone, since its strength is not a matter of length', async () => {
    const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    expect(resolveMandatorySecret({ secret: key })).toBe(key);
  });

  it('still fails closed with no secret, and only uses the development secret when asked', () => {
    expect(() => resolveMandatorySecret({})).toThrow(/Missing mandatory secret/);
    expect(typeof resolveMandatorySecret({ devMode: true })).toBe('string');
  });
});
