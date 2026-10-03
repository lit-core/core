import type { Page } from 'playwright';

export interface MountResult {
  tag: string;
  success: boolean;
  hasShadowRoot: boolean;
  childElementCount: number;
  renderedText: string;
  error?: string;
  updateCompleteMs?: number;
}

/**
 * Mount a custom element in isolation inside the page and verify its lifecycle.
 */
export async function mountElement(page: Page, tag: string, props: Record<string, any> = {}): Promise<MountResult> {
  return page.evaluate(
    async ({ tag, props }) => {
      const container = document.getElementById('test-root') || document.body;
      const el = document.createElement(tag) as any;

      for (const [k, v] of Object.entries(props)) {
        try {
          el[k] = v;
        } catch {}
      }

      const t0 = performance.now();
      container.appendChild(el);

      try {
        if (el.updateComplete && typeof el.updateComplete.then === 'function') {
          await el.updateComplete;
        }
      } catch (err: any) {
        const errorMsg = err?.stack || err?.message || String(err);
        container.removeChild(el);
        return {
          tag,
          success: false,
          hasShadowRoot: Boolean(el.shadowRoot),
          childElementCount: el.shadowRoot ? el.shadowRoot.childElementCount : el.childElementCount,
          renderedText: (el.shadowRoot?.textContent || el.textContent || '').trim().slice(0, 100),
          error: errorMsg,
          updateCompleteMs: performance.now() - t0,
        };
      }

      const shadow = el.shadowRoot;
      const result: MountResult = {
        tag,
        success: true,
        hasShadowRoot: Boolean(shadow),
        childElementCount: shadow ? shadow.childElementCount : el.childElementCount,
        renderedText: (shadow?.textContent || el.textContent || '').trim().slice(0, 100),
        updateCompleteMs: performance.now() - t0,
      };

      try {
        container.removeChild(el);
      } catch {}

      return result;
    },
    { tag, props },
  );
}
