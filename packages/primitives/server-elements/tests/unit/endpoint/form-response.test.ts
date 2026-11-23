import { describe, expect, it } from 'vitest';
import { errorPageResponse, redirectResponse, resolveRedirectTarget } from '../../../src/endpoint/form-response.js';

const url = new URL('https://shop.example/cart/add');

describe('resolveRedirectTarget', () => {
  it('prefers the requested path, then the referer, then the root', () => {
    expect(resolveRedirectTarget('/done', 'https://shop.example/from', url)).toBe('/done');
    expect(resolveRedirectTarget(null, 'https://shop.example/from?x=1', url)).toBe('/from?x=1');
    expect(resolveRedirectTarget(null, null, url)).toBe('/');
  });

  it('drops the fragment and keeps the query', () => {
    expect(resolveRedirectTarget('/a/b?c=1#frag', null, url)).toBe('/a/b?c=1');
  });

  it('skips foreign and non-http targets', () => {
    expect(resolveRedirectTarget('https://evil.example/x', null, url)).toBe('/');
    expect(resolveRedirectTarget('//evil.example/x', null, url)).toBe('/');
    expect(resolveRedirectTarget('javascript:alert(1)', null, url)).toBe('/');
    expect(resolveRedirectTarget('https://evil.example/x', 'https://shop.example/back', url)).toBe('/back');
  });

  it('never returns a protocol-relative location, however the path is spelled', () => {
    // Dot segments collapse after the origin check, which would leave `//evil.example` as the path.
    for (const sneaky of ['/..//evil.example', '/.//evil.example', '/a/..//evil.example/p?q=1', '/\\evil.example', '/\t/evil.example']) {
      const target = resolveRedirectTarget(sneaky, null, url);
      expect(target.startsWith('//'), `${JSON.stringify(sneaky)} gave ${target}`).toBe(false);
      expect(new URL(target, url).origin).toBe(url.origin);
    }
  });
});

describe('redirectResponse', () => {
  it('answers 303 so a reload never resubmits, and is never cached', () => {
    const response = redirectResponse('/done', new Headers({ 'Set-Cookie': 'a=1' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/done');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toBe('a=1');
  });
});

describe('errorPageResponse', () => {
  it('escapes the message and field names, since they can echo user input', async () => {
    const response = errorPageResponse(422, '<script>alert(1)</script>', new Headers(), { '<b>name</b>': '"bad" & worse' });
    const body = await response.text();
    expect(response.status).toBe(422);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(body).not.toContain('<script>');
    expect(body).not.toContain('<b>name</b>');
    expect(body).toContain('&lt;script&gt;');
  });
});
