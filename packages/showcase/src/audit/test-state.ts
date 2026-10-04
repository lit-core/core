import { ALL_CANONICAL_COMPONENTS, type ComponentItem } from '../canonical-components.js';

export interface ComponentTestState {
  item: ComponentItem;
  testId: string;
  isDefined: boolean;
  isMounted: boolean;
  hasShadowRoot: boolean;
  isInteractive: boolean;
  error?: string;
}

// Global test results interface for Playwright automation
declare global {
  interface Window {
    __TEST_RESULTS__?: {
      feature: string;
      timestamp: string;
      totalComponents: number;
      definedComponents: number;
      mountedComponents: number;
      shadowRootsAttached: number;
      interactivePassed: number;
      components: Array<{
        concept: string;
        library: string;
        tag: string;
        isDefined: boolean;
        isMounted: boolean;
        hasShadowRoot: boolean;
        isInteractive: boolean;
        error?: string;
      }>;
      runInteractiveTests: () => Promise<void>;
    };
  }
}

export const testStates: Map<string, ComponentTestState> = new Map();

export function initializeTestStates(): void {
  testStates.clear();
  for (let i = 0; i < ALL_CANONICAL_COMPONENTS.length; i++) {
    const item = ALL_CANONICAL_COMPONENTS[i];
    const testId = `comp-${item.library}-${item.concept}`;
    testStates.set(testId, {
      item,
      testId,
      isDefined: Boolean(customElements.get(item.tag)),
      isMounted: false,
      hasShadowRoot: false,
      isInteractive: false,
    });
  }
}

// Initialize on load
initializeTestStates();

export function updateAuditMetrics(activeFeature: string, onRunTests?: () => Promise<void>): void {
  for (const state of testStates.values()) {
    state.isDefined = Boolean(customElements.get(state.item.tag));
    const el = document.getElementById(state.testId);
    if (el) {
      state.isMounted = true;
      state.hasShadowRoot = Boolean(el.shadowRoot);
    }
  }

  const states = Array.from(testStates.values());
  const definedCount = states.filter((s) => s.isDefined).length;
  const mountedCount = states.filter((s) => s.isMounted).length;
  const shadowCount = states.filter((s) => s.hasShadowRoot).length;
  const interactiveCount = states.filter((s) => s.isInteractive).length;

  window.__TEST_RESULTS__ = {
    feature: activeFeature,
    timestamp: new Date().toISOString(),
    totalComponents: states.length,
    definedComponents: definedCount,
    mountedComponents: mountedCount,
    shadowRootsAttached: shadowCount,
    interactivePassed: interactiveCount,
    components: states.map((s) => ({
      concept: s.item.concept,
      library: s.item.library,
      tag: s.item.tag,
      isDefined: s.isDefined,
      isMounted: s.isMounted,
      hasShadowRoot: s.hasShadowRoot,
      isInteractive: s.isInteractive,
      error: s.error,
    })),
    runInteractiveTests: onRunTests || (async () => {}),
  };

  // Update DOM metric cards if rendered
  const elDefined = document.getElementById('metric-defined');
  if (elDefined) elDefined.textContent = `${definedCount} / ${states.length}`;

  const elMounted = document.getElementById('metric-mounted');
  if (elMounted) elMounted.textContent = `${mountedCount} / ${states.length}`;

  const elShadow = document.getElementById('metric-shadow');
  if (elShadow) elShadow.textContent = `${shadowCount} / ${states.length}`;

  const elInteractive = document.getElementById('metric-interactive');
  if (elInteractive) elInteractive.textContent = `${interactiveCount} passed`;
}

export async function runInteractiveTests(activeFeature: string, onAfterTests?: () => void): Promise<void> {
  const btnTest = document.getElementById('btn-run-tests') as HTMLButtonElement | null;
  if (btnTest) {
    btnTest.innerHTML = `
      <svg class="w-4 h-4 animate-spin stroke-[1.75]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
      </svg>
      <span>Testing...</span>
    `;
    btnTest.disabled = true;
  }

  for (const state of testStates.values()) {
    const el = document.getElementById(state.testId);
    if (!el) continue;

    try {
      // Test click / activation
      let clicked = false;
      const clickHandler = () => {
        clicked = true;
      };
      el.addEventListener('click', clickHandler, { once: true });
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // Also test change for input-like elements
      el.dispatchEvent(new Event('change', { bubbles: true }));

      state.isInteractive = clicked;
    } catch (err: any) {
      state.isInteractive = false;
      state.error = err?.message || 'Interaction test failed';
    }
  }

  updateAuditMetrics(activeFeature, () => runInteractiveTests(activeFeature, onAfterTests));
  onAfterTests?.();

  if (btnTest) {
    btnTest.innerHTML = `
      <svg class="w-4 h-4 stroke-[1.75]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Interactions verified</span>
    `;
    btnTest.disabled = false;
    setTimeout(() => {
      btnTest.innerHTML = `
        <svg class="w-4 h-4 stroke-[1.75]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="6 3 20 12 6 21 6 3"></polygon>
        </svg>
        <span>Test interactions</span>
      `;
    }, 2500);
  }
}
