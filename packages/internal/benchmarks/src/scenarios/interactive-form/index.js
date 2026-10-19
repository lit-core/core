import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * Interactive form scenario definition.
 * Simulates a multi-section configuration and settings dashboard with real interactive controls.
 * Evaluates event-hoist (ShadowRoot event delegation) and elem-proxy (deferred registration/proxy stubs).
 */
export const interactiveFormScenario = {
  id: 'interactive-form',
  name: 'Interactive form',
  description: 'Dense multi-section interactive settings form with real controls testing event listener hoisting and deferred proxy registration',
  relevantFeatures: ['event-hoist', 'elem-proxy'],
  componentConcepts: ['text-input', 'checkbox', 'switch', 'radio', 'select', 'button'],

  /**
   * Generate entry script importing real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    const comps = resolveScenarioComponents(suiteContext.id, this.componentConcepts);
    const imports = comps.map((c) => c.importStatement).join('\n');
    const inputTag = comps.find((c) => c.concept === 'text-input')?.tag || 'input';
    const checkboxTag = comps.find((c) => c.concept === 'checkbox')?.tag || 'input';
    const switchTag = comps.find((c) => c.concept === 'switch')?.tag || 'input';
    const radioTag = comps.find((c) => c.concept === 'radio')?.tag || 'input';
    const selectTag = comps.find((c) => c.concept === 'select')?.tag || 'select';
    const buttonTag = comps.find((c) => c.concept === 'button')?.tag || 'button';

    return `
import { html, render } from 'lit';
${imports}

const SECTIONS = [
  { id: 'profile', title: 'Profile details', field: 'Username', notify: true, role: 'admin' },
  { id: 'notifications', title: 'Notification preferences', field: 'Email channel', notify: false, role: 'viewer' },
  { id: 'security', title: 'Access control & security', field: 'Passkey alias', notify: true, role: 'editor' },
  { id: 'workspace', title: 'Workspace configuration', field: 'Organization', notify: true, role: 'admin' },
  { id: 'integrations', title: 'Third-party integrations', field: 'Webhook URL', notify: false, role: 'editor' },
];

let eventCounter = 0;
function handleInput(e) {
  eventCounter++;
}
function handleChange(e) {
  eventCounter++;
}
function handleClick(e) {
  eventCounter++;
}

function renderForm(container, sections) {
  const template = html\`
    <div class="interactive-form-root" style="display:flex; flex-direction:column; gap:16px;">
      \${sections.map(s => html\`
        <section class="form-section" data-section=\${s.id} style="padding:12px; border-radius:8px;">
          <h4 class="section-title">\${s.title}</h4>
          <div class="controls-row" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <${inputTag}
              label=\${s.field}
              value=\${s.field + ' value'}
              @input=\${handleInput}
            ></${inputTag}>
            <${switchTag}
              ?checked=\${s.notify}
              @change=\${handleChange}
            ></${switchTag}>
            <${checkboxTag}
              ?checked=\${!s.notify}
              @change=\${handleChange}
            ></${checkboxTag}>
            <${radioTag}
              name=\${s.id + '-role'}
              ?checked=\${s.role === 'admin'}
              @change=\${handleChange}
            ></${radioTag}>
            <${selectTag}
              value=\${s.role}
              @change=\${handleChange}
            ></${selectTag}>
            <${buttonTag}
              @click=\${handleClick}
            >Save \${s.id}</${buttonTag}>
          </div>
        </section>
      \`)}
    </div>
  \`;
  render(template, container);
}

window.__scenario = {
  id: 'interactive-form',
  name: 'Interactive form',
  async mount(container) {
    eventCounter = 0;
    renderForm(container, SECTIONS);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    // Simulate user interaction across form sections
    const inputs = container.querySelectorAll('${inputTag}');
    const switches = container.querySelectorAll('${switchTag}');
    const buttons = container.querySelectorAll('${buttonTag}');

    for (const inp of inputs) {
      inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    for (const sw of switches) {
      sw.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    for (const btn of buttons) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }

    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      sectionsCount: SECTIONS.length,
      controlsPerSection: 6,
      totalControls: SECTIONS.length * 6,
      eventsDispatched: eventCounter,
    };
  }
};
`;
  },
};
