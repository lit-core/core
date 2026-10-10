import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * SSR dashboard scenario definition.
 * Simulates a server-rendered analytics dashboard with Declarative Shadow DOM cards and metrics.
 * Evaluates resumable (zero-JS SSR resumption) and html-aot (AOT template prepare elimination).
 */
export const ssrDashboardScenario = {
  id: 'ssr-dashboard',
  name: 'SSR dashboard',
  description: 'Server-rendered dashboard with Declarative Shadow DOM components testing zero-JS resumption and AOT template compilation',
  relevantFeatures: ['resumable', 'html-aot'],
  componentConcepts: ['card', 'badge', 'progress-bar', 'button', 'tabs'],

  /**
   * Generate entry script importing real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    const comps = resolveScenarioComponents(suiteContext.id, this.componentConcepts);
    const imports = comps.map((c) => c.importStatement).join('\n');
    const cardTag = comps.find((c) => c.concept === 'card')?.tag || 'div';
    const badgeTag = comps.find((c) => c.concept === 'badge')?.tag || 'span';
    const progressTag = comps.find((c) => c.concept === 'progress-bar')?.tag || 'progress';
    const buttonTag = comps.find((c) => c.concept === 'button')?.tag || 'button';
    const tabsTag = comps.find((c) => c.concept === 'tabs')?.tag || 'div';

    return `
import { html, render } from 'lit';
${imports}

const DASHBOARD_METRICS = [
  { id: 'cpu', label: 'CPU utilization', value: '42%', progress: 0.42, status: 'Healthy', statusType: 'success' },
  { id: 'memory', label: 'Memory allocation', value: '78%', progress: 0.78, status: 'Elevated', statusType: 'warning' },
  { id: 'io', label: 'Disk throughput', value: '1.2 GB/s', progress: 0.60, status: 'Normal', statusType: 'neutral' },
  { id: 'network', label: 'Bandwidth saturation', value: '25%', progress: 0.25, status: 'Optimal', statusType: 'success' },
];

let resumedInteractions = 0;
function handleActionClick(metricId) {
  resumedInteractions++;
}

function renderDashboard(container, metrics) {
  const template = html\`
    <div class="ssr-dashboard-root" style="display:flex; flex-direction:column; gap:20px;">
      <header class="dashboard-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3 class="dashboard-title">System telemetry overview</h3>
        <${tabsTag}></${tabsTag}>
      </header>

      <div class="metrics-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px;">
        \${metrics.map(m => html\`
          <${cardTag} class="metric-card" data-metric=\${m.id}>
            <div class="card-inner" style="padding:16px; display:flex; flex-direction:column; gap:8px;">
              <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span class="metric-label" style="font-size:14px; color:#52525b;">\${m.label}</span>
                <${badgeTag} type=\${m.statusType}>\${m.status}</${badgeTag}>
              </div>
              <div class="metric-value" style="font-size:24px; font-weight:500;">\${m.value}</div>
              <${progressTag} value=\${m.progress} max="1"></${progressTag}>
              <div class="card-footer" style="margin-top:8px;">
                <${buttonTag} size="sm" @click=\${() => handleActionClick(m.id)}>Inspect \${m.id}</${buttonTag}>
              </div>
            </div>
          </${cardTag}>
        \`)}
      </div>
    </div>
  \`;
  render(template, container);
}

window.__scenario = {
  id: 'ssr-dashboard',
  name: 'SSR dashboard',
  async mount(container) {
    resumedInteractions = 0;
    renderDashboard(container, DASHBOARD_METRICS);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    // Trigger interaction on cards (simulating hydration / resumption)
    const buttons = container.querySelectorAll('${buttonTag}');
    for (const btn of buttons) {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    const updatedMetrics = DASHBOARD_METRICS.map(m => ({
      ...m,
      progress: Math.min(1, m.progress + 0.1),
    }));
    renderDashboard(container, updatedMetrics);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      cardsCount: DASHBOARD_METRICS.length,
      progressBarsCount: DASHBOARD_METRICS.length,
      resumedInteractions,
      renderedNodes: container.querySelectorAll('*').length,
    };
  }
};
`;
  },
};
