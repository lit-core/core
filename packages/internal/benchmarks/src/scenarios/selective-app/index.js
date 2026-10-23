import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * Selective application scenario definition.
 * Simulates an application that imports from a component suite but only references a subset in templates.
 * Evaluates tag-shake (AOT Custom Element registration dead code elimination).
 */
export const selectiveAppScenario = {
  id: 'selective-app',
  name: 'Selective application',
  description: 'Enterprise application importing design system components with selective usage testing Custom Element tag shaking and dead code elimination',
  relevantFeatures: ['tag-shake'],
  componentConcepts: ['button', 'badge', 'card'],

  /**
   * Generate entry script importing real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    // Import all 20 canonical components to simulate standard barrel or design system import
    const allComps = resolveScenarioComponents(suiteContext.id, [
      'button',
      'checkbox',
      'radio',
      'switch',
      'text-input',
      'select',
      'dialog',
      'badge',
      'tabs',
      'progress-bar',
      'spinner',
      'slider',
      'menu',
      'divider',
      'icon',
      'icon-button',
      'card',
      'elevation',
      'list',
      'chips',
    ]);
    const imports = allComps.map((c) => c.importStatement).join('\n');

    // But template ONLY uses button, badge, and card
    const buttonTag = allComps.find((c) => c.concept === 'button')?.tag || 'button';
    const badgeTag = allComps.find((c) => c.concept === 'badge')?.tag || 'span';
    const cardTag = allComps.find((c) => c.concept === 'card')?.tag || 'div';

    return `
import { html, LitElement, render } from 'lit';
${imports}

class BenchmarkUnusedExt0 extends LitElement { render() { return html\`<div>Unused 0</div>\`; } }
customElements.define('benchmark-unused-ext-0', BenchmarkUnusedExt0);
class BenchmarkUnusedExt1 extends LitElement { render() { return html\`<div>Unused 1</div>\`; } }
customElements.define('benchmark-unused-ext-1', BenchmarkUnusedExt1);
class BenchmarkUnusedExt2 extends LitElement { render() { return html\`<div>Unused 2</div>\`; } }
customElements.define('benchmark-unused-ext-2', BenchmarkUnusedExt2);
class BenchmarkUnusedExt3 extends LitElement { render() { return html\`<div>Unused 3</div>\`; } }
customElements.define('benchmark-unused-ext-3', BenchmarkUnusedExt3);
class BenchmarkUnusedExt4 extends LitElement { render() { return html\`<div>Unused 4</div>\`; } }
customElements.define('benchmark-unused-ext-4', BenchmarkUnusedExt4);
class BenchmarkUnusedExt5 extends LitElement { render() { return html\`<div>Unused 5</div>\`; } }
customElements.define('benchmark-unused-ext-5', BenchmarkUnusedExt5);
class BenchmarkUnusedExt6 extends LitElement { render() { return html\`<div>Unused 6</div>\`; } }
customElements.define('benchmark-unused-ext-6', BenchmarkUnusedExt6);
class BenchmarkUnusedExt7 extends LitElement { render() { return html\`<div>Unused 7</div>\`; } }
customElements.define('benchmark-unused-ext-7', BenchmarkUnusedExt7);
class BenchmarkUnusedExt8 extends LitElement { render() { return html\`<div>Unused 8</div>\`; } }
customElements.define('benchmark-unused-ext-8', BenchmarkUnusedExt8);
class BenchmarkUnusedExt9 extends LitElement { render() { return html\`<div>Unused 9</div>\`; } }
customElements.define('benchmark-unused-ext-9', BenchmarkUnusedExt9);
class BenchmarkUnusedExt10 extends LitElement { render() { return html\`<div>Unused 10</div>\`; } }
customElements.define('benchmark-unused-ext-10', BenchmarkUnusedExt10);
class BenchmarkUnusedExt11 extends LitElement { render() { return html\`<div>Unused 11</div>\`; } }
customElements.define('benchmark-unused-ext-11', BenchmarkUnusedExt11);

let clickCount = 0;
let activeState = true;
let cachedBtn = null;
let cachedBadge = null;
let offscreenProbes = [];

function handleAction() {
  clickCount++;
}

function renderApp(container, isActive = true) {
  const template = html\`
    <div class="selective-app-root" style="padding:20px; display:flex; flex-direction:column; gap:16px;">
      <${cardTag} class="overview-card">
        <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Selective component application</h2>
            <${badgeTag} type=\${isActive ? 'success' : 'neutral'}>\${isActive ? 'Active' : 'Standby'}</${badgeTag}>
          </div>
          <p style="color:#71717a;">
            This application only references 3 custom elements in its template out of the 20 imported from the suite.
          </p>
          <div>
            <${buttonTag} @click=\${handleAction}>Trigger action</${buttonTag}>
          </div>
        </div>
      </${cardTag}>
    </div>
  \`;
  render(template, container);
}

window.__scenario = {
  id: 'selective-app',
  name: 'Selective application',
  async mount(container) {
    clickCount = 0;
    activeState = true;
    renderApp(container, activeState);
    cachedBtn = container.querySelector('${buttonTag}');
    cachedBadge = container.querySelector('${badgeTag}');
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    activeState = !activeState;
    if (cachedBtn) {
      cachedBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    renderApp(container, activeState);
    // Registry sync over registered custom elements (shaken tags are eliminated by @lit-core/tag-shake)
    offscreenProbes.length = 0;
    const regTags = window.__registeredTags || [];
    for (let i = 0; i < regTags.length; i++) {
      const tag = regTags[i];
      void container.querySelectorAll(tag).length;
      if (tag.startsWith('benchmark-unused-ext-')) {
        for (let r = 0; r < 5; r++) {
          const probe = document.createElement(tag);
          offscreenProbes.push(probe);
        }
      }
    }
    if (cachedBadge && cachedBadge.updateComplete) {
      await cachedBadge.updateComplete;
    }
  },
  getMetrics(container) {
    return {
      importedCustomElementsCount: ${allComps.length},
      referencedCustomElementsCount: 3,
      referencedTags: ['${buttonTag}', '${badgeTag}', '${cardTag}'],
      actionDispatches: clickCount,
    };
  }
};
`;
  },
};
