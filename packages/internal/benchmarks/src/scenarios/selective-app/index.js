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
import { html, render } from 'lit';
${imports}

let clickCount = 0;
function handleAction() {
  clickCount++;
}

function renderApp(container) {
  const template = html\`
    <div class="selective-app-root" style="padding:20px; display:flex; flex-direction:column; gap:16px;">
      <${cardTag} class="overview-card">
        <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h2>Selective component application</h2>
            <${badgeTag} type="success">Active</${badgeTag}>
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
    renderApp(container);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    const btn = container.querySelector('${buttonTag}');
    if (btn) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    renderApp(container);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
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
