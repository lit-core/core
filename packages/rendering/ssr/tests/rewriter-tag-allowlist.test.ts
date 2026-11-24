import { describe, expect, it } from 'vitest';
import { attachSsrToHtmlRewriter } from '../src/html-rewriter.js';

/** A rewriter that only records which selectors were asked for. */
function recordingRewriter() {
  const selectors: string[] = [];
  const rewriter = {
    on(selector: string) {
      selectors.push(selector);
      return rewriter;
    },
    onDocument() {
      return rewriter;
    },
    transform: (response: Response) => response,
  };
  return { rewriter, selectors };
}

const registry = {
  get: () => undefined,
  getRegisteredTagNames: () => ['public-card', 'admin-panel', 'billing-summary'],
};

describe('which tags the rewriter expands on the server', () => {
  it('expands only the listed tags when a manifest is given, even if more elements are registered', () => {
    const { rewriter, selectors } = recordingRewriter();
    attachSsrToHtmlRewriter(rewriter as never, { tagManifest: ['public-card'], customElements: registry as never });
    const tags = selectors.filter((selector) => selector !== 'body' && selector !== 'html');
    expect(tags).toEqual(['public-card']);
  });

  it('treats tagNames and islands as part of the same list', () => {
    const { rewriter, selectors } = recordingRewriter();
    attachSsrToHtmlRewriter(rewriter as never, { tagManifest: ['public-card'], tagNames: ['extra-one'], islands: { 'island-one': { render: () => '' } }, customElements: registry as never });
    expect(selectors.filter((selector) => selector !== 'body' && selector !== 'html').sort()).toEqual(['extra-one', 'island-one', 'public-card']);
  });

  it('falls back to every registered element only when no list is given at all', () => {
    const { rewriter, selectors } = recordingRewriter();
    attachSsrToHtmlRewriter(rewriter as never, { customElements: registry as never });
    expect(selectors.filter((selector) => selector !== 'body' && selector !== 'html').sort()).toEqual(['admin-panel', 'billing-summary', 'public-card']);
  });

  it('is case-insensitive about the listed names', () => {
    const { rewriter, selectors } = recordingRewriter();
    attachSsrToHtmlRewriter(rewriter as never, { tagManifest: ['Public-Card'], customElements: registry as never });
    expect(selectors.filter((selector) => selector !== 'body' && selector !== 'html')).toEqual(['public-card']);
  });

  it('refuses to start with nothing to expand', () => {
    const { rewriter } = recordingRewriter();
    expect(() => attachSsrToHtmlRewriter(rewriter as never, {})).toThrow(/No tag manifest/);
  });
});
