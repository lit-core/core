import type { Browser, Page } from 'playwright';
import {
  closeSharedBrowser,
  createTestPage,
  getShadowComputedStyle,
  getShadowText,
  getSharedBrowser,
  type SetupPageOptions,
} from '@lit-core/test-kit';

export {
  closeSharedBrowser as closeTestBrowser,
  getShadowText,
  getShadowComputedStyle,
  type SetupPageOptions,
};

/**
 * Get or launch shared real headless Chromium instance via Playwright.
 * Uses sandbox-safe --single-process flags to run hermetically without permission prompts.
 */
export async function getTestBrowser(): Promise<Browser> {
  return getSharedBrowser();
}

/**
 * Set up a page with custom HTML, CSS, and scripts in real Chromium DOM.
 * Executes self-contained bundles and scripts without relying on browser-level
 * bare specifier resolution or external CDN import maps.
 */
export async function setupTestPage(options: SetupPageOptions = {}): Promise<Page> {
  const browser = await getTestBrowser();
  const managed = await createTestPage(browser, options);
  return managed.page;
}
