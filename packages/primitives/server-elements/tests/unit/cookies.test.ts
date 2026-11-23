import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from '../../src/cookies.js';

describe('parseCookies', () => {
  it('returns an empty map for a missing or empty header', () => {
    expect(parseCookies(null).size).toBe(0);
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies('').size).toBe(0);
  });

  it('keeps cookies in header order and decodes values', () => {
    const cookies = parseCookies('a=1; b=hello%20world; c=3');
    expect([...cookies]).toEqual([
      ['a', '1'],
      ['b', 'hello world'],
      ['c', '3'],
    ]);
  });

  it('keeps the first value when a name repeats', () => {
    expect(parseCookies('a=1; a=2').get('a')).toBe('1');
  });

  it('ignores a malformed pair instead of throwing', () => {
    expect(parseCookies('novalue; ok=1').get('ok')).toBe('1');
  });
});

describe('serializeCookie', () => {
  it('serializes attributes in the Set-Cookie form', () => {
    const header = serializeCookie('sid', 'abc 123', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 60 });
    expect(header).toContain('sid=abc%20123');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=60');
  });

  it('writes SameSite capitalized, and tolerates a capitalized option from untyped callers', () => {
    expect(serializeCookie('a', '1', { sameSite: 'lax' })).toContain('SameSite=Lax');
    expect(serializeCookie('a', '1', { sameSite: 'none', secure: true })).toContain('SameSite=None');
    expect(serializeCookie('a', '1', { sameSite: 'Strict' as 'strict' })).toContain('SameSite=Strict');
  });

  it('serializes a bare cookie without options', () => {
    expect(serializeCookie('a', '1')).toBe('a=1');
  });

  it('rejects a cookie name that could inject another header field', () => {
    expect(() => serializeCookie('a\r\nSet-Cookie: x', '1')).toThrow();
  });
});
