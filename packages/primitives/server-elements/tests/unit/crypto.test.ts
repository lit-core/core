import { describe, expect, it } from 'vitest';
import { canonicalizeJson, createSignedStateSnapshot, generateActionToken, hasPrototypePollution, verifyStateSignature, verifyStateSnapshot } from '../../src/crypto.js';

describe('cryptographic state utilities', () => {
  const secret = 'super-secret-test-key-32-chars-long';

  it('generates a 16-hex action token', () => {
    const token = generateActionToken();
    expect(token).toMatch(/^[0-9a-f]{16}$/);

    const token2 = generateActionToken();
    expect(token2).toMatch(/^[0-9a-f]{16}$/);
    expect(token).not.toBe(token2);
  });

  it('canonicalizes JSON with lexicographical key order and strips prototype keys', () => {
    const obj1 = { b: 2, a: 1, c: { y: 'bar', x: 'foo' } };
    const obj2 = { c: { x: 'foo', y: 'bar' }, a: 1, b: 2 };
    expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
    expect(canonicalizeJson(obj1)).toBe('{"a":1,"b":2,"c":{"x":"foo","y":"bar"}}');
  });

  it('detects prototype pollution keys in nested structures', () => {
    expect(hasPrototypePollution({ normal: true })).toBe(false);
    expect(hasPrototypePollution({ [String('__proto__')]: {} })).toBe(true);
    expect(hasPrototypePollution({ a: [{ constructor: {} }] })).toBe(true);
    expect(hasPrototypePollution({ prototype: {} })).toBe(true);
  });

  it('signs and verifies state snapshot successfully', async () => {
    const state = { count: 42, role: 'member' };
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret);

    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(sig).toContain('.');
    const [expStr, sigHex] = sig.split('.');
    expect(Number(expStr)).toBeGreaterThan(Date.now());
    expect(sigHex).toMatch(/^[0-9a-f]{64}$/);

    const isValid = await verifyStateSignature('counter-element', state, sig, secret, { token });
    expect(isValid).toBe(true);
  });

  it('produces identical signatures regardless of key insertion order', async () => {
    const stateA = { z: 10, a: 20 };
    const stateB = { a: 20, z: 10 };
    const ttl = 60000;

    const resA = await createSignedStateSnapshot('test-el', stateA, secret, ttl);

    // Verify stateB verifies against stateA signature
    const isValid = await verifyStateSignature('test-el', stateB, resA.sig, secret, { token: resA.token });
    expect(isValid).toBe(true);
  });

  it('rejects tampered state properties', async () => {
    const state = { count: 1 };
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret);

    const tampered = { count: 999 };
    const isValid = await verifyStateSignature('counter-element', tampered, sig, secret, { token });
    expect(isValid).toBe(false);
  });

  it('rejects state verified against wrong tag name', async () => {
    const state = { count: 1 };
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret);

    const isValid = await verifyStateSignature('other-element', state, sig, secret, { token });
    expect(isValid).toBe(false);
  });

  it('rejects tampered signature hex characters', async () => {
    const state = { count: 1 };
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret);

    const [exp, hex] = sig.split('.');
    const tamperedHex = (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1);
    const tamperedSig = `${exp}.${tamperedHex}`;

    const isValid = await verifyStateSignature('counter-element', state, tamperedSig, secret, { token });
    expect(isValid).toBe(false);
  });

  it('rejects expired state snapshots', async () => {
    const state = { count: 1 };
    // TTL of -100ms
    const { sig, token } = await createSignedStateSnapshot('counter-element', state, secret, -100);

    const isValid = await verifyStateSignature('counter-element', state, sig, secret, { token });
    expect(isValid).toBe(false);
  });

  it('rejects malformed signature strings without dot or invalid hex', async () => {
    const state = { count: 1 };
    expect(await verifyStateSignature('counter-element', state, 'invalid-signature', secret, { token: 'any-token' })).toBe(false);
    expect(await verifyStateSignature('counter-element', state, '12345.short', secret, { token: 'any-token' })).toBe(false);
    expect(await verifyStateSignature('counter-element', state, '', secret, { token: 'any-token' })).toBe(false);
  });

  it('verifyStateSnapshot handles JSON string and validates prototype pollution', async () => {
    const state = { score: 100 };
    const { sig, token } = await createSignedStateSnapshot('game-element', state, secret);

    const resObj = await verifyStateSnapshot('game-element', state, sig, secret, { token });
    expect(resObj.valid).toBe(true);
    expect(resObj.state).toEqual(state);

    const resJson = await verifyStateSnapshot('game-element', JSON.stringify(state), sig, secret, { token });
    expect(resJson.valid).toBe(true);
    expect(resJson.state).toEqual(state);

    const pollutedJson = '{"score": 100, "__proto__": {"admin": true}}';
    const resPolluted = await verifyStateSnapshot('game-element', pollutedJson, sig, secret, { token });
    expect(resPolluted.valid).toBe(false);
    expect(resPolluted.error).toBe('PROTOTYPE_POLLUTION_DETECTED');

    const malformed = '{"score": 100';
    const resMalformed = await verifyStateSnapshot('game-element', malformed, sig, secret, { token });
    expect(resMalformed.valid).toBe(false);
    expect(resMalformed.error).toBe('MALFORMED_JSON');
  });

  it('rejects state snapshot creation when state has prototype pollution', async () => {
    const polluted: any = Object.create(null);
    Object.defineProperty(polluted, '__proto__', {
      value: { leaked: true },
      enumerable: true,
      configurable: true,
    });

    await expect(createSignedStateSnapshot('el', polluted, secret)).rejects.toThrow('Prototype pollution detected');
  });
});
