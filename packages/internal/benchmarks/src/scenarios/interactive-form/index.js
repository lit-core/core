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
import { html, LitElement, render } from 'lit';
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

class BenchmarkFormAuditPanel extends LitElement {
  constructor() {
    super();
    this._sectionId = '';
    this._role = 'viewer';
    this._active = false;
    this._entries = Array.from({ length: 12 }, (_, k) => 'audit-entry-' + k);
  }
  get sectionId() {
    return this._sectionId;
  }
  set sectionId(val) {
    this._sectionId = val;
    if (this._$changedProperties) this.requestUpdate('sectionId');
  }
  get role() {
    return this._role;
  }
  set role(val) {
    this._role = val;
    if (this._$changedProperties) this.requestUpdate('role');
  }
  get active() {
    return this._active;
  }
  set active(val) {
    this._active = val;
    if (this._$changedProperties) this.requestUpdate('active');
  }
  render() {
    return html\`
      <div class="audit-panel" data-section=\${this.sectionId} data-role=\${this.role}>
        <header class="audit-header"><span>Audit log: \${this.sectionId}</span><span>\${this.role}</span></header>
        <div class="audit-body">
          <span>Status: \${this.active ? 'Active monitoring' : 'Standby'}</span>
          <ul>
            <li>Policy check: verified</li>
            <li>Session integrity: valid</li>
            <li>Permission scope: \${this.role}</li>
          </ul>
        </div>
      </div>
    \`;
  }
}
customElements.define('benchmark-form-audit-panel', BenchmarkFormAuditPanel);

class BenchmarkFormControlStrip extends LitElement {
  static properties = {
    sectionId: { type: String },
    role: { type: String },
    notify: { type: Boolean },
    step: { type: Number },
  };

  constructor() {
    super();
    this.sectionId = '';
    this.role = 'viewer';
    this.notify = false;
    this.step = 0;
  }

  onAction(e) {
    eventCounter++;
  }

  render() {
    const actionHandler = Object.assign((e) => this.onAction(e), {
      passive: this.step % 2 === 0,
    });
    return html\`
      <div class="control-strip" data-step=\${this.step} style="display:flex; gap:6px; align-items:center;">
        <button type="button" class="strip-btn" @click=\${actionHandler} @keydown=\${actionHandler} @keyup=\${actionHandler} @pointerdown=\${actionHandler} @pointerup=\${actionHandler}>Verify \${this.sectionId}</button>
        <button type="button" class="strip-btn" @click=\${actionHandler} @keydown=\${actionHandler} @keyup=\${actionHandler} @pointerdown=\${actionHandler} @pointerup=\${actionHandler}>Reset \${this.role}</button>
        <button type="button" class="strip-btn" @click=\${actionHandler} @keydown=\${actionHandler} @keyup=\${actionHandler} @pointerdown=\${actionHandler} @pointerup=\${actionHandler}>Sync (\${this.step})</button>
        <button type="button" class="strip-btn" @click=\${actionHandler} @keydown=\${actionHandler} @keyup=\${actionHandler} @pointerdown=\${actionHandler} @pointerup=\${actionHandler}>Audit</button>
        <input type="text" class="strip-input" .value=\${this.role} @input=\${actionHandler} @change=\${actionHandler} @keydown=\${actionHandler} @keyup=\${actionHandler} />
      </div>
    \`;
  }
}
if (!customElements.get('benchmark-form-control-strip')) {
  customElements.define('benchmark-form-control-strip', BenchmarkFormControlStrip);
}

let updateStep = 0;
let cachedStrips = [];
let cachedButtons = [];
let pendingAuditPanels = [];

function renderForm(container, sections, step = 0) {
  const template = html\`
    <div class="interactive-form-root" data-step=\${step} style="display:flex; flex-direction:column; gap:16px;">
      \${sections.map(s => html\`
        <section class="form-section" data-section=\${s.id} style="padding:12px; border-radius:8px;">
          <h4 class="section-title">\${s.title}</h4>
          <div class="controls-row" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <${inputTag}
              label=\${s.field}
              value=\${s.field + ' value ' + step}
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
            <benchmark-form-control-strip
              .sectionId=\${s.id}
              .role=\${s.role}
              .notify=\${s.notify}
              .step=\${step}
            ></benchmark-form-control-strip>
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
    updateStep = 0;
    renderForm(container, SECTIONS, updateStep);
    cachedStrips = Array.from(container.querySelectorAll('benchmark-form-control-strip'));
    cachedButtons = Array.from(container.querySelectorAll('${buttonTag}'));
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    updateStep++;
    for (let i = 0; i < cachedStrips.length; i++) {
      cachedStrips[i].step = updateStep;
    }
    if (cachedButtons[0]) {
      cachedButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    // Pre-instantiate offscreen lazy audit panels (deferred by @lit-core/elem-proxy until connected)
    pendingAuditPanels.length = 0;
    for (let round = 0; round < 14; round++) {
      for (let i = 0; i < SECTIONS.length; i++) {
        const s = SECTIONS[i];
        const panel = document.createElement('benchmark-form-audit-panel');
        panel.sectionId = s.id;
        panel.role = s.role;
        panel.active = updateStep % 2 === 0;
        panel.setAttribute('data-section', s.id);
        pendingAuditPanels.push(panel);
      }
    }
    await Promise.all(cachedStrips.map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      sectionsCount: SECTIONS.length,
      controlsPerSection: 7,
      totalControls: SECTIONS.length * 7,
      eventsDispatched: eventCounter,
    };
  }
};
`;
  },
};
