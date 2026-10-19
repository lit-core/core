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
  relevantFeatures: ['css-fuse', 'props-lower', 'css-minifier', 'html-minifier', 'all', 'baseline'],
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
import { html, render } from 'lit';
${imports}

const CANONICAL_TAGS = ${JSON.stringify(comps.map((c) => c.tag))};

let activeRoute = 'overview';

function renderApp(container, route) {
  const template = html\`
    <div class="bundle-app-root" style="display:flex; flex-direction:column; gap:24px; padding:24px;">
      <header class="app-nav" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e4e4e7; padding-bottom:16px;">
        <h2 style="font-size:20px; font-weight:400; margin:0;">Enterprise dashboard suite</h2>
        <div class="nav-routes" style="display:flex; gap:8px;">
          <button type="button" @click=\${() => activeRoute = 'overview'}>Overview</button>
          <button type="button" @click=\${() => activeRoute = 'analytics'}>Analytics</button>
          <button type="button" @click=\${() => activeRoute = 'settings'}>Settings</button>
        </div>
      </header>

      <main class="app-body">
        <div class="components-showcase-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px;">
          \${CANONICAL_TAGS.map(tag => {
            const el = document.createElement(tag);
            el.setAttribute('data-canonical-tag', tag);
            return html\`<div class="component-cell" style="padding:12px; background:#fafafa; border-radius:8px;">\${el}</div>\`;
          })}
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
    renderApp(container, activeRoute);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    activeRoute = activeRoute === 'overview' ? 'analytics' : 'overview';
    renderApp(container, activeRoute);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
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
