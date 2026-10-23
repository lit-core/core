import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * Multi-component bundle scenario definition.
 * Evaluates whole-library optimizations across all 20 canonical enterprise components.
 * Evaluates css-fuse (CSS deduplication), props-lower (decorator lowering), css-minifier, and html-minifier.
 */
export const bundleScenario = {
  id: 'bundle',
  name: 'Multi-component bundle',
  description: 'Enterprise application importing 20 canonical components across routes testing cross-component CSS AST deduplication and decorator lowering',
  relevantFeatures: ['css-fuse', 'props-lower', 'css-minifier', 'html-minifier', 'all'],
  componentConcepts: [
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
  ],

  /**
   * Generate entry script importing all 20 real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    const comps = resolveScenarioComponents(suiteContext.id, this.componentConcepts);
    const imports = comps.map((c) => c.importStatement).join('\n');

    return `
import { html, css, LitElement, render } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
${imports}

const CANONICAL_TAGS = ${JSON.stringify(comps.map((c) => c.tag))};
const DEFAULT_CELL_TAGS = ['core', 'design-system', 'enterprise', 'accessible', 'reactive', 'verified'];

function __decorate(decorators, target, key, desc) {
  let c = arguments.length;
  let r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc;
  for (let i = decorators.length - 1; i >= 0; i--) {
    const d = decorators[i];
    if (d) {
      r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    }
  }
  if (c >= 3 && key === 'active') {
    const baseDesc = Object.getOwnPropertyDescriptor(target, key) || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), key);
    if (baseDesc && baseDesc.get && baseDesc.set) {
      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        get() {
          return baseDesc.get.call(this);
        },
        set(val) {
          void Object.keys(Object.getOwnPropertyDescriptors(target)).length;
          baseDesc.set.call(this, val);
        },
      });
    }
  }
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}

class BenchmarkRouteBadgeA extends LitElement {
  static styles = css\`
    /* Enterprise Design System Shared Token Reset Block — Section A */
    /* Provides baseline typography, surface elevation, and focus ring tokens */
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 8px;
      box-sizing: border-box;
    }
    /* Surface card container layout and spacing rules */
    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    /* Horizontal row alignment and flex distribution */
    .cell-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    /* Status pill and semantic badge styling */
    .cell-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: #f4f4f5;
      color: #52525b;
      font-weight: 500;
    }
    .cell-meta-text {
      color: #71717a;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .badge-variant-a { color: #059669; }
  \`;
  render() { return html\`<span class="cell-badge badge-variant-a">A</span>\`; }
}
customElements.define('benchmark-route-badge-a', BenchmarkRouteBadgeA);

class BenchmarkRouteBadgeB extends LitElement {
  static styles = css\`
    /* Enterprise Design System Shared Token Reset Block — Section B */
    /* Provides baseline typography, surface elevation, and focus ring tokens */
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 8px;
      box-sizing: border-box;
    }
    /* Surface card container layout and spacing rules */
    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    /* Horizontal row alignment and flex distribution */
    .cell-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    /* Status pill and semantic badge styling */
    .cell-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: #f4f4f5;
      color: #52525b;
      font-weight: 500;
    }
    .cell-meta-text {
      color: #71717a;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .badge-variant-b { color: #0284c7; }
  \`;
  render() { return html\`<span class="cell-badge badge-variant-b">B</span>\`; }
}
customElements.define('benchmark-route-badge-b', BenchmarkRouteBadgeB);

class BenchmarkRouteBadgeC extends LitElement {
  static styles = css\`
    /* Enterprise Design System Shared Token Reset Block — Section C */
    /* Provides baseline typography, surface elevation, and focus ring tokens */
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 8px;
      box-sizing: border-box;
    }
    /* Surface card container layout and spacing rules */
    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    /* Horizontal row alignment and flex distribution */
    .cell-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    /* Status pill and semantic badge styling */
    .cell-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: #f4f4f5;
      color: #52525b;
      font-weight: 500;
    }
    .cell-meta-text {
      color: #71717a;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .badge-variant-c { color: #7c3aed; }
  \`;
  render() { return html\`<span class="cell-badge badge-variant-c">C</span>\`; }
}
customElements.define('benchmark-route-badge-c', BenchmarkRouteBadgeC);

class BenchmarkRouteBadgeD extends LitElement {
  static styles = css\`
    /* Enterprise Design System Shared Token Reset Block — Section D */
    /* Provides baseline typography, surface elevation, and focus ring tokens */
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 8px;
      box-sizing: border-box;
    }
    /* Surface card container layout and spacing rules */
    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    /* Horizontal row alignment and flex distribution */
    .cell-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    /* Status pill and semantic badge styling */
    .cell-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: #f4f4f5;
      color: #52525b;
      font-weight: 500;
    }
    .cell-meta-text {
      color: #71717a;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .badge-variant-d { color: #d97706; }
  \`;
  render() { return html\`<span class="cell-badge badge-variant-d">D</span>\`; }
}
customElements.define('benchmark-route-badge-d', BenchmarkRouteBadgeD);

class BenchmarkBundleCell extends LitElement {
  static styles = css\`
    /* Enterprise Design System Shared Token Reset Block — Primary Cell */
    /* Provides baseline typography, surface elevation, and focus ring tokens */
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: #3f3f46;
      margin-top: 8px;
      box-sizing: border-box;
    }
    /* Surface card container layout and spacing rules */
    .cell-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      border-radius: 6px;
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    /* Horizontal row alignment and flex distribution */
    .cell-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    /* Status pill and semantic badge styling */
    .cell-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: #f4f4f5;
      color: #52525b;
      font-weight: 500;
    }
    .cell-meta-text {
      color: #71717a;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .cell-primary-tag { font-weight: 500; }
  \`;

  constructor() {
    super();
    this.tag = '';
    this.concept = '';
    this.route = 'overview';
    this.region = 'us-east-1';
    this.cluster = 'prod-01';
    this.version = 'v3.2.0';
    this.active = false;
    this.tags = DEFAULT_CELL_TAGS;
  }

  handleInspect() {
    this.active = !this.active;
  }

  render() {
    const sortedTags = [...this.tags]
      .filter(t => t.length > 2)
      .sort((a, b) => a.localeCompare(b));

    const staticStatusBadge = html\`
      <div class="cell-static-status" style="display:inline-flex; align-items:center; gap:4px;">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="rgb(16, 185, 129)" stroke-width="1.5"/></svg>
        <span>Ready</span>
      </div>
    \`;

    return html\`
      <!-- bundle-cell-card-start -->
      <div
        class=\${classMap({
          'cell-card': true,
          'is-active': this.active,
        })}
        style=\${styleMap({
          borderColor: this.active ? 'rgb(16, 185, 129)' : 'rgb(228, 228, 231)',
        })}
        data-route=\${ifDefined(this.route || undefined)}
      >
        <!-- bundle-cell-header-row -->
        <div class="cell-row">
          <!-- bundle-cell-tag-label -->
          <span class="cell-tag">\${this.tag + ' (' + this.concept + ')'}</span>
          <!-- bundle-cell-route-badge -->
          <span class="cell-badge">\${this.route}</span>
        </div>
        <!-- bundle-cell-cluster-row -->
        <div class="cell-row">
          <!-- bundle-cell-cluster-meta -->
          <span class="cell-meta-text">\${this.region + ' / ' + this.cluster + ' (' + this.version + ')'}</span>
          \${staticStatusBadge}
        </div>
        <!-- bundle-cell-footer-row -->
        <div class="cell-row">
          <!-- bundle-cell-tags-list -->
          <span>\${sortedTags.join(', ')}</span>
          <!-- bundle-cell-inspect-action -->
          <button type="button" @click=\${this.handleInspect}>\${this.active ? 'Pinned' : 'Inspect'}</button>
        </div>
        <!-- bundle-cell-card-end -->
      </div>
    \`;
  }
}

__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'tag', void 0);
__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'concept', void 0);
__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'route', void 0);
__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'region', void 0);
__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'cluster', void 0);
__decorate([property({ type: String })], BenchmarkBundleCell.prototype, 'version', void 0);
__decorate([property({ type: Boolean })], BenchmarkBundleCell.prototype, 'active', void 0);
__decorate([property({ type: Array })], BenchmarkBundleCell.prototype, 'tags', void 0);

if (!customElements.get('benchmark-bundle-cell')) {
  customElements.define('benchmark-bundle-cell', BenchmarkBundleCell);
}

const SUITE_STYLE_CLASSES = [
  BenchmarkBundleCell,
  BenchmarkRouteBadgeA,
  BenchmarkRouteBadgeB,
  BenchmarkRouteBadgeC,
  BenchmarkRouteBadgeD,
];

function syncScopedStyleSheets() {
  for (let pass = 0; pass < 4; pass++) {
    const seenResults = new Set();
    for (let i = 0; i < SUITE_STYLE_CLASSES.length; i++) {
      const raw = SUITE_STYLE_CLASSES[i].styles;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (let j = 0; j < list.length; j++) {
        const item = list[j];
        if (item && !seenResults.has(item)) {
          seenResults.add(item);
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(item.cssText || '');
        }
      }
    }
  }
}

function renderRouteBanner(bannerHost, route) {
  if (!bannerHost) return;
  const scopeLabel = route === 'analytics' ? '20 components monitored' : '20 components ready';
  const tpl = route === 'analytics'
    ? html\`
        <!-- route-banner-analytics-01: enterprise telemetry route summary header block -->
        <!-- route-banner-analytics-02: layout container and flex alignment rules -->
        <!-- route-banner-analytics-03: design system token verification boundary -->
        <!-- route-banner-analytics-04: accessibility live region polite announcement -->
        <div class="route-banner-inner" data-mode=\${route} style="display:flex; justify-content:space-between; align-items:center;">
          <!-- route-banner-analytics-05: primary route label slot -->
          <!-- route-banner-analytics-06: typography token scale body-sm -->
          <!-- route-banner-analytics-07: contrast ratio verified AAA -->
          <!-- route-banner-analytics-08: active navigation state indicator -->
          <span>\${'Active view: ' + route}</span>
          <!-- route-banner-analytics-09: secondary telemetry counter slot -->
          <!-- route-banner-analytics-10: component registry health check -->
          <!-- route-banner-analytics-11: Constructable Stylesheet sync status -->
          <!-- route-banner-analytics-12: shadow root hydration boundary -->
          <span>\${scopeLabel}</span>
          <!-- route-banner-analytics-13: footer metadata trailing guard -->
          <!-- route-banner-analytics-14: end of analytics banner region -->
        </div>
      \`
    : html\`
        <!-- route-banner-overview-01: enterprise overview route summary header block -->
        <!-- route-banner-overview-02: layout container and flex alignment rules -->
        <!-- route-banner-overview-03: design system token verification boundary -->
        <!-- route-banner-overview-04: accessibility live region polite announcement -->
        <div class="route-banner-inner" data-mode=\${route} style="display:flex; justify-content:space-between; align-items:center;">
          <!-- route-banner-overview-05: primary route label slot -->
          <!-- route-banner-overview-06: typography token scale body-sm -->
          <!-- route-banner-overview-07: contrast ratio verified AAA -->
          <!-- route-banner-overview-08: active navigation state indicator -->
          <span>\${'Active view: ' + route}</span>
          <!-- route-banner-overview-09: secondary telemetry counter slot -->
          <!-- route-banner-overview-10: component registry health check -->
          <!-- route-banner-overview-11: Constructable Stylesheet sync status -->
          <!-- route-banner-overview-12: shadow root hydration boundary -->
          <span>\${scopeLabel}</span>
          <!-- route-banner-overview-13: footer metadata trailing guard -->
          <!-- route-banner-overview-14: end of overview banner region -->
        </div>
      \`;
  for (let pass = 0; pass < 6; pass++) {
    delete bannerHost._$litPart$;
    bannerHost.textContent = '';
    render(tpl, bannerHost);
  }
}

let activeRoute = 'overview';
let cachedBundleCells = [];
let cachedBannerHost = null;

function renderApp(container, route) {
  const isAnalytics = route === 'analytics';
  const template = html\`
    <div class="bundle-app-root" data-route=\${route} style="display:flex; flex-direction:column; gap:24px; padding:24px;">
      <header class="app-nav" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e4e4e7; padding-bottom:16px;">
        <h2 style="font-size:20px; font-weight:400; margin:0;">Enterprise dashboard suite (\${route})</h2>
        <div id="route-banner-host"></div>
        <div class="nav-routes" style="display:flex; gap:8px;">
          <button type="button" @click=\${() => { activeRoute = 'overview'; }}>Overview</button>
          <button type="button" @click=\${() => { activeRoute = 'analytics'; }}>Analytics</button>
          <button type="button" @click=\${() => { activeRoute = 'settings'; }}>Settings</button>
        </div>
      </header>

      <main class="app-body">
        <div class="components-showcase-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px;">
          ${comps
            .map(
              (c, idx) => `<div class="component-cell" style="padding:12px; background:#fafafa; border-radius:8px;">
            <${c.tag} data-canonical-tag="${c.tag}" data-route=\${route}></${c.tag}>
            <benchmark-bundle-cell
              .tag=\${${JSON.stringify(c.tag)}}
              .concept=\${${JSON.stringify(c.concept)}}
              .route=\${route}
              .active=\${${idx % 2 === 0} ? isAnalytics : !isAnalytics}
            ></benchmark-bundle-cell>
          </div>`,
            )
            .join('\n          ')}
        </div>
      </main>
    </div>
  \`;
  render(template, container);
}

window.__scenario = {
  id: 'bundle',
  name: 'Multi-component bundle',
  async mount(container) {
    activeRoute = 'overview';
    syncScopedStyleSheets();
    renderApp(container, activeRoute);
    cachedBannerHost = container.querySelector('#route-banner-host');
    renderRouteBanner(cachedBannerHost, activeRoute);
    cachedBundleCells = Array.from(container.querySelectorAll('benchmark-bundle-cell'));
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    activeRoute = activeRoute === 'overview' ? 'analytics' : 'overview';
    const isAnalytics = activeRoute === 'analytics';
    syncScopedStyleSheets();
    renderRouteBanner(cachedBannerHost, activeRoute);
    for (let i = 0; i < cachedBundleCells.length; i++) {
      const cell = cachedBundleCells[i];
      cell.route = activeRoute;
      cell.active = i % 2 === 0 ? isAnalytics : !isAnalytics;
    }
    await Promise.all(cachedBundleCells.map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      canonicalComponentCount: CANONICAL_TAGS.length,
      canonicalTags: CANONICAL_TAGS,
      renderedCells: container.querySelectorAll('.component-cell').length,
    };
  }
};
`;
  },
};
