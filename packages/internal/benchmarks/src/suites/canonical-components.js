/**
 * Canonical 20 enterprise UI components mapped 1:1 across all five design systems.
 * Guarantees fair, consistent, apples-to-apples bundle benchmarks across libraries.
 */

export const CANONICAL_COMPONENT_IDS = [
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
];

/**
 * Standard descriptions for each canonical component concept.
 * @type {Record<string, { label: string, description: string }>}
 */
export const CANONICAL_COMPONENT_METADATA = {
  button: { label: 'Button', description: 'Primary action trigger' },
  checkbox: { label: 'Checkbox', description: 'Binary or indeterminate selection control' },
  radio: { label: 'Radio button', description: 'Single option selection within a group' },
  switch: { label: 'Switch / toggle', description: 'Instantaneous binary state toggle' },
  'text-input': { label: 'Text input / field', description: 'Single-line text entry field' },
  select: { label: 'Select / dropdown', description: 'Option picker from an expandable menu' },
  dialog: { label: 'Dialog / modal', description: 'Modal dialog overlay for focused interaction' },
  badge: { label: 'Badge / tag', description: 'Compact status, category, or counter indicator' },
  tabs: { label: 'Tabs', description: 'Multi-panel content switcher' },
  'progress-bar': { label: 'Progress bar', description: 'Linear task completion indicator' },
  spinner: { label: 'Spinner / loader', description: 'Circular indeterminate loading indicator' },
  slider: { label: 'Slider', description: 'Continuous or discrete range value picker' },
  menu: { label: 'Menu / popover', description: 'Contextual or overflow action menu' },
  divider: { label: 'Divider', description: 'Structural separator between content blocks' },
  icon: { label: 'Icon', description: 'Visual symbol / graphical indicator' },
  'icon-button': { label: 'Icon button', description: 'Compact icon-only action trigger' },
  card: { label: 'Card / tile', description: 'Container grouping related content and actions' },
  elevation: { label: 'Elevation / focus', description: 'Surface elevation or focus indicator' },
  list: { label: 'List / structured', description: 'Structured collection of list items' },
  chips: { label: 'Chips / segmented', description: 'Compact interactive tags or segmented filters' },
};

/**
 * Exact component definitions and import paths per design system.
 * @type {Record<string, { packageName: string, components: Record<string, { tag: string, path: string, importStatement: string }> }>}
 */
export const CANONICAL_SUITE_DEFINITIONS = {
  carbon: {
    packageName: '@carbon/web-components',
    components: {
      button: { tag: 'cds-button', path: 'es/components/button/index.js', importStatement: "import '@carbon/web-components/es/components/button/index.js';" },
      checkbox: { tag: 'cds-checkbox', path: 'es/components/checkbox/index.js', importStatement: "import '@carbon/web-components/es/components/checkbox/index.js';" },
      radio: { tag: 'cds-radio-button', path: 'es/components/radio-button/index.js', importStatement: "import '@carbon/web-components/es/components/radio-button/index.js';" },
      switch: { tag: 'cds-toggle', path: 'es/components/toggle/index.js', importStatement: "import '@carbon/web-components/es/components/toggle/index.js';" },
      'text-input': { tag: 'cds-text-input', path: 'es/components/text-input/index.js', importStatement: "import '@carbon/web-components/es/components/text-input/index.js';" },
      select: { tag: 'cds-select', path: 'es/components/select/index.js', importStatement: "import '@carbon/web-components/es/components/select/index.js';" },
      dialog: { tag: 'cds-modal', path: 'es/components/modal/index.js', importStatement: "import '@carbon/web-components/es/components/modal/index.js';" },
      badge: { tag: 'cds-tag', path: 'es/components/tag/index.js', importStatement: "import '@carbon/web-components/es/components/tag/index.js';" },
      tabs: { tag: 'cds-tabs', path: 'es/components/tabs/index.js', importStatement: "import '@carbon/web-components/es/components/tabs/index.js';" },
      'progress-bar': { tag: 'cds-progress-bar', path: 'es/components/progress-bar/index.js', importStatement: "import '@carbon/web-components/es/components/progress-bar/index.js';" },
      spinner: { tag: 'cds-loading', path: 'es/components/loading/index.js', importStatement: "import '@carbon/web-components/es/components/loading/index.js';" },
      slider: { tag: 'cds-slider', path: 'es/components/slider/index.js', importStatement: "import '@carbon/web-components/es/components/slider/index.js';" },
      menu: { tag: 'cds-overflow-menu', path: 'es/components/overflow-menu/index.js', importStatement: "import '@carbon/web-components/es/components/overflow-menu/index.js';" },
      divider: { tag: 'cds-skeleton-text', path: 'es/components/skeleton-text/index.js', importStatement: "import '@carbon/web-components/es/components/skeleton-text/index.js';" },
      icon: { tag: 'cds-icon', path: 'es/components/icon/index.js', importStatement: "import '@carbon/web-components/es/components/icon/index.js';" },
      'icon-button': { tag: 'cds-icon-button', path: 'es/components/icon-button/index.js', importStatement: "import '@carbon/web-components/es/components/icon-button/index.js';" },
      card: { tag: 'cds-tile', path: 'es/components/tile/index.js', importStatement: "import '@carbon/web-components/es/components/tile/index.js';" },
      elevation: { tag: 'cds-popover', path: 'es/components/popover/index.js', importStatement: "import '@carbon/web-components/es/components/popover/index.js';" },
      list: { tag: 'cds-structured-list', path: 'es/components/structured-list/index.js', importStatement: "import '@carbon/web-components/es/components/structured-list/index.js';" },
      chips: { tag: 'cds-content-switcher', path: 'es/components/content-switcher/index.js', importStatement: "import '@carbon/web-components/es/components/content-switcher/index.js';" },
    },
  },
  spectrum: {
    packageName: '@spectrum-web-components',
    components: {
      button: { tag: 'sp-button', path: 'button/sp-button.js', importStatement: "import '@spectrum-web-components/button/sp-button.js';" },
      checkbox: { tag: 'sp-checkbox', path: 'checkbox/sp-checkbox.js', importStatement: "import '@spectrum-web-components/checkbox/sp-checkbox.js';" },
      radio: { tag: 'sp-radio', path: 'radio/sp-radio.js', importStatement: "import '@spectrum-web-components/radio/sp-radio.js';" },
      switch: { tag: 'sp-switch', path: 'switch/sp-switch.js', importStatement: "import '@spectrum-web-components/switch/sp-switch.js';" },
      'text-input': { tag: 'sp-textfield', path: 'textfield/sp-textfield.js', importStatement: "import '@spectrum-web-components/textfield/sp-textfield.js';" },
      select: { tag: 'sp-picker', path: 'picker/sp-picker.js', importStatement: "import '@spectrum-web-components/picker/sp-picker.js';" },
      dialog: { tag: 'sp-dialog', path: 'dialog/sp-dialog.js', importStatement: "import '@spectrum-web-components/dialog/sp-dialog.js';" },
      badge: { tag: 'sp-badge', path: 'badge/sp-badge.js', importStatement: "import '@spectrum-web-components/badge/sp-badge.js';" },
      tabs: { tag: 'sp-tabs', path: 'tabs/sp-tabs.js', importStatement: "import '@spectrum-web-components/tabs/sp-tabs.js';" },
      'progress-bar': { tag: 'sp-progress-bar', path: 'progress-bar/sp-progress-bar.js', importStatement: "import '@spectrum-web-components/progress-bar/sp-progress-bar.js';" },
      spinner: { tag: 'sp-progress-circle', path: 'progress-circle/sp-progress-circle.js', importStatement: "import '@spectrum-web-components/progress-circle/sp-progress-circle.js';" },
      slider: { tag: 'sp-slider', path: 'slider/sp-slider.js', importStatement: "import '@spectrum-web-components/slider/sp-slider.js';" },
      menu: { tag: 'sp-menu', path: 'menu/sp-menu.js', importStatement: "import '@spectrum-web-components/menu/sp-menu.js';" },
      divider: { tag: 'sp-divider', path: 'divider/sp-divider.js', importStatement: "import '@spectrum-web-components/divider/sp-divider.js';" },
      icon: { tag: 'sp-icon', path: 'icon/sp-icon.js', importStatement: "import '@spectrum-web-components/icon/sp-icon.js';" },
      'icon-button': { tag: 'sp-action-button', path: 'action-button/sp-action-button.js', importStatement: "import '@spectrum-web-components/action-button/sp-action-button.js';" },
      card: { tag: 'sp-card', path: 'card/sp-card.js', importStatement: "import '@spectrum-web-components/card/sp-card.js';" },
      elevation: { tag: 'sp-popover', path: 'popover/sp-popover.js', importStatement: "import '@spectrum-web-components/popover/sp-popover.js';" },
      list: { tag: 'sp-sidenav', path: 'sidenav/sp-sidenav.js', importStatement: "import '@spectrum-web-components/sidenav/sp-sidenav.js';" },
      chips: { tag: 'sp-action-group', path: 'action-group/sp-action-group.js', importStatement: "import '@spectrum-web-components/action-group/sp-action-group.js';" },
    },
  },
  webawesome: {
    packageName: '@awesome.me/webawesome',
    components: {
      button: { tag: 'wa-button', path: 'dist/components/button/button.js', importStatement: "import '@awesome.me/webawesome/dist/components/button/button.js';" },
      checkbox: { tag: 'wa-checkbox', path: 'dist/components/checkbox/checkbox.js', importStatement: "import '@awesome.me/webawesome/dist/components/checkbox/checkbox.js';" },
      radio: { tag: 'wa-radio', path: 'dist/components/radio/radio.js', importStatement: "import '@awesome.me/webawesome/dist/components/radio/radio.js';" },
      switch: { tag: 'wa-switch', path: 'dist/components/switch/switch.js', importStatement: "import '@awesome.me/webawesome/dist/components/switch/switch.js';" },
      'text-input': { tag: 'wa-input', path: 'dist/components/input/input.js', importStatement: "import '@awesome.me/webawesome/dist/components/input/input.js';" },
      select: { tag: 'wa-select', path: 'dist/components/select/select.js', importStatement: "import '@awesome.me/webawesome/dist/components/select/select.js';" },
      dialog: { tag: 'wa-dialog', path: 'dist/components/dialog/dialog.js', importStatement: "import '@awesome.me/webawesome/dist/components/dialog/dialog.js';" },
      badge: { tag: 'wa-badge', path: 'dist/components/badge/badge.js', importStatement: "import '@awesome.me/webawesome/dist/components/badge/badge.js';" },
      tabs: { tag: 'wa-tab-group', path: 'dist/components/tab-group/tab-group.js', importStatement: "import '@awesome.me/webawesome/dist/components/tab-group/tab-group.js';" },
      'progress-bar': {
        tag: 'wa-progress-bar',
        path: 'dist/components/progress-bar/progress-bar.js',
        importStatement: "import '@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js';",
      },
      spinner: { tag: 'wa-spinner', path: 'dist/components/spinner/spinner.js', importStatement: "import '@awesome.me/webawesome/dist/components/spinner/spinner.js';" },
      slider: { tag: 'wa-slider', path: 'dist/components/slider/slider.js', importStatement: "import '@awesome.me/webawesome/dist/components/slider/slider.js';" },
      menu: { tag: 'wa-dropdown', path: 'dist/components/dropdown/dropdown.js', importStatement: "import '@awesome.me/webawesome/dist/components/dropdown/dropdown.js';" },
      divider: { tag: 'wa-divider', path: 'dist/components/divider/divider.js', importStatement: "import '@awesome.me/webawesome/dist/components/divider/divider.js';" },
      icon: { tag: 'wa-icon', path: 'dist/components/icon/icon.js', importStatement: "import '@awesome.me/webawesome/dist/components/icon/icon.js';" },
      'icon-button': { tag: 'wa-copy-button', path: 'dist/components/copy-button/copy-button.js', importStatement: "import '@awesome.me/webawesome/dist/components/copy-button/copy-button.js';" },
      card: { tag: 'wa-card', path: 'dist/components/card/card.js', importStatement: "import '@awesome.me/webawesome/dist/components/card/card.js';" },
      elevation: { tag: 'wa-popover', path: 'dist/components/popover/popover.js', importStatement: "import '@awesome.me/webawesome/dist/components/popover/popover.js';" },
      list: { tag: 'wa-details', path: 'dist/components/details/details.js', importStatement: "import '@awesome.me/webawesome/dist/components/details/details.js';" },
      chips: { tag: 'wa-breadcrumb', path: 'dist/components/breadcrumb/breadcrumb.js', importStatement: "import '@awesome.me/webawesome/dist/components/breadcrumb/breadcrumb.js';" },
    },
  },
  material: {
    packageName: '@material/web',
    components: {
      button: { tag: 'md-filled-button', path: 'button/filled-button.js', importStatement: "import '@material/web/button/filled-button.js';" },
      checkbox: { tag: 'md-checkbox', path: 'checkbox/checkbox.js', importStatement: "import '@material/web/checkbox/checkbox.js';" },
      radio: { tag: 'md-radio', path: 'radio/radio.js', importStatement: "import '@material/web/radio/radio.js';" },
      switch: { tag: 'md-switch', path: 'switch/switch.js', importStatement: "import '@material/web/switch/switch.js';" },
      'text-input': { tag: 'md-filled-text-field', path: 'textfield/filled-text-field.js', importStatement: "import '@material/web/textfield/filled-text-field.js';" },
      select: { tag: 'md-filled-select', path: 'select/filled-select.js', importStatement: "import '@material/web/select/filled-select.js';" },
      dialog: { tag: 'md-dialog', path: 'dialog/dialog.js', importStatement: "import '@material/web/dialog/dialog.js';" },
      badge: { tag: 'md-badge', path: 'labs/badge/badge.js', importStatement: "import '@material/web/labs/badge/badge.js';" },
      tabs: { tag: 'md-tabs', path: 'tabs/tabs.js', importStatement: "import '@material/web/tabs/tabs.js';" },
      'progress-bar': { tag: 'md-linear-progress', path: 'progress/linear-progress.js', importStatement: "import '@material/web/progress/linear-progress.js';" },
      spinner: { tag: 'md-circular-progress', path: 'progress/circular-progress.js', importStatement: "import '@material/web/progress/circular-progress.js';" },
      slider: { tag: 'md-slider', path: 'slider/slider.js', importStatement: "import '@material/web/slider/slider.js';" },
      menu: { tag: 'md-menu', path: 'menu/menu.js', importStatement: "import '@material/web/menu/menu.js';" },
      divider: { tag: 'md-divider', path: 'divider/divider.js', importStatement: "import '@material/web/divider/divider.js';" },
      icon: { tag: 'md-icon', path: 'icon/icon.js', importStatement: "import '@material/web/icon/icon.js';" },
      'icon-button': { tag: 'md-icon-button', path: 'iconbutton/icon-button.js', importStatement: "import '@material/web/iconbutton/icon-button.js';" },
      card: { tag: 'md-elevation', path: 'elevation/elevation.js', importStatement: "import '@material/web/elevation/elevation.js';" },
      elevation: { tag: 'md-focus-ring', path: 'focus/md-focus-ring.js', importStatement: "import '@material/web/focus/md-focus-ring.js';" },
      list: { tag: 'md-list', path: 'list/list.js', importStatement: "import '@material/web/list/list.js';" },
      chips: { tag: 'md-chip-set', path: 'chips/chip-set.js', importStatement: "import '@material/web/chips/chip-set.js';" },
    },
  },
  momentum: {
    packageName: '@momentum-design/components',
    components: {
      button: { tag: 'mdc-button', path: 'dist/components/button/index.js', importStatement: "import '@momentum-design/components/dist/components/button/index.js';" },
      checkbox: { tag: 'mdc-checkbox', path: 'dist/components/checkbox/index.js', importStatement: "import '@momentum-design/components/dist/components/checkbox/index.js';" },
      radio: { tag: 'mdc-radio', path: 'dist/components/radio/index.js', importStatement: "import '@momentum-design/components/dist/components/radio/index.js';" },
      switch: { tag: 'mdc-toggle', path: 'dist/components/toggle/index.js', importStatement: "import '@momentum-design/components/dist/components/toggle/index.js';" },
      'text-input': { tag: 'mdc-input', path: 'dist/components/input/index.js', importStatement: "import '@momentum-design/components/dist/components/input/index.js';" },
      select: { tag: 'mdc-select', path: 'dist/components/select/index.js', importStatement: "import '@momentum-design/components/dist/components/select/index.js';" },
      dialog: { tag: 'mdc-dialog', path: 'dist/components/dialog/index.js', importStatement: "import '@momentum-design/components/dist/components/dialog/index.js';" },
      badge: { tag: 'mdc-badge', path: 'dist/components/badge/index.js', importStatement: "import '@momentum-design/components/dist/components/badge/index.js';" },
      tabs: { tag: 'mdc-menubar', path: 'dist/components/menubar/index.js', importStatement: "import '@momentum-design/components/dist/components/menubar/index.js';" },
      'progress-bar': { tag: 'mdc-progressbar', path: 'dist/components/progressbar/index.js', importStatement: "import '@momentum-design/components/dist/components/progressbar/index.js';" },
      spinner: { tag: 'mdc-spinner', path: 'dist/components/spinner/index.js', importStatement: "import '@momentum-design/components/dist/components/spinner/index.js';" },
      slider: { tag: 'mdc-slider', path: 'dist/components/slider/index.js', importStatement: "import '@momentum-design/components/dist/components/slider/index.js';" },
      menu: { tag: 'mdc-popover', path: 'dist/components/popover/index.js', importStatement: "import '@momentum-design/components/dist/components/popover/index.js';" },
      divider: { tag: 'mdc-divider', path: 'dist/components/divider/index.js', importStatement: "import '@momentum-design/components/dist/components/divider/index.js';" },
      icon: { tag: 'mdc-icon', path: 'dist/components/icon/index.js', importStatement: "import '@momentum-design/components/dist/components/icon/index.js';" },
      'icon-button': { tag: 'mdc-avatarbutton', path: 'dist/components/avatarbutton/index.js', importStatement: "import '@momentum-design/components/dist/components/avatarbutton/index.js';" },
      card: { tag: 'mdc-card', path: 'dist/components/card/index.js', importStatement: "import '@momentum-design/components/dist/components/card/index.js';" },
      elevation: { tag: 'mdc-presence', path: 'dist/components/presence/index.js', importStatement: "import '@momentum-design/components/dist/components/presence/index.js';" },
      list: { tag: 'mdc-list', path: 'dist/components/list/index.js', importStatement: "import '@momentum-design/components/dist/components/list/index.js';" },
      chips: { tag: 'mdc-chip', path: 'dist/components/chip/index.js', importStatement: "import '@momentum-design/components/dist/components/chip/index.js';" },
    },
  },
};

/**
 * Get canonical component list and imports for a specific suite.
 * @param {string} suiteId
 * @returns {{ entryContent: string, componentCount: number, components: Array<{ concept: string, tag: string, label: string }> }}
 */
export function getCanonicalSuiteConfig(suiteId) {
  const suiteDef = CANONICAL_SUITE_DEFINITIONS[suiteId];
  if (!suiteDef) {
    throw new Error(`Unknown suite ID for canonical components: ${suiteId}`);
  }

  const components = [];
  const importLines = [];

  for (const concept of CANONICAL_COMPONENT_IDS) {
    const comp = suiteDef.components[concept];
    const meta = CANONICAL_COMPONENT_METADATA[concept];
    if (comp) {
      components.push({
        concept,
        tag: comp.tag,
        label: meta ? meta.label : concept,
        path: comp.path,
      });
      importLines.push(comp.importStatement);
    }
  }

  return {
    entryContent: `${importLines.join('\n')}\n`,
    componentCount: components.length,
    components,
  };
}
