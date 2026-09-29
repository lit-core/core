import React from 'react';
import type { ManifestData } from '../types.js';

interface CanonicalComponentsDrawerProps {
  manifest: ManifestData;
}

const CANONICAL_MAPPING = [
  { concept: 'Button', carbon: 'cds-button', spectrum: 'sp-button', webawesome: 'wa-button', material: 'md-filled-button', momentum: 'mdc-button' },
  { concept: 'Checkbox', carbon: 'cds-checkbox', spectrum: 'sp-checkbox', webawesome: 'wa-checkbox', material: 'md-checkbox', momentum: 'mdc-checkbox' },
  { concept: 'Radio button', carbon: 'cds-radio-button', spectrum: 'sp-radio', webawesome: 'wa-radio', material: 'md-radio', momentum: 'mdc-radio' },
  { concept: 'Switch / toggle', carbon: 'cds-toggle', spectrum: 'sp-switch', webawesome: 'wa-switch', material: 'md-switch', momentum: 'mdc-toggle' },
  { concept: 'Text field / input', carbon: 'cds-text-input', spectrum: 'sp-textfield', webawesome: 'wa-input', material: 'md-filled-text-field', momentum: 'mdc-input' },
  { concept: 'Select / dropdown', carbon: 'cds-select', spectrum: 'sp-picker', webawesome: 'wa-dropdown', material: 'md-filled-select', momentum: 'mdc-select' },
  { concept: 'Dialog / modal', carbon: 'cds-modal', spectrum: 'sp-dialog', webawesome: 'wa-dialog', material: 'md-dialog', momentum: 'mdc-dialog' },
  { concept: 'Badge / tag', carbon: 'cds-tag', spectrum: 'sp-badge', webawesome: 'wa-badge', material: 'md-badge', momentum: 'mdc-badge' },
  { concept: 'Tabs', carbon: 'cds-tabs', spectrum: 'sp-tabs', webawesome: 'wa-tab-group', material: 'md-tabs', momentum: 'mdc-menubar' },
  { concept: 'Progress bar', carbon: 'cds-progress-bar', spectrum: 'sp-progress-bar', webawesome: 'wa-progress-bar', material: 'md-linear-progress', momentum: 'mdc-progressbar' },
  { concept: 'Spinner / loading', carbon: 'cds-loading', spectrum: 'sp-progress-circle', webawesome: 'wa-spinner', material: 'md-circular-progress', momentum: 'mdc-spinner' },
  { concept: 'Slider', carbon: 'cds-slider', spectrum: 'sp-slider', webawesome: 'wa-range', material: 'md-slider', momentum: 'mdc-slider' },
  { concept: 'Menu', carbon: 'cds-overflow-menu', spectrum: 'sp-menu', webawesome: 'wa-dropdown', material: 'md-menu', momentum: 'mdc-menubar' },
  { concept: 'Divider', carbon: 'cds-skeleton-text', spectrum: 'sp-divider', webawesome: 'wa-divider', material: 'md-divider', momentum: 'mdc-divider' },
  { concept: 'Icon', carbon: 'cds-copy-button', spectrum: 'sp-icon', webawesome: 'wa-icon', material: 'md-icon', momentum: 'mdc-icon' },
  { concept: 'Icon button', carbon: 'cds-copy-button', spectrum: 'sp-action-button', webawesome: 'wa-button', material: 'md-icon-button', momentum: 'mdc-avatarbutton' },
  { concept: 'Card / tile', carbon: 'cds-tile', spectrum: 'sp-card', webawesome: 'wa-card', material: 'md-card', momentum: 'mdc-card' },
  { concept: 'Avatar', carbon: 'cds-tag', spectrum: 'sp-avatar', webawesome: 'wa-avatar', material: 'md-badge', momentum: 'mdc-avatar' },
  { concept: 'Accordion', carbon: 'cds-accordion', spectrum: 'sp-accordion', webawesome: 'wa-accordion', material: 'md-list', momentum: 'mdc-accordion' },
  { concept: 'Breadcrumb', carbon: 'cds-breadcrumb', spectrum: 'sp-action-bar', webawesome: 'wa-breadcrumb', material: 'md-chip-set', momentum: 'mdc-link' },
];

export const CanonicalComponentsDrawer: React.FC<CanonicalComponentsDrawerProps> = () => {
  return (
    <div>
      <div className="info-banner">
        <h2 className="info-title">Evaluated components</h2>
        <p className="info-description">Standardized set of 20 UI components evaluated across each design system to ensure parity.</p>
      </div>

      <div className="table-card">
        <div className="table-header-bar">
          <span className="table-title">Cross-library component mapping</span>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>UI concept</th>
                <th>Carbon</th>
                <th>Spectrum</th>
                <th>Web Awesome</th>
                <th>Material Web</th>
                <th>Momentum</th>
              </tr>
            </thead>
            <tbody>
              {CANONICAL_MAPPING.map((item, idx) => (
                <tr key={item.concept}>
                  <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                  <td>
                    <strong>{item.concept}</strong>
                  </td>
                  <td>
                    <code>{item.carbon}</code>
                  </td>
                  <td>
                    <code>{item.spectrum}</code>
                  </td>
                  <td>
                    <code>{item.webawesome}</code>
                  </td>
                  <td>
                    <code>{item.material}</code>
                  </td>
                  <td>
                    <code>{item.momentum}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
