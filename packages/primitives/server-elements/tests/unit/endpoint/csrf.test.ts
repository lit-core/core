import { describe, expect, it } from 'vitest';
import { type CsrfInput, evaluateCsrf } from '../../../src/endpoint/csrf.js';

const base: CsrfInput = { origin: null, secFetchSite: null, hasCredentials: false, serverOrigin: 'https://app.example' };
const allowed = (input: Partial<CsrfInput>) => evaluateCsrf({ ...base, ...input }).allowed;

describe('evaluateCsrf', () => {
  describe('with credentials', () => {
    const withCookies = { hasCredentials: true };

    it('allows a matching Origin', () => {
      expect(allowed({ ...withCookies, origin: 'https://app.example' })).toBe(true);
    });

    it('allows same-origin Sec-Fetch-Site when Origin is absent', () => {
      expect(allowed({ ...withCookies, secFetchSite: 'same-origin' })).toBe(true);
    });

    it('blocks when neither Origin nor Sec-Fetch-Site proves same-origin', () => {
      expect(allowed(withCookies)).toBe(false);
    });

    it('blocks a foreign Origin even if Sec-Fetch-Site claims same-origin', () => {
      expect(allowed({ ...withCookies, origin: 'https://evil.example', secFetchSite: 'same-origin' })).toBe(false);
    });

    it('allows an allowlisted foreign Origin', () => {
      expect(allowed({ ...withCookies, origin: 'https://partner.example', allowedOrigins: ['https://partner.example'] })).toBe(true);
    });
  });

  describe('without credentials', () => {
    it('allows requests that declare nothing', () => {
      expect(allowed({})).toBe(true);
    });

    it('blocks a foreign Origin', () => {
      expect(allowed({ origin: 'https://evil.example' })).toBe(false);
    });

    it('blocks cross-site fetches', () => {
      expect(allowed({ secFetchSite: 'cross-site' })).toBe(false);
    });

    it('allows an allowlisted foreign Origin', () => {
      expect(allowed({ origin: 'https://partner.example', allowedOrigins: ['https://partner.example'] })).toBe(true);
    });

    it('blocks cross-site fetches even from a matching Origin', () => {
      expect(allowed({ origin: 'https://app.example', secFetchSite: 'cross-site' })).toBe(false);
    });
  });
});
