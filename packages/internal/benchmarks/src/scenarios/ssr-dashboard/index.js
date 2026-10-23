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
  relevantFeatures: ['resumable', 'html-aot', 'ssr'],
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
import { html, LitElement, render } from 'lit';
${imports}

const DASHBOARD_METRICS = [
  { id: 'cpu', label: 'CPU utilization', value: '42%', progress: 0.42, status: 'Healthy', statusType: 'success' },
  { id: 'memory', label: 'Memory allocation', value: '78%', progress: 0.78, status: 'Elevated', statusType: 'warning' },
  { id: 'io', label: 'Disk throughput', value: '1.2 GB/s', progress: 0.60, status: 'Normal', statusType: 'neutral' },
  { id: 'network', label: 'Bandwidth saturation', value: '25%', progress: 0.25, status: 'Optimal', statusType: 'success' },
];

let resumedInteractions = 0;
let dashboardTick = 0;
function handleActionClick(metricId) {
  resumedInteractions++;
}

class BenchmarkTelemetryDetail extends LitElement {
  static properties = {
    metricId: { type: String },
    status: { type: String },
    expanded: { type: Boolean },
  };
  constructor() {
    super();
    this.metricId = '';
    this.status = '';
    this.expanded = false;
    this._renderCycle = 0;
  }
  render() {
    this._renderCycle = (this._renderCycle + 1) & 1;
    const summaryMeta = this.metricId + '|' + this.status + '|window:60s';
    if (this.expanded) {
      return html\`
        <!-- ssr-telemetry-boundary:expanded-start -->
        <!-- ssr-telemetry-hydration-marker:v1 -->
        <div class="telemetry-detail-expanded" data-id=\${this.metricId} data-meta=\${summaryMeta}>
          <!-- ssr-region-header -->
          <!-- ssr-region-header- guard -->
          <div class="telemetry-row">
            <!-- ssr-region-label -->
            <span>Live stream: \${this.status}</span>
            <!-- ssr-region-badge -->
            <span>Window: 60s</span>
          </div>
          <!-- ssr-region-sparkline -->
          <!-- ssr-region-percentiles -->
          <div class="telemetry-meta">
            <!-- ssr-p50 -->
            <span>p50: 1.2ms</span>
            <!-- ssr-p95 -->
            <span>p95: 4.8ms</span>
            <!-- ssr-p99 -->
            <span>p99: 9.1ms</span>
          </div>
          <!-- ssr-telemetry-boundary:expanded-end -->
        </div>
      \`;
    }
    let branchPass = 0;
    if (this._renderCycle === 0) {
      branchPass += 1;
      void branchPass;
      return html\`
        <!-- ssr-telemetry-boundary:compact-a-start -->
        <!-- ssr-telemetry-hydration-marker:a -->
        <div class="telemetry-detail-compact" data-id=\${this.metricId} data-meta=\${summaryMeta}>
          <!-- ssr-compact-header-a -->
          <!-- ssr-compact-header-guard-a -->
          <div class="telemetry-row">
            <!-- ssr-compact-label-a -->
            <span>Summary: \${this.status}</span>
            <!-- ssr-compact-badge-a -->
            <span>Window: 5m</span>
          </div>
          <!-- ssr-compact-sparkline-a -->
          <!-- ssr-compact-percentiles-a -->
          <div class="telemetry-meta">
            <!-- ssr-compact-p50-a -->
            <span>p50: 1.4ms</span>
            <!-- ssr-compact-p95-a -->
            <span>p95: 5.0ms</span>
            <!-- ssr-compact-p99-a -->
            <span>p99: 9.4ms</span>
          </div>
          <!-- ssr-telemetry-boundary:compact-a-end -->
        </div>
      \`;
    }
    branchPass += 2;
    void branchPass;
    return html\`
      <!-- ssr-telemetry-boundary:compact-b-start -->
      <!-- ssr-telemetry-hydration-marker:b -->
      <div class="telemetry-detail-compact" data-id=\${this.metricId} data-meta=\${summaryMeta}>
        <!-- ssr-compact-header-b -->
        <!-- ssr-compact-header-guard-b -->
        <div class="telemetry-row">
          <!-- ssr-compact-label-b -->
          <span>Summary: \${this.status}</span>
          <!-- ssr-compact-badge-b -->
          <span>Window: 5m</span>
        </div>
        <!-- ssr-compact-sparkline-b -->
        <!-- ssr-compact-percentiles-b -->
        <div class="telemetry-meta">
          <!-- ssr-compact-p50-b -->
          <span>p50: 1.4ms</span>
          <!-- ssr-compact-p95-b -->
          <span>p95: 5.0ms</span>
          <!-- ssr-compact-p99-b -->
          <span>p99: 9.4ms</span>
        </div>
        <!-- ssr-telemetry-boundary:compact-b-end -->
      </div>
    \`;
  }
}
if (!customElements.get('benchmark-telemetry-detail')) {
  customElements.define('benchmark-telemetry-detail', BenchmarkTelemetryDetail);
}

let cachedDetails = [];
let cachedButtons = [];

function renderDashboard(container, metrics, expanded = false) {
  const template = html\`
    <div class="ssr-dashboard-root" style="display:flex; flex-direction:column; gap:20px;">
      <header class="dashboard-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3 class="dashboard-title">System telemetry overview</h3>
        <${tabsTag} active="overview"></${tabsTag}>
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
              <benchmark-telemetry-detail .metricId=\${m.id + '-0'} .status=\${m.status} .expanded=\${expanded}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-1'} .status=\${m.status} .expanded=\${expanded}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-2'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-3'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-4'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-5'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-6'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
              <benchmark-telemetry-detail .metricId=\${m.id + '-7'} .status=\${m.status} .expanded=\${false}></benchmark-telemetry-detail>
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
    dashboardTick = 0;
    renderDashboard(container, DASHBOARD_METRICS, false);
    cachedDetails = Array.from(container.querySelectorAll('benchmark-telemetry-detail'));
    cachedButtons = Array.from(container.querySelectorAll('${buttonTag}'));
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    dashboardTick++;
    const isExpanded = dashboardTick % 2 === 1;
    if (cachedButtons[0]) {
      cachedButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    }
    for (let i = 0; i < cachedDetails.length; i++) {
      const detail = cachedDetails[i];
      if (i % 8 < 2) {
        detail.expanded = isExpanded;
      } else {
        detail.requestUpdate();
      }
    }
    await Promise.all(cachedDetails.map(el => el.updateComplete || Promise.resolve()));
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
