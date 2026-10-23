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
import { html, LitElement, render } from 'lit';
${imports}

const ROW_COUNT = 25;

class BenchmarkCellMeta extends LitElement {
  static properties = {
    rowId: { type: Number },
    name: { type: String },
    category: { type: String },
    priority: { type: String },
    owner: { type: String },
    region: { type: String },
    cluster: { type: String },
    version: { type: String },
    department: { type: String },
    statusLabel: { type: String },
  };

  render() {
    return html\`
      <div class="meta-grid" style="display:flex; align-items:center; gap:6px; font-size:12px;">
        <span class="cell-id">\${this.rowId + '-' + this.priority + '-' + this.region + '-' + this.cluster}</span>
        <span class="cell-name">\${this.name + ' / ' + this.version + ' / ' + this.department + ' / ' + this.owner}</span>
        <span class="cell-category">\${this.category + ':' + this.cluster + ':' + this.region + ':' + this.priority}</span>
        <span class="cell-owner">\${this.owner + ' • ' + this.department + ' • ' + this.name + ' • ' + this.version}</span>
        <span class="cell-region">\${this.region + '|' + this.priority + '|' + this.cluster + '|' + this.category}</span>
        <span class="cell-summary">\${this.name + ' > ' + this.category + ' > ' + this.owner + ' > ' + this.department}</span>
        <span class="cell-audit">\${this.department + ' :: ' + this.region + ' :: ' + this.version + ' :: ' + this.cluster}</span>
        <span class="cell-status">\${this.statusLabel}</span>
      </div>
    \`;
  }
}

customElements.define('benchmark-cell-meta', BenchmarkCellMeta);

class BenchmarkCellDigest extends LitElement {
  static properties = {
    name: { type: String },
    category: { type: String },
    owner: { type: String },
    region: { type: String },
    cluster: { type: String },
    department: { type: String },
    statusLabel: { type: String },
  };

  constructor() {
    super();
    this.name = '';
    this.category = '';
    this.owner = '';
    this.region = '';
    this.cluster = '';
    this.department = '';
    this.statusLabel = 'Active';
  }

  render() {
    return html\`
      <div class="digest-grid" style="display:inline-flex; gap:4px; font-size:11px;">
        <span class="digest-a">\${[this.name, this.category, this.owner, this.region, this.cluster, this.department].map(v => String(v).trim().toUpperCase()).sort().join('|')}</span>
        <span class="digest-b">\${[this.department, this.cluster, this.region, this.owner, this.category, this.name].map(v => String(v).toLowerCase()).reverse().join(':')}</span>
        <span class="digest-c">\${[this.owner, this.name, this.department, this.category, this.region].map(v => '[' + String(v).trim() + ']').sort().join(' ')}</span>
        <span class="digest-status">\${this.statusLabel}</span>
      </div>
    \`;
  }
}

if (!customElements.get('benchmark-cell-digest')) {
  customElements.define('benchmark-cell-digest', BenchmarkCellDigest);
}

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
      priority: 'P' + ((i % 3) + 1),
      owner: 'team-' + (i % 4),
      region: i % 2 === 0 ? 'us-east-1' : 'eu-west-1',
      cluster: 'node-' + (i % 8),
      version: 'v2.' + (i % 5) + '.0',
      department: i % 2 === 0 ? 'Core Systems' : 'Cloud Runtime',
      disabled: i % 7 === 0,
      action: 'Edit',
    });
  }
  return rows;
}

let gridData = createInitialData();
let cachedMetaCells = [];
let cachedDigestCells = [];

function renderTable(container, data) {
  const template = html\`
    <div class="data-grid-container" role="table" style="display:flex; flex-direction:column; gap:4px;">
      \${data.map(row => html\`
        <div class="grid-row" data-id=\${row.id} style="display:flex; align-items:center; gap:8px;">
          <${checkboxTag} ?checked=\${row.selected} data-id=\${row.id}></${checkboxTag}>
          <${badgeTag} type=\${row.statusType}>\${row.status}</${badgeTag}>
          <benchmark-cell-meta
            .rowId=\${row.id}
            .name=\${row.name}
            .category=\${row.category}
            .priority=\${row.priority}
            .owner=\${row.owner}
            .region=\${row.region}
            .cluster=\${row.cluster}
            .version=\${row.version}
            .department=\${row.department}
            .statusLabel=\${row.status}
          ></benchmark-cell-meta>
          \${row.id < 16 ? html\`
            <benchmark-cell-digest
              .name=\${row.name}
              .category=\${row.category}
              .owner=\${row.owner}
              .region=\${row.region}
              .cluster=\${row.cluster}
              .department=\${row.department}
              .statusLabel=\${row.status}
            ></benchmark-cell-digest>
          \` : ''}
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
    cachedMetaCells = Array.from(container.querySelectorAll('benchmark-cell-meta'));
    cachedDigestCells = Array.from(container.querySelectorAll('benchmark-cell-digest'));
    const elements = container.querySelectorAll('*');
    await Promise.all(Array.from(elements).map(el => el.updateComplete || Promise.resolve()));
  },
  async update(container) {
    // Update statusLabel across all rows while 9 of 10 cell metadata props remain unchanged
    for (let i = 0; i < gridData.length; i++) {
      gridData[i].status = gridData[i].status === 'Active' ? 'Pending' : 'Active';
      if (cachedMetaCells[i]) {
        cachedMetaCells[i].statusLabel = gridData[i].status;
      }
      if (cachedDigestCells[i]) {
        cachedDigestCells[i].statusLabel = gridData[i].status;
      }
    }
    await Promise.all([
      ...cachedMetaCells.map(el => el.updateComplete || Promise.resolve()),
      ...cachedDigestCells.map(el => el.updateComplete || Promise.resolve()),
    ]);
  },
  getMetrics(container) {
    return {
      rowCount: ROW_COUNT,
      customElementsPerCell: 5,
      totalCustomElements: ROW_COUNT * 5,
      renderedNodes: container.querySelectorAll('*').length,
    };
  }
};
`;
  },
};
