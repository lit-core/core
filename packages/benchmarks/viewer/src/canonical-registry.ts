/**
 * Canonical 20 enterprise UI components mapped across all 5 design systems.
 * Pure metadata and template generators without side-effect module imports.
 */

export interface ComponentItem {
  concept: string;
  conceptLabel: string;
  library: 'carbon' | 'spectrum' | 'webawesome' | 'material' | 'momentum';
  libraryLabel: string;
  tag: string;
  renderHtml: (testId: string) => string;
}

export const LIBRARIES = [
  { id: 'carbon', name: 'IBM Carbon' },
  { id: 'spectrum', name: 'Adobe Spectrum' },
  { id: 'webawesome', name: 'Web Awesome' },
  { id: 'material', name: 'Google Material Web' },
  { id: 'momentum', name: 'Cisco Momentum' },
] as const;

export const CONCEPTS = [
  { id: 'button', label: 'Button' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'radio', label: 'Radio button' },
  { id: 'switch', label: 'Switch / toggle' },
  { id: 'text-input', label: 'Text input' },
  { id: 'select', label: 'Select' },
  { id: 'dialog', label: 'Dialog' },
  { id: 'badge', label: 'Badge' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'progress-bar', label: 'Progress bar' },
  { id: 'spinner', label: 'Spinner' },
  { id: 'slider', label: 'Slider' },
  { id: 'menu', label: 'Menu' },
  { id: 'divider', label: 'Divider' },
  { id: 'icon', label: 'Icon' },
  { id: 'icon-button', label: 'Icon button' },
  { id: 'card', label: 'Card' },
  { id: 'elevation', label: 'Elevation / popover' },
  { id: 'list', label: 'List' },
  { id: 'chips', label: 'Chips / tags' },
] as const;

export const ALL_CANONICAL_COMPONENTS: ComponentItem[] = [
  // 1. Button
  { concept: 'button', conceptLabel: 'Button', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-button', renderHtml: (id) => `<cds-button id="${id}">Button</cds-button>` },
  { concept: 'button', conceptLabel: 'Button', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-button', renderHtml: (id) => `<sp-button id="${id}" variant="accent">Button</sp-button>` },
  { concept: 'button', conceptLabel: 'Button', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-button', renderHtml: (id) => `<wa-button id="${id}" variant="brand">Button</wa-button>` },
  {
    concept: 'button',
    conceptLabel: 'Button',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-filled-button',
    renderHtml: (id) => `<md-filled-button id="${id}">Button</md-filled-button>`,
  },
  { concept: 'button', conceptLabel: 'Button', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-button', renderHtml: (id) => `<mdc-button id="${id}">Button</mdc-button>` },

  // 2. Checkbox
  { concept: 'checkbox', conceptLabel: 'Checkbox', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-checkbox', renderHtml: (id) => `<cds-checkbox id="${id}" label-text="Active"></cds-checkbox>` },
  { concept: 'checkbox', conceptLabel: 'Checkbox', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-checkbox', renderHtml: (id) => `<sp-checkbox id="${id}">Active</sp-checkbox>` },
  { concept: 'checkbox', conceptLabel: 'Checkbox', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-checkbox', renderHtml: (id) => `<wa-checkbox id="${id}">Active</wa-checkbox>` },
  { concept: 'checkbox', conceptLabel: 'Checkbox', library: 'material', libraryLabel: 'Material Web', tag: 'md-checkbox', renderHtml: (id) => `<md-checkbox id="${id}"></md-checkbox>` },
  { concept: 'checkbox', conceptLabel: 'Checkbox', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-checkbox', renderHtml: (id) => `<mdc-checkbox id="${id}" label="Active"></mdc-checkbox>` },

  // 3. Radio
  {
    concept: 'radio',
    conceptLabel: 'Radio button',
    library: 'carbon',
    libraryLabel: 'Carbon',
    tag: 'cds-radio-button',
    renderHtml: (id) => `<cds-radio-button id="${id}" label-text="Option A" value="a"></cds-radio-button>`,
  },
  { concept: 'radio', conceptLabel: 'Radio button', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-radio', renderHtml: (id) => `<sp-radio id="${id}" value="a">Option A</sp-radio>` },
  { concept: 'radio', conceptLabel: 'Radio button', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-radio', renderHtml: (id) => `<wa-radio id="${id}" value="a">Option A</wa-radio>` },
  { concept: 'radio', conceptLabel: 'Radio button', library: 'material', libraryLabel: 'Material Web', tag: 'md-radio', renderHtml: (id) => `<md-radio id="${id}" value="a"></md-radio>` },
  {
    concept: 'radio',
    conceptLabel: 'Radio button',
    library: 'momentum',
    libraryLabel: 'Momentum',
    tag: 'mdc-radio',
    renderHtml: (id) => `<mdc-radio id="${id}" value="a" label="Option A"></mdc-radio>`,
  },

  // 4. Switch
  { concept: 'switch', conceptLabel: 'Switch / toggle', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-toggle', renderHtml: (id) => `<cds-toggle id="${id}" label-text="Toggle"></cds-toggle>` },
  { concept: 'switch', conceptLabel: 'Switch / toggle', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-switch', renderHtml: (id) => `<sp-switch id="${id}">Toggle</sp-switch>` },
  { concept: 'switch', conceptLabel: 'Switch / toggle', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-switch', renderHtml: (id) => `<wa-switch id="${id}">Toggle</wa-switch>` },
  { concept: 'switch', conceptLabel: 'Switch / toggle', library: 'material', libraryLabel: 'Material Web', tag: 'md-switch', renderHtml: (id) => `<md-switch id="${id}"></md-switch>` },
  { concept: 'switch', conceptLabel: 'Switch / toggle', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-toggle', renderHtml: (id) => `<mdc-toggle id="${id}" label="Toggle"></mdc-toggle>` },

  // 5. Text input
  {
    concept: 'text-input',
    conceptLabel: 'Text input',
    library: 'carbon',
    libraryLabel: 'Carbon',
    tag: 'cds-text-input',
    renderHtml: (id) => `<cds-text-input id="${id}" placeholder="Enter text..."></cds-text-input>`,
  },
  {
    concept: 'text-input',
    conceptLabel: 'Text input',
    library: 'spectrum',
    libraryLabel: 'Spectrum',
    tag: 'sp-textfield',
    renderHtml: (id) => `<sp-textfield id="${id}" placeholder="Enter text..."></sp-textfield>`,
  },
  {
    concept: 'text-input',
    conceptLabel: 'Text input',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-input',
    renderHtml: (id) => `<wa-input id="${id}" placeholder="Enter text..."></wa-input>`,
  },
  {
    concept: 'text-input',
    conceptLabel: 'Text input',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-filled-text-field',
    renderHtml: (id) => `<md-filled-text-field id="${id}" placeholder="Enter text..."></md-filled-text-field>`,
  },
  {
    concept: 'text-input',
    conceptLabel: 'Text input',
    library: 'momentum',
    libraryLabel: 'Momentum',
    tag: 'mdc-input',
    renderHtml: (id) => `<mdc-input id="${id}" placeholder="Enter text..."></mdc-input>`,
  },

  // 6. Select
  {
    concept: 'select',
    conceptLabel: 'Select',
    library: 'carbon',
    libraryLabel: 'Carbon',
    tag: 'cds-select',
    renderHtml: (id) => `<cds-select id="${id}"><select><option>Option 1</option></select></cds-select>`,
  },
  { concept: 'select', conceptLabel: 'Select', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-picker', renderHtml: (id) => `<sp-picker id="${id}" label="Options"></sp-picker>` },
  { concept: 'select', conceptLabel: 'Select', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-select', renderHtml: (id) => `<wa-select id="${id}" placeholder="Select..."></wa-select>` },
  { concept: 'select', conceptLabel: 'Select', library: 'material', libraryLabel: 'Material Web', tag: 'md-filled-select', renderHtml: (id) => `<md-filled-select id="${id}"></md-filled-select>` },
  { concept: 'select', conceptLabel: 'Select', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-select', renderHtml: (id) => `<mdc-select id="${id}"></mdc-select>` },

  // 7. Dialog
  { concept: 'dialog', conceptLabel: 'Dialog', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-modal', renderHtml: (id) => `<cds-modal id="${id}"><div>Dialog content</div></cds-modal>` },
  { concept: 'dialog', conceptLabel: 'Dialog', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-dialog', renderHtml: (id) => `<sp-dialog id="${id}"><div>Dialog content</div></sp-dialog>` },
  {
    concept: 'dialog',
    conceptLabel: 'Dialog',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-dialog',
    renderHtml: (id) => `<wa-dialog id="${id}"><div>Dialog content</div></wa-dialog>`,
  },
  { concept: 'dialog', conceptLabel: 'Dialog', library: 'material', libraryLabel: 'Material Web', tag: 'md-dialog', renderHtml: (id) => `<md-dialog id="${id}"><div>Dialog content</div></md-dialog>` },
  { concept: 'dialog', conceptLabel: 'Dialog', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-dialog', renderHtml: (id) => `<mdc-dialog id="${id}"><div>Dialog content</div></mdc-dialog>` },

  // 8. Badge
  { concept: 'badge', conceptLabel: 'Badge', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-tag', renderHtml: (id) => `<cds-tag id="${id}">Status</cds-tag>` },
  { concept: 'badge', conceptLabel: 'Badge', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-badge', renderHtml: (id) => `<sp-badge id="${id}">Status</sp-badge>` },
  { concept: 'badge', conceptLabel: 'Badge', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-badge', renderHtml: (id) => `<wa-badge id="${id}">Status</wa-badge>` },
  { concept: 'badge', conceptLabel: 'Badge', library: 'material', libraryLabel: 'Material Web', tag: 'md-badge', renderHtml: (id) => `<md-badge id="${id}" value="5"></md-badge>` },
  { concept: 'badge', conceptLabel: 'Badge', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-badge', renderHtml: (id) => `<mdc-badge id="${id}" label="Status"></mdc-badge>` },

  // 9. Tabs
  { concept: 'tabs', conceptLabel: 'Tabs', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-tabs', renderHtml: (id) => `<cds-tabs id="${id}"></cds-tabs>` },
  { concept: 'tabs', conceptLabel: 'Tabs', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-tabs', renderHtml: (id) => `<sp-tabs id="${id}" selected="1"></sp-tabs>` },
  { concept: 'tabs', conceptLabel: 'Tabs', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-tab-group', renderHtml: (id) => `<wa-tab-group id="${id}"></wa-tab-group>` },
  { concept: 'tabs', conceptLabel: 'Tabs', library: 'material', libraryLabel: 'Material Web', tag: 'md-tabs', renderHtml: (id) => `<md-tabs id="${id}"></md-tabs>` },
  { concept: 'tabs', conceptLabel: 'Tabs', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-menubar', renderHtml: (id) => `<mdc-menubar id="${id}"></mdc-menubar>` },

  // 10. Progress bar
  {
    concept: 'progress-bar',
    conceptLabel: 'Progress bar',
    library: 'carbon',
    libraryLabel: 'Carbon',
    tag: 'cds-progress-bar',
    renderHtml: (id) => `<cds-progress-bar id="${id}" value="60"></cds-progress-bar>`,
  },
  {
    concept: 'progress-bar',
    conceptLabel: 'Progress bar',
    library: 'spectrum',
    libraryLabel: 'Spectrum',
    tag: 'sp-progress-bar',
    renderHtml: (id) => `<sp-progress-bar id="${id}" value="60"></sp-progress-bar>`,
  },
  {
    concept: 'progress-bar',
    conceptLabel: 'Progress bar',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-progress-bar',
    renderHtml: (id) => `<wa-progress-bar id="${id}" value="60"></wa-progress-bar>`,
  },
  {
    concept: 'progress-bar',
    conceptLabel: 'Progress bar',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-linear-progress',
    renderHtml: (id) => `<md-linear-progress id="${id}" value="0.6"></md-linear-progress>`,
  },
  {
    concept: 'progress-bar',
    conceptLabel: 'Progress bar',
    library: 'momentum',
    libraryLabel: 'Momentum',
    tag: 'mdc-progressbar',
    renderHtml: (id) => `<mdc-progressbar id="${id}" value="60"></mdc-progressbar>`,
  },

  // 11. Spinner
  { concept: 'spinner', conceptLabel: 'Spinner', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-loading', renderHtml: (id) => `<cds-loading id="${id}"></cds-loading>` },
  {
    concept: 'spinner',
    conceptLabel: 'Spinner',
    library: 'spectrum',
    libraryLabel: 'Spectrum',
    tag: 'sp-progress-circle',
    renderHtml: (id) => `<sp-progress-circle id="${id}" indeterminate></sp-progress-circle>`,
  },
  { concept: 'spinner', conceptLabel: 'Spinner', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-spinner', renderHtml: (id) => `<wa-spinner id="${id}"></wa-spinner>` },
  {
    concept: 'spinner',
    conceptLabel: 'Spinner',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-circular-progress',
    renderHtml: (id) => `<md-circular-progress id="${id}" indeterminate></md-circular-progress>`,
  },
  { concept: 'spinner', conceptLabel: 'Spinner', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-spinner', renderHtml: (id) => `<mdc-spinner id="${id}"></mdc-spinner>` },

  // 12. Slider
  { concept: 'slider', conceptLabel: 'Slider', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-slider', renderHtml: (id) => `<cds-slider id="${id}" value="40"></cds-slider>` },
  { concept: 'slider', conceptLabel: 'Slider', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-slider', renderHtml: (id) => `<sp-slider id="${id}" value="40"></sp-slider>` },
  { concept: 'slider', conceptLabel: 'Slider', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-slider', renderHtml: (id) => `<wa-slider id="${id}" value="40"></wa-slider>` },
  { concept: 'slider', conceptLabel: 'Slider', library: 'material', libraryLabel: 'Material Web', tag: 'md-slider', renderHtml: (id) => `<md-slider id="${id}" value="40"></md-slider>` },
  { concept: 'slider', conceptLabel: 'Slider', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-slider', renderHtml: (id) => `<mdc-slider id="${id}" value="40"></mdc-slider>` },

  // 13. Menu
  { concept: 'menu', conceptLabel: 'Menu', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-overflow-menu', renderHtml: (id) => `<cds-overflow-menu id="${id}"></cds-overflow-menu>` },
  { concept: 'menu', conceptLabel: 'Menu', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-menu', renderHtml: (id) => `<sp-menu id="${id}"></sp-menu>` },
  {
    concept: 'menu',
    conceptLabel: 'Menu',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-dropdown',
    renderHtml: (id) => `<wa-dropdown id="${id}"><wa-button slot="trigger">Menu</wa-button></wa-dropdown>`,
  },
  { concept: 'menu', conceptLabel: 'Menu', library: 'material', libraryLabel: 'Material Web', tag: 'md-menu', renderHtml: (id) => `<md-menu id="${id}"></md-menu>` },
  { concept: 'menu', conceptLabel: 'Menu', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-popover', renderHtml: (id) => `<mdc-popover id="${id}"></mdc-popover>` },

  // 14. Divider
  { concept: 'divider', conceptLabel: 'Divider', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-skeleton-text', renderHtml: (id) => `<cds-skeleton-text id="${id}"></cds-skeleton-text>` },
  { concept: 'divider', conceptLabel: 'Divider', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-divider', renderHtml: (id) => `<sp-divider id="${id}"></sp-divider>` },
  { concept: 'divider', conceptLabel: 'Divider', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-divider', renderHtml: (id) => `<wa-divider id="${id}"></wa-divider>` },
  { concept: 'divider', conceptLabel: 'Divider', library: 'material', libraryLabel: 'Material Web', tag: 'md-divider', renderHtml: (id) => `<md-divider id="${id}"></md-divider>` },
  { concept: 'divider', conceptLabel: 'Divider', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-divider', renderHtml: (id) => `<mdc-divider id="${id}"></mdc-divider>` },

  // 15. Icon
  { concept: 'icon', conceptLabel: 'Icon', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-icon', renderHtml: (id) => `<cds-icon id="${id}"></cds-icon>` },
  { concept: 'icon', conceptLabel: 'Icon', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-icon', renderHtml: (id) => `<sp-icon id="${id}"></sp-icon>` },
  { concept: 'icon', conceptLabel: 'Icon', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-icon', renderHtml: (id) => `<wa-icon id="${id}"></wa-icon>` },
  { concept: 'icon', conceptLabel: 'Icon', library: 'material', libraryLabel: 'Material Web', tag: 'md-icon', renderHtml: (id) => `<md-icon id="${id}">info</md-icon>` },
  { concept: 'icon', conceptLabel: 'Icon', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-icon', renderHtml: (id) => `<mdc-icon id="${id}" name="info"></mdc-icon>` },

  // 16. Icon button
  { concept: 'icon-button', conceptLabel: 'Icon button', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-icon-button', renderHtml: (id) => `<cds-icon-button id="${id}"></cds-icon-button>` },
  {
    concept: 'icon-button',
    conceptLabel: 'Icon button',
    library: 'spectrum',
    libraryLabel: 'Spectrum',
    tag: 'sp-action-button',
    renderHtml: (id) => `<sp-action-button id="${id}">Action</sp-action-button>`,
  },
  {
    concept: 'icon-button',
    conceptLabel: 'Icon button',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-copy-button',
    renderHtml: (id) => `<wa-copy-button id="${id}" value="test"></wa-copy-button>`,
  },
  {
    concept: 'icon-button',
    conceptLabel: 'Icon button',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-icon-button',
    renderHtml: (id) =>
      `<md-icon-button id="${id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></md-icon-button>`,
  },
  {
    concept: 'icon-button',
    conceptLabel: 'Icon button',
    library: 'momentum',
    libraryLabel: 'Momentum',
    tag: 'mdc-avatarbutton',
    renderHtml: (id) => `<mdc-avatarbutton id="${id}"></mdc-avatarbutton>`,
  },

  // 17. Card
  { concept: 'card', conceptLabel: 'Card', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-tile', renderHtml: (id) => `<cds-tile id="${id}">Card content</cds-tile>` },
  { concept: 'card', conceptLabel: 'Card', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-card', renderHtml: (id) => `<sp-card id="${id}" heading="Card">Body</sp-card>` },
  { concept: 'card', conceptLabel: 'Card', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-card', renderHtml: (id) => `<wa-card id="${id}">Card content</wa-card>` },
  {
    concept: 'card',
    conceptLabel: 'Card',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-elevation',
    renderHtml: (id) => `<div style="position:relative;padding:1rem;"><md-elevation id="${id}"></md-elevation>Card content</div>`,
  },
  { concept: 'card', conceptLabel: 'Card', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-card', renderHtml: (id) => `<mdc-card id="${id}">Card content</mdc-card>` },

  // 18. Elevation / popover
  { concept: 'elevation', conceptLabel: 'Elevation / popover', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-popover', renderHtml: (id) => `<cds-popover id="${id}"></cds-popover>` },
  { concept: 'elevation', conceptLabel: 'Elevation / popover', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-popover', renderHtml: (id) => `<sp-popover id="${id}"></sp-popover>` },
  { concept: 'elevation', conceptLabel: 'Elevation / popover', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-popover', renderHtml: (id) => `<wa-popover id="${id}"></wa-popover>` },
  {
    concept: 'elevation',
    conceptLabel: 'Elevation / popover',
    library: 'material',
    libraryLabel: 'Material Web',
    tag: 'md-focus-ring',
    renderHtml: (id) => `<md-focus-ring id="${id}"></md-focus-ring>`,
  },
  { concept: 'elevation', conceptLabel: 'Elevation / popover', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-presence', renderHtml: (id) => `<mdc-presence id="${id}"></mdc-presence>` },

  // 19. List
  { concept: 'list', conceptLabel: 'List', library: 'carbon', libraryLabel: 'Carbon', tag: 'cds-structured-list', renderHtml: (id) => `<cds-structured-list id="${id}"></cds-structured-list>` },
  { concept: 'list', conceptLabel: 'List', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-sidenav', renderHtml: (id) => `<sp-sidenav id="${id}"></sp-sidenav>` },
  {
    concept: 'list',
    conceptLabel: 'List',
    library: 'webawesome',
    libraryLabel: 'Web Awesome',
    tag: 'wa-details',
    renderHtml: (id) => `<wa-details id="${id}" summary="List item">Details</wa-details>`,
  },
  { concept: 'list', conceptLabel: 'List', library: 'material', libraryLabel: 'Material Web', tag: 'md-list', renderHtml: (id) => `<md-list id="${id}"></md-list>` },
  { concept: 'list', conceptLabel: 'List', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-list', renderHtml: (id) => `<mdc-list id="${id}"></mdc-list>` },

  // 20. Chips
  {
    concept: 'chips',
    conceptLabel: 'Chips / tags',
    library: 'carbon',
    libraryLabel: 'Carbon',
    tag: 'cds-content-switcher',
    renderHtml: (id) => `<cds-content-switcher id="${id}"></cds-content-switcher>`,
  },
  { concept: 'chips', conceptLabel: 'Chips / tags', library: 'spectrum', libraryLabel: 'Spectrum', tag: 'sp-action-group', renderHtml: (id) => `<sp-action-group id="${id}"></sp-action-group>` },
  { concept: 'chips', conceptLabel: 'Chips / tags', library: 'webawesome', libraryLabel: 'Web Awesome', tag: 'wa-breadcrumb', renderHtml: (id) => `<wa-breadcrumb id="${id}"></wa-breadcrumb>` },
  { concept: 'chips', conceptLabel: 'Chips / tags', library: 'material', libraryLabel: 'Material Web', tag: 'md-chip-set', renderHtml: (id) => `<md-chip-set id="${id}"></md-chip-set>` },
  { concept: 'chips', conceptLabel: 'Chips / tags', library: 'momentum', libraryLabel: 'Momentum', tag: 'mdc-chip', renderHtml: (id) => `<mdc-chip id="${id}" label="Tag"></mdc-chip>` },
];
