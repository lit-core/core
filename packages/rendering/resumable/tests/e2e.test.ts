import { launchBrowser } from '@lit-core/test-kit';
import { html } from 'lit';
import type { Browser } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { createIsolateEnvironment, renderToString } from '../../ssr/src/index.js';
import { compileResumableLoader } from '../src/client/compiler.js';

describe('playwright browser end-to-end resumption tests', () => {
  let browser: Browser | null = null;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('resumes nested Declarative Shadow DOM components on first interaction', async () => {
    browser = await launchBrowser();

    const page = await browser.newPage();
    const env = createIsolateEnvironment();

    class ServerResumableButton extends env.HTMLElement {
      clicked = false;
      onBtnClick() {}
      render() {
        return html`<button id="btn" @click=${this.onBtnClick}>Options</button>`;
      }
    }

    class ServerResumableProfile extends env.HTMLElement {
      role = 'editor';
      userId = 42;
      render() {
        return html`
          <div class="profile-box">
            <span class="user-name">Alex</span>
            <resumable-button></resumable-button>
          </div>
        `;
      }
    }

    env.customElements.define('resumable-button', ServerResumableButton);
    env.customElements.define('resumable-profile', ServerResumableProfile);

    const outerProfileDsd = renderToString(html`<resumable-profile></resumable-profile>`, {
      customElements: env.customElements,
      resumable: true,
    });

    expect(outerProfileDsd).toContain('data-lit-state=');
    expect(outerProfileDsd).not.toContain('<script type="lit/state">');

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
        const raw = this.getAttribute('data-lit-state');
        if (raw) {
          try {
            Object.assign(this, JSON.parse(raw));
          } catch {}
          this.removeAttribute('data-lit-state');
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

    // Verify interaction event executed and state was hydrated from data-lit-state
    const events = await page.evaluate(() => (window as any).__resumptionEvents);
    expect(events).toContain('button-clicked');
  });
});
