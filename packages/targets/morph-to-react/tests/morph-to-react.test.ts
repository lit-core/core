import { describe, expect, it } from 'vitest';
import { MorphHost } from '../runtime/morph-host.js';
import { analyzeLitModule, compileModule } from '../src/index.js';

describe('packages/morph-to-react package unit tests', () => {
  it('analyzes standard lit component and extracts component manifest', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { property, customElement } from 'lit/decorators.js';

      @customElement('my-button')
      export class MyButton extends LitElement {
        @property({ type: Boolean, reflect: true })
        disabled = false;

        @property({ type: String })
        label = 'Click me';

        private handleClick() {
          this.dispatchEvent(new CustomEvent('my-click', { bubbles: true, composed: true }));
        }

        render() {
          return html\`<button ?disabled="\${this.disabled}"><slot>\${this.label}</slot></button>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'my-button.ts' });
    expect(result.components).toHaveLength(1);

    const [comp] = result.components;
    expect(comp.tagName).toBe('my-button');
    expect(comp.className).toBe('MyButton');
    expect(comp.tier).toBe('Tier1Hosted');

    const disabledProp = comp.properties.find((p) => p.name === 'disabled');
    expect(disabledProp).toBeDefined();
    expect(disabledProp?.reflect).toBe(true);

    const labelProp = comp.properties.find((p) => p.name === 'label');
    expect(labelProp).toBeDefined();
    expect(labelProp?.defaultValue).toBe('"Click me"');

    const clickEvent = comp.events.find((e) => e.name === 'my-click');
    expect(clickEvent).toBeDefined();
    expect(clickEvent?.propName).toBe('onMyClick');

    const defaultSlot = comp.slots.find((s) => !s.name);
    expect(defaultSlot).toBeDefined();
    expect(defaultSlot?.hasFallback).toBe(true);
  });

  it('classifies pure stateless leaf component as tier 0', () => {
    const code = `
      import { LitElement, html } from 'lit';
      export class PureIcon extends LitElement {
        render() {
          return html\`<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"></path></svg>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'pure-icon.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Tier0Pure');
    expect(result.diagnostics.some((d) => d.code === 'LIT202')).toBe(true);
  });

  it('classifies composite components with slot inspection as tier 2', () => {
    const code = `
      import { LitElement, html } from 'lit';
      export class CompositeTabs extends LitElement {
        private handleSlotChange(e: Event) {
          const slot = e.target as HTMLSlotElement;
          console.log(slot.assignedElements());
        }

        render() {
          return html\`<div class="tabs"><slot @slotchange="\${this.handleSlotChange}"></slot></div>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'composite-tabs.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Tier2HostedWithFacade');
  });

  it('emits structured diagnostics for bailout directives', () => {
    const code = `
      import { LitElement, html } from 'lit';
      import { asyncAppend } from 'lit/directives/async-append.js';

      export class AsyncComp extends LitElement {
        render() {
          return html\`<div>\${asyncAppend(this.stream)}</div>\`;
        }
      }
    `;

    const result = analyzeLitModule(code, { filename: 'async-comp.ts' });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].tier).toBe('Bailout');

    const diag = result.diagnostics.find((d) => d.code === 'LIT101');
    expect(diag).toBeDefined();
    expect(diag?.universalLitHint).toBeDefined();
  });

  it('instantiates morph host base class and verifies reactive controller host contract', () => {
    const host = new MorphHost();
    let connected = false;
    let disconnected = false;

    const controller = {
      hostConnected() {
        connected = true;
      },
      hostDisconnected() {
        disconnected = true;
      },
    };

    host.addController(controller);
    host.connectedCallback();
    expect(connected).toBe(true);

    host.disconnectedCallback();
    expect(disconnected).toBe(true);

    host.removeController(controller);
  });

  it('compiles tier 0 leaf component to pure functional React component', () => {
    const code = `
      import { LitElement, html } from 'lit';
      export class LeafBadge extends LitElement {
        render() {
          return html\`<div class="badge-wrapper"><span class="badge">Active</span></div>\`;
        }
      }
    `;

    const res = compileModule(code, { filePath: 'leaf-badge.ts' });
    expect(res.tier).toBe('Tier0Pure');
    expect(res.componentName).toBe('LeafBadge');
    expect(res.tagName).toBe('leaf-badge');
    expect(res.code).toContain('export function LeafBadge(');
    expect(res.code).toContain('className="badge-wrapper"');
    expect(res.code).toContain('className="badge"');
    expect(res.code).toContain('Active');
  });

  it('compiles component with scoped CSS and handles emitCss option', () => {
    const code = `
      import { LitElement, html, css } from 'lit';
      export class ScopedBadge extends LitElement {
        static styles = css\`
          :host { display: inline-flex; }
          .badge-text { font-size: 1rem; color: #161616; }
        \`;
        render() { return html\`<span class="badge-text">Tag</span>\`; }
      }
    `;

    // 1. External CSS mode
    const resExternal = compileModule(code, { emitCss: true, filePath: 'badge.ts' });
    expect(resExternal.css).toBeDefined();
    expect(resExternal.css).toContain('@scope(scoped-badge)');
    expect(resExternal.css).toContain('.badge-text');

    // 2. Inlined style tag mode
    const resInlined = compileModule(code, { emitCss: false, filePath: 'badge.ts' });
    expect(resInlined.stylesheetId).toBeDefined();
    expect(resInlined.code).toContain('<style');
    expect(resInlined.code).toContain(`href="${resInlined.stylesheetId}"`);
    expect(resInlined.code).toContain('precedence="default"');
  });
});
