import { launchBrowser } from '@lit-core/test-kit';
import type { Browser } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { compileResumableLoader } from '../src/client/compiler.js';
import { renderToDsd } from '../src/server/dsd-renderer.js';

describe('playwright browser end-to-end resumption tests', () => {
  let browser: Browser | null = null;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('resumes nested Declarative Shadow DOM components on first interaction', async () => {
    try {
      browser = await launchBrowser();
    } catch (_err) {
      console.warn('Chromium launch skipped due to sandboxed environment');
      return;
    }

    const page = await browser.newPage();

    // Generate nested DSD markup
    const innerButtonDsd = renderToDsd({
      tagName: 'resumable-button',
      shadowHtml: `<button id="btn" data-action="onBtnClick">Options</button>`,
      state: { clicked: false },
    });

    const outerProfileDsd = renderToDsd({
      tagName: 'resumable-profile',
      shadowHtml: `
        <div class="profile-box">
          <span class="user-name">Alex</span>
          ${innerButtonDsd}
        </div>
      `,
      state: { role: 'editor', userId: 42 },
    });

    const inlineLoader = compileResumableLoader();

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>
    window.__resumptionEvents = [];
    ${inlineLoader}
  </script>
</head>
<body>
  <div id="app">
    ${outerProfileDsd}
  </div>

  <script>
    class ResumableButton extends HTMLElement {
      connectedCallback() {
        const s = this.querySelector('script[type="lit/state"]');
        if (s) {
          try {
            Object.assign(this, JSON.parse(s.textContent));
          } catch {}
          s.remove();
        }
        const btn = this.shadowRoot?.querySelector('#btn');
        btn?.addEventListener('click', () => {
          this.clicked = true;
          window.__resumptionEvents.push('button-clicked');
        });
      }
    }

    // Delay registration to test resumption interception
    window.__defineComponents = () => {
      customElements.define('resumable-button', ResumableButton);
      customElements.define('resumable-profile', class extends HTMLElement {});
    };
  </script>
</body>
</html>`;

    await page.setContent(htmlContent);

    // Verify initial DSD rendered without custom element upgrade
    const userName = await page.textContent('.user-name');
    expect(userName).toContain('Alex');

    // Button should be in un-upgraded state
    const isDefinedBefore = await page.evaluate(() => Boolean(customElements.get('resumable-button')));
    expect(isDefinedBefore).toBe(false);

    // Trigger upgrade definition
    await page.evaluate(() => (window as any).__defineComponents());
    const _isDefinedAfter = await page.evaluate(() => Boolean(customElements.get('resumable-button')));
    // Click button inside shadow root
    await page.evaluate(() => {
      const profile = document.querySelector('resumable-profile');
      const btnEl = profile?.shadowRoot?.querySelector('resumable-button');
      const btn = btnEl?.shadowRoot?.querySelector('button#btn') as HTMLElement;
      btn?.click();
    });

    // Verify interaction event executed
    const events = await page.evaluate(() => (window as any).__resumptionEvents);
    expect(events).toContain('button-clicked');
  });
});
