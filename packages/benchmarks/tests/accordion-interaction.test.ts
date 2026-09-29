import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('accordion interaction test across carbon benchmark artifacts', () => {
  let browser: Browser | null = null;
  const artifactsDir = path.resolve(__dirname, '../artifacts/carbon');

  beforeAll(async () => {
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (err) {
      console.warn('Chromium launch skipped due to environment:', err);
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  const filesToTest = ['baseline.html', 'combined.html', 'resumable.html', 'resumable-ssr.html', 'css-fuse.html', 'html-aot.html', 'props-lower.html'];

  for (const filename of filesToTest) {
    it(`evaluates accordion click interaction on ${filename}`, async () => {
      if (!browser) {
        console.warn(`Skipping ${filename} because browser is not available`);
        return;
      }

      const filePath = path.join(artifactsDir, filename);
      const page = await browser.newPage();

      const consoleLogs: string[] = [];
      const errors: string[] = [];
      page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
      page.on('pageerror', (err) => errors.push(`${err.message}\n${err.stack || ''}`));

      await page.goto(`file://${filePath}`, { waitUntil: 'networkidle' }).catch(async () => {
        await page.goto(`file://${filePath}`, { waitUntil: 'domcontentloaded' });
      });

      await page.waitForTimeout(500);

      // Inspect whether cds-accordion or cds-accordion-item exists
      const testResult = await page.evaluate(async () => {
        const mountedTags = Array.from(document.querySelectorAll('.component-slot, .resumable-card')).map((s) => s.getAttribute('data-tag') || '');
        console.log('Mounted tags on page:', mountedTags.length, mountedTags);

        // Find any accordion or accordion-item elements
        const accordionItem = document.querySelector('cds-accordion-item');
        const accordion = document.querySelector('cds-accordion');

        const targetEl = accordionItem || accordion;
        if (!targetEl) {
          return {
            found: false,
            tagName: null,
            initialOpen: null,
            afterClickOpen: null,
            ariaExpandedBefore: null,
            ariaExpandedAfter: null,
            opened: false,
            reason: 'Element <cds-accordion-item> or <cds-accordion> not found in DOM',
          };
        }

        const tagName = targetEl.tagName.toLowerCase();
        const initialOpen = (targetEl as any).open ?? targetEl.hasAttribute('open');

        // Look for the expando button in shadow DOM if attached, or fallback to the element itself
        const shadow = targetEl.shadowRoot;
        const expandoBtn = shadow?.querySelector('button[part="expando"], button.cds--accordion__heading, button') || targetEl;
        const ariaExpandedBefore = expandoBtn.getAttribute('aria-expanded');

        // Dispatch real user click on the interactive target
        expandoBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));

        // Give microtasks and Lit render cycle time to process
        await new Promise((r) => setTimeout(r, 200));

        const afterClickOpen = (targetEl as any).open ?? targetEl.hasAttribute('open');
        const ariaExpandedAfter = expandoBtn.getAttribute('aria-expanded');

        const opened = afterClickOpen === true || ariaExpandedAfter === 'true';

        return {
          found: true,
          tagName,
          initialOpen,
          afterClickOpen,
          ariaExpandedBefore,
          ariaExpandedAfter,
          opened,
          shadowAttached: Boolean(shadow),
          shadowHtml: shadow ? shadow.innerHTML.slice(0, 300) : null,
          customElementDefined: Boolean(customElements.get(tagName)),
          mountedTags,
          registeredTags: (window as any).__registeredTags || [],
        };
      });

      console.log(`\n========================================`);
      console.log(`TEST RESULT: ${filename}`);
      console.log(`========================================`);
      console.log(JSON.stringify(testResult, null, 2));
      if (errors.length) {
        console.log(`Page errors:`, errors);
      }

      await page.close();
    });
  }
});
