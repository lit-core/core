import { type Browser, chromium, type LaunchOptions } from 'playwright';

/**
 * Standard sandbox-safe Chromium launch arguments.
 * Uses --single-process to eliminate macOS sandbox Mach port rendezvous restrictions.
 */
export const SANDBOX_SAFE_CHROMIUM_ARGS: string[] = [
  '--single-process',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--enable-precise-memory-info',
  '--js-flags=--expose-gc',
];

export interface SafeBrowserOptions extends Partial<LaunchOptions> {
  extraArgs?: string[];
}

let sharedBrowserInstance: Browser | null = null;

/**
 * Launch a Chromium browser instance safely inside standard sandbox mode.
 * Throws a descriptive error on failure rather than returning null or dummy values.
 */
export async function launchBrowser(options: SafeBrowserOptions = {}): Promise<Browser> {
  const { extraArgs = [], args = [], ...rest } = options;
  const combinedArgs = Array.from(new Set([...SANDBOX_SAFE_CHROMIUM_ARGS, ...extraArgs, ...args]));

  try {
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: false,
      args: combinedArgs,
      ...rest,
    });
    return browser;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to launch sandbox-safe Chromium browser. ` + `Verify Playwright Chromium is installed and flags include --single-process.\n` + `Original error: ${message}`, {
      cause: err,
    });
  }
}

/**
 * Get or initialize the shared singleton Chromium browser instance.
 */
export async function getSharedBrowser(options: SafeBrowserOptions = {}): Promise<Browser> {
  if (!sharedBrowserInstance?.isConnected()) {
    sharedBrowserInstance = await launchBrowser(options);
  }
  return sharedBrowserInstance;
}

/**
 * Close the shared singleton browser instance if running.
 */
export async function closeSharedBrowser(): Promise<void> {
  if (sharedBrowserInstance) {
    try {
      await sharedBrowserInstance.close();
    } catch {
      // Ignore teardown errors on already closed browser
    }
    sharedBrowserInstance = null;
  }
}
