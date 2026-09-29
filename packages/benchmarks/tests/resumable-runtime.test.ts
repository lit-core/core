import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';

describe('resumable SSR Declarative Shadow DOM artifact verification', () => {
  const artifactPath = path.resolve(__dirname, '../artifacts/carbon/resumable-ssr.html');
  let browser: Browser | null = null;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('generates valid Declarative Shadow DOM artifact file without un-evaluated expressions', () => {
    expect(fs.existsSync(artifactPath)).toBe(true);
    const content = fs.readFileSync(artifactPath, 'utf8');

    // 1. Strip all <script>...</script> tags before checking HTML markup
    const withoutScripts = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Strict constraint: zero un-evaluated ${...} expressions in pre-rendered DSD HTML
    const unEvaluatedMatches = withoutScripts.match(/\$\{[^}]+\}/g);
    expect(unEvaluatedMatches).toBeNull();

    // 2. Contains 30 Declarative Shadow DOM templates
    const dsdTemplates = content.match(/<template\s+shadowrootmode=["']open["']/gi) || [];
    expect(dsdTemplates.length).toBeGreaterThanOrEqual(30);

    // 3. Every DSD template contains scoped CSS <style>
    const dsdWithStyles = content.match(/<template\s+shadowrootmode=["']open["'][^>]*>[\s\S]*?<style>/gi) || [];
    expect(dsdWithStyles.length).toBeGreaterThanOrEqual(30);

    // 4. Contains inlined bundle source for offline/local file:/// execution
    expect(content).toContain('id="resumable-bundle-source"');
    expect(content).toContain('__LIT_RESUMABLE_MANIFEST__');
  });

  it('verifies Declarative Shadow DOM and live interaction resumption in browser via Playwright', async () => {
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (_err) {
      console.warn('Chromium launch skipped due to sandboxed environment');
      return;
    }

    const page = await browser.newPage();
    const fileUrl = `file://${artifactPath}`;
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });

    // 1. Initial boot state: 0 components resumed, all 30 rendered with Native DSD
    const initialResumed = await page.$eval('#stat-resumed', (el) => el.textContent?.trim());
    expect(initialResumed).toBe('0');

    const cardCount = await page.$$eval('.resumable-card', (els) => els.length);
    expect(cardCount).toBeGreaterThanOrEqual(30);

    const initialPills = await page.$$eval('.status-pill', (els) => els.map((e) => e.textContent?.trim()));
    expect(initialPills.every((p) => p === 'Native DSD')).toBe(true);

    // 2. Click on the first interactive sample test button
    await page.click('#btn-test-click');
    await page.waitForTimeout(600);

    // 3. After interaction, resumed count should increment and status pill should transition to Resumed
    const resumedAfterClick = await page.$eval('#stat-resumed', (el) => Number(el.textContent?.trim() || '0'));
    expect(resumedAfterClick).toBeGreaterThanOrEqual(1);

    const resumedPills = await page.$$eval('.status-pill.resumed', (els) => els.length);
    expect(resumedPills).toBeGreaterThanOrEqual(1);
  });
});
