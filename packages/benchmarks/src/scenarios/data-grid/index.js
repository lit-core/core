import { resolveScenarioComponents } from '../harness/scenario-base.js';

/**
 * Data grid scenario definition.
 * Simulates a high-density enterprise tabular grid with 100 rows and 4-5 custom element cells per row.
 * Evaluates dom-paths (TreeWalker bypass), dirty-mask (dependency bitmasking), and native (micro-runtime).
 */
export const dataGridScenario = {
  id: 'data-grid',
  name: 'Data grid',
  description: 'High-density data grid rendering 100 rows with real component cells testing TreeWalker bypass, dependency bitmasking, and micro-runtime compilation',
  relevantFeatures: ['dom-paths', 'dirty-mask', 'native'],
  componentConcepts: ['checkbox', 'badge', 'button', 'icon-button'],

  /**
   * Generate entry script importing real components from the suite.
   * @param {import('../../types.js').SuiteContext} suiteContext
   * @returns {string}
   */
  generateEntry(suiteContext) {
    const comps = resolveScenarioComponents(suiteContext.id, this.componentConcepts);
    const imports = comps.map((c) => c.importStatement).join('\n');
    const checkboxTag = comps.find((c) => c.concept === 'checkbox')?.tag || 'input';
    const badgeTag = comps.find((c) => c.concept === 'badge')?.tag || 'span';
    const buttonTag = comps.find((c) => c.concept === 'button')?.tag || 'button';
    const iconButtonTag = comps.find((c) => c.concept === 'icon-button')?.tag || 'button';

    return `
import { html, render } from 'lit';
${imports}

const ROW_COUNT = 100;
function createInitialData() {
  const rows = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    rows.push({
      id: i,
      selected: i % 3 === 0,
      status: i % 2 === 0 ? 'Active' : 'Pending',
      statusType: i % 2 === 0 ? 'success' : 'neutral',
      name: 'Item ' + i,
      category: 'Cluster ' + (i % 5),
      disabled: i % 7 === 0,
      action: 'Edit',
    });
  }
  return rows;
}

let gridData = createInitialData();

function renderTable(container, data) {
  const template = html\`
    <div class="data-grid-container" role="table" style="display:flex; flex-direction:column; gap:4px;">
      \${data.map(row => html\`
        <div class="grid-row" data-id=\${row.id} style="display:flex; align-items:center; gap:8px;">
          <${checkboxTag} ?checked=\${row.selected} data-id=\${row.id}></${checkboxTag}>
          <${badgeTag} type=\${row.statusType}>\${row.status}</${badgeTag}>
          <span class="cell-id">\${row.id}</span>
          <span class="cell-name">\${row.name}</span>
          <span class="cell-category">\${row.category}</span>
          <${buttonTag} size="sm" ?disabled=\${row.disabled}>\${row.action}</${buttonTag}>
          <${iconButtonTag} size="sm" data-action="more"></${iconButtonTag}>
        </div>
      \`)}
    </div>
  \`;
  render(template, container);
}

window.__scenario = {
  id: 'data-grid',
  name: 'Data grid',
  async mount(container) {
    gridData = createInitialData();
    renderTable(container, gridData);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    // Mutate 35 rows (toggling selection and status)
    for (let i = 0; i < gridData.length; i += 3) {
      gridData[i].selected = !gridData[i].selected;
      gridData[i].status = gridData[i].selected ? 'Active' : 'Disabled';
      gridData[i].disabled = !gridData[i].disabled;
    }
    renderTable(container, [...gridData]);
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  getMetrics(container) {
    return {
      rowCount: ROW_COUNT,
      customElementsPerCell: 4,
      totalCustomElements: ROW_COUNT * 4,
      renderedNodes: container.querySelectorAll('*').length,
    };
  }
};
`;
  },
};
