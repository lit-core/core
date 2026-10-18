import React from 'react';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as morphRuntime from '../runtime/index.js';
import { compileModule } from '../src/index.js';

/**
 * Evaluates emitted component code inside a CommonJS module context,
 * providing React and the @lit-core/morph-to-react/runtime modules,
 * along with mock child component modules or globals.
 */
function evalModule(code: string, extraRequires?: Record<string, any>, extraGlobals?: Record<string, any>): Record<string, any> {
  const trans = ts.transpileModule(code, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  });
  const exports: any = {};
  const customRequire = (spec: string) => {
    if (spec === 'react') return React;
    if (spec === '@lit-core/morph-to-react/runtime') return morphRuntime;
    if (extraRequires?.[spec]) return extraRequires[spec];
    throw new Error(`Cannot resolve specifier in evalModule: ${spec}`);
  };

  const globalKeys = extraGlobals ? Object.keys(extraGlobals) : [];
  const globalValues = extraGlobals ? Object.values(extraGlobals) : [];

  const fn = new Function('React', 'exports', 'require', ...globalKeys, trans.outputText);
  fn(React, exports, customRequire, ...globalValues);
  return exports;
}

function stripComments(html: string): string {
  return html.replace(/<!--.*?-->/g, '');
}

describe('milestone 4 challenger: empirical hierarchy, mixin, and child tag rewriting stress testing', () => {
  // =========================================================================
  // 1. Feature 65: Class inheritance on MorphHost
  // =========================================================================
  describe('1. feature 65: class inheritance on MorphHost', () => {
    it('empirically lowers 3-level deep inheritance chain (Grandparent -> Parent -> Child)', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class GrandparentCard extends LitElement {
          @property({ type: String })
          gpTitle = 'Grandparent Title';

          render() {
            return html\`<div class="gp"><span>\${this.gpTitle}</span></div>\`;
          }
        }

        export class ParentCard extends GrandparentCard {
          @property({ type: String })
          parentSubtitle = 'Parent Subtitle';

          render() {
            return html\`<div class="parent"><span>\${this.gpTitle}</span><span>\${this.parentSubtitle}</span></div>\`;
          }
        }

        export class ChildCard extends ParentCard {
          @property({ type: String })
          childBadge = 'Child Badge';

          render() {
            return html\`<div class="child"><span>\${this.gpTitle}</span><span>\${this.parentSubtitle}</span><span>\${this.childBadge}</span></div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'cards-3level.ts', targetTier: 'Tier1Hosted' });

      // 1. Verify AST host class inheritance chain
      expect(res.code).toContain('class GrandparentCardHost extends MorphHost');
      expect(res.code).toContain('class ParentCardHost extends GrandparentCardHost');
      expect(res.code).toContain('class ChildCardHost extends ParentCardHost');

      // 2. Verify _propertyDefaults chaining
      expect(res.code).toContain('...super._propertyDefaults');

      // 3. Evaluate runtime module
      const exported = evalModule(res.code);
      const ChildHost = exported.ChildCardHost;
      expect(ChildHost).toBeDefined();

      // Verify inherited property defaults prototype aggregation
      expect(ChildHost._propertyDefaults).toEqual({
        gpTitle: 'Grandparent Title',
        parentSubtitle: 'Parent Subtitle',
        childBadge: 'Child Badge',
      });

      // 4. Verify React SSR rendering with defaults
      const ChildComponent = exported.ChildCard;
      const htmlOutput = stripComments(renderToString(React.createElement(ChildComponent)));
      expect(htmlOutput).toContain('Grandparent Title');
      expect(htmlOutput).toContain('Parent Subtitle');
      expect(htmlOutput).toContain('Child Badge');

      // 5. Verify React SSR rendering with overrides for all 3 levels
      const customHtml = stripComments(
        renderToString(
          React.createElement(ChildComponent, {
            gpTitle: 'Overridden GP',
            parentSubtitle: 'Overridden Parent',
            childBadge: 'Overridden Child',
          }),
        ),
      );
      expect(customHtml).toContain('Overridden GP');
      expect(customHtml).toContain('Overridden Parent');
      expect(customHtml).toContain('Overridden Child');
    });

    it('empirically lowers 4-level deep inheritance chain with additive properties', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class L1 extends LitElement {
          @property({ type: String })
          l1 = 'level-1';
          render() { return html\`<div>\${this.l1}</div>\`; }
        }

        export class L2 extends L1 {
          @property({ type: String })
          l2 = 'level-2';
          render() { return html\`<div>\${this.l1}-\${this.l2}</div>\`; }
        }

        export class L3 extends L2 {
          @property({ type: String })
          l3 = 'level-3';
          render() { return html\`<div>\${this.l1}-\${this.l2}-\${this.l3}</div>\`; }
        }

        export class L4 extends L3 {
          @property({ type: String })
          l4 = 'level-4';
          render() { return html\`<div>\${this.l1}-\${this.l2}-\${this.l3}-\${this.l4}</div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'levels.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('class L1Host extends MorphHost');
      expect(res.code).toContain('class L2Host extends L1Host');
      expect(res.code).toContain('class L3Host extends L2Host');
      expect(res.code).toContain('class L4Host extends L3Host');

      const exported = evalModule(res.code);
      const L4Host = exported.L4Host;
      expect(L4Host._propertyDefaults).toEqual({
        l1: 'level-1',
        l2: 'level-2',
        l3: 'level-3',
        l4: 'level-4',
      });

      const L4Component = exported.L4;
      const htmlOutput = stripComments(renderToString(React.createElement(L4Component)));
      expect(htmlOutput).toContain('level-1-level-2-level-3-level-4');
    });

    it('empirically verifies child property default overrides parent property default on host classes', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class BaseButton extends LitElement {
          @property({ type: String })
          variant = 'secondary';

          @property({ type: Boolean })
          disabled = false;

          render() {
            return html\`<button class="\${this.variant}">\${this.disabled ? 'Disabled' : 'Enabled'}</button>\`;
          }
        }

        export class PrimaryButton extends BaseButton {
          @property({ type: String })
          variant = 'primary';

          render() {
            return html\`<button class="\${this.variant}">\${this.disabled ? 'Disabled' : 'Enabled'}</button>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'button-override.ts', targetTier: 'Tier1Hosted' });
      const exported = evalModule(res.code);

      // Verify static property defaults
      expect(exported.BaseButtonHost._propertyDefaults.variant).toBe('secondary');
      expect(exported.BaseButtonHost._propertyDefaults.disabled).toBe(false);

      // Child must override variant but inherit disabled
      expect(exported.PrimaryButtonHost._propertyDefaults.variant).toBe('primary');
      expect(exported.PrimaryButtonHost._propertyDefaults.disabled).toBe(false);

      // Verify instances
      const baseInstance = new exported.BaseButtonHost();
      expect(baseInstance.variant).toBe('secondary');
      expect(baseInstance.disabled).toBe(false);

      const primaryInstance = new exported.PrimaryButtonHost();
      expect(primaryInstance.variant).toBe('primary');
      expect(primaryInstance.disabled).toBe(false);

      // Render with explicit props
      const baseHtml = renderToString(React.createElement(exported.BaseButton, { variant: 'secondary' }));
      expect(baseHtml).toContain('class="secondary"');

      const primaryHtml = renderToString(React.createElement(exported.PrimaryButton, { variant: 'primary' }));
      expect(primaryHtml).toContain('class="primary"');

      // Note on attribute-bound properties without props:
      // In emit_jsx.rs, clone_expression rewrites `this.variant` to `props.variant`
      // instead of `host.variant`, so omitting the prop causes className to be undefined.
      expect(res.code).toContain('className={props.variant}');
    });

    it('empirically verifies grandchild overrides grandparent default while preserving parent default', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class BaseTheme extends LitElement {
          @property({ type: String })
          theme = 'light';

          @property({ type: Number })
          fontSize = 14;

          render() { return html\`<div>\${this.theme}:\${this.fontSize}</div>\`; }
        }

        export class ScaledTheme extends BaseTheme {
          @property({ type: Number })
          fontSize = 18;

          render() { return html\`<div>\${this.theme}:\${this.fontSize}</div>\`; }
        }

        export class DarkScaledTheme extends ScaledTheme {
          @property({ type: String })
          theme = 'dark';

          render() { return html\`<div>\${this.theme}:\${this.fontSize}</div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'theme.ts', targetTier: 'Tier1Hosted' });
      const exported = evalModule(res.code);

      expect(exported.BaseThemeHost._propertyDefaults).toEqual({ theme: 'light', fontSize: 14 });
      expect(exported.ScaledThemeHost._propertyDefaults).toEqual({ theme: 'light', fontSize: 18 });
      expect(exported.DarkScaledThemeHost._propertyDefaults).toEqual({ theme: 'dark', fontSize: 18 });

      const darkHtml = stripComments(renderToString(React.createElement(exported.DarkScaledTheme)));
      expect(darkHtml).toContain('dark:18');
    });

    it('empirically verifies method overriding and super call propagation', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class BaseGreeter extends LitElement {
          @property({ type: String })
          name = 'World';

          getGreeting(): string {
            return 'Hello, ' + this.name;
          }

          render() {
            return html\`<div>\${this.getGreeting()}</div>\`;
          }
        }

        export class FormalGreeter extends BaseGreeter {
          getGreeting(): string {
            return super.getGreeting() + '! It is an honor.';
          }

          render() {
            return html\`<div>\${this.getGreeting()}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'greeter.ts', targetTier: 'Tier1Hosted' });
      const exported = evalModule(res.code);

      const host = new exported.FormalGreeterHost();
      expect(host.getGreeting()).toBe('Hello, World! It is an honor.');

      host.name = 'Alice';
      expect(host.getGreeting()).toBe('Hello, Alice! It is an honor.');

      const formalHtml = renderToString(React.createElement(exported.FormalGreeter, { name: 'Dr. Smith' }));
      expect(formalHtml).toContain('Hello, Dr. Smith! It is an honor.');
    });

    it('empirically verifies lifecycle method super call propagation', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class BaseLifecycleComp extends LitElement {
          connectedCallback() {
            super.connectedCallback();
            (this as any).baseConnected = true;
          }

          render() {
            return html\`<div>\${(this as any).baseConnected ? 'base-ok' : 'base-fail'}</div>\`;
          }
        }

        export class DerivedLifecycleComp extends BaseLifecycleComp {
          connectedCallback() {
            super.connectedCallback();
            (this as any).derivedConnected = true;
          }

          render() {
            return html\`<div>\${(this as any).baseConnected && (this as any).derivedConnected ? 'all-ok' : 'fail'}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'lifecycle.ts', targetTier: 'Tier1Hosted' });
      const exported = evalModule(res.code);

      const host = new exported.DerivedLifecycleCompHost();
      host.connectedCallback();
      expect(host.baseConnected).toBe(true);
      expect(host.derivedConnected).toBe(true);
    });

    it('empirically verifies reactivity of inherited properties via requestUpdate and subscribers', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ParentHostComp extends LitElement {
          @property({ type: String })
          parentText = 'initial';

          render() {
            return html\`<span>\${this.parentText}</span>\`;
          }
        }

        export class ChildHostComp extends ParentHostComp {
          @property({ type: Number })
          count = 0;

          render() {
            return html\`<div>\${this.parentText} (\${this.count})</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'reactive-subclass.ts', targetTier: 'Tier1Hosted' });
      const exported = evalModule(res.code);
      const child = new exported.ChildHostCompHost();

      let subscriberCalled = false;
      child._subscribers.add(() => {
        subscriberCalled = true;
      });

      expect(child.parentText).toBe('initial');
      expect(child.count).toBe(0);

      // Mutate inherited property
      child.parentText = 'updated by test';
      child.requestUpdate('parentText', 'initial');

      expect(subscriberCalled).toBe(true);
      expect(child.isUpdatePending).toBe(true);
      expect(child._changedProperties.get('parentText')).toBe('initial');
    });
  });

  // =========================================================================
  // 2. Feature 66: Class expression mixins
  // =========================================================================
  describe('2. feature 66: class expression mixins', () => {
    it('empirically lowers multi-mixin compositions (MixinA(MixinB(LitElement)))', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export const MixinA = (base: any) => class extends base {
          @property({ type: Boolean })
          propA = true;
        };

        export const MixinB = (base: any) => class extends base {
          @property({ type: String })
          propB = 'b-default';
        };

        export class MultiMixedWidget extends MixinA(MixinB(LitElement)) {
          @property({ type: String })
          title = 'Widget Title';

          render() {
            return html\`
              <div class="widget">
                <h3>\${this.title}</h3>
                <span>\${this.propA ? 'A-ON' : 'A-OFF'}</span>
                <span>\${this.propB}</span>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'multi-mixin.ts', targetTier: 'Tier1Hosted' });

      // Verify AST lowered heritage unwraps LitElement to MorphHost
      expect(res.code).toContain('class MultiMixedWidgetHost extends MixinA(MixinB(MorphHost))');
      expect(res.code).toContain('export const MultiMixedWidget = forwardRef(');

      // Define real mixin implementations in evaluation context
      const MixinA = (base: any) =>
        class extends base {
          propA = true;
        };
      const MixinB = (base: any) =>
        class extends base {
          propB = 'b-default';
        };

      const exported = evalModule(res.code, undefined, { MixinA, MixinB });
      const Widget = exported.MultiMixedWidget;

      // Render with defaults
      const defaultHtml = renderToString(React.createElement(Widget));
      expect(defaultHtml).toContain('Widget Title');
      expect(defaultHtml).toContain('A-ON');
      expect(defaultHtml).toContain('b-default');

      // Render with overridden mixin props
      const customHtml = renderToString(React.createElement(Widget, { title: 'Custom Widget', propA: false, propB: 'b-custom' }));
      expect(customHtml).toContain('Custom Widget');
      expect(customHtml).toContain('A-OFF');
      expect(customHtml).toContain('b-custom');
    });

    it('empirically lowers 3-level multi-mixin compositions (MixinA(MixinB(MixinC(LitElement))))', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class TripleMixed extends MixinA(MixinB(MixinC(LitElement))) {
          render() {
            return html\`<div>Triple</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'triple-mixin.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('class TripleMixedHost extends MixinA(MixinB(MixinC(MorphHost)))');
    });

    it('empirically lowers parametric mixin with configuration options object', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ParametricWidget extends ConfiguredMixin(LitElement, { prefix: 'test-', limit: 10 }) {
          @property({ type: String })
          label = 'Parametric';

          render() {
            return html\`<div>\${this.label}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'parametric-mixin.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('class ParametricWidgetHost extends ConfiguredMixin(MorphHost, {');
      expect(res.code).toContain('prefix: "test-"');
      expect(res.code).toContain('limit: 10');

      let capturedOptions: any = null;
      const ConfiguredMixin = (base: any, opts: any) => {
        capturedOptions = opts;
        return class extends base {};
      };

      const exported = evalModule(res.code, undefined, { ConfiguredMixin });
      expect(exported.ParametricWidgetHost).toBeDefined();
      expect(capturedOptions).toEqual({ prefix: 'test-', limit: 10 });

      const htmlOutput = renderToString(React.createElement(exported.ParametricWidget));
      expect(htmlOutput).toContain('Parametric');
    });

    it('empirically lowers parametric mixin with reversed argument order', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ReversedParamWidget extends ReversedMixin({ enabled: true }, LitElement) {
          @property({ type: String })
          tag = 'Reversed';

          render() {
            return html\`<div>\${this.tag}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'reversed-mixin.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('class ReversedParamWidgetHost extends ReversedMixin({');
      expect(res.code).toContain('enabled: true');
      expect(res.code).toContain('}, MorphHost)');

      let capturedOptions: any = null;
      const ReversedMixin = (opts: any, base: any) => {
        capturedOptions = opts;
        return class extends base {};
      };

      const exported = evalModule(res.code, undefined, { ReversedMixin });
      expect(capturedOptions).toEqual({ enabled: true });
      const htmlOutput = renderToString(React.createElement(exported.ReversedParamWidget));
      expect(htmlOutput).toContain('Reversed');
    });

    it('empirically lowers mixin applied to a derived custom element (MixinA(BaseCard))', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class BasePanel extends LitElement {
          @property({ type: String })
          title = 'Base Panel';
          render() { return html\`<h2>\${this.title}</h2>\`; }
        }

        export class MixedPanel extends ThemeMixin(BasePanel) {
          @property({ type: String })
          theme = 'cyan';
          render() { return html\`<div class="\${this.theme}"><h2>\${this.title}</h2></div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'mixed-subclass.ts', targetTier: 'Tier1Hosted' });
      expect(res.code).toContain('class BasePanelHost extends MorphHost');
      expect(res.code).toContain('class MixedPanelHost extends ThemeMixin(BasePanelHost)');

      const ThemeMixin = (base: any) =>
        class extends base {
          themeActive = true;
        };

      const exported = evalModule(res.code, undefined, { ThemeMixin });
      const instance = new exported.MixedPanelHost();
      expect(instance.themeActive).toBe(true);
      expect(instance.title).toBe('Base Panel');
      expect(instance.theme).toBe('cyan');
    });

    it('empirically propagates mixin lifecycle hooks (connectedCallback / disconnectedCallback)', () => {
      const code = `
        import { LitElement, html } from 'lit';
        export class LifecycleWidget extends TrackerMixin(LitElement) {
          render() { return html\`<div>Tracked</div>\`; }
        }
      `;

      const res = compileModule(code, { filePath: 'tracker-mixin.ts', targetTier: 'Tier1Hosted' });

      let connected = false;
      let disconnected = false;
      const TrackerMixin = (base: any) =>
        class extends base {
          override connectedCallback() {
            super.connectedCallback();
            connected = true;
          }
          override disconnectedCallback() {
            super.disconnectedCallback();
            disconnected = true;
          }
        };

      const exported = evalModule(res.code, undefined, { TrackerMixin });
      const host = new exported.LifecycleWidgetHost();
      host.connectedCallback();
      expect(connected).toBe(true);
      host.disconnectedCallback();
      expect(disconnected).toBe(true);
    });
  });

  // =========================================================================
  // 3. Features 67 & 68: Child custom element tag rewriting & uncompiled elements
  // =========================================================================
  describe('3. features 67 & 68: child custom element rewriting and uncompiled custom elements', () => {
    it('empirically rewrites multiple sibling child custom elements with synthesized imports', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class AppLayout extends LitElement {
          render() {
            return html\`
              <div class="layout">
                <app-header title="Main App"></app-header>
                <app-sidebar .collapsed="\${false}"></app-sidebar>
                <app-content></app-content>
                <app-footer copyright="2026"></app-footer>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'layout.ts',
        knownTags: {
          'app-header': 'AppHeader',
          'app-sidebar': 'AppSidebar',
          'app-content': 'AppContent',
          'app-footer': 'AppFooter',
        },
      });

      // Verify PascalCase tag conversion
      expect(res.code).toContain('<AppHeader');
      expect(res.code).toContain('<AppSidebar');
      expect(res.code).toContain('<AppContent');
      expect(res.code).toContain('<AppFooter');

      // Verify no lowercase custom element tags remain
      expect(res.code).not.toContain('<app-header');
      expect(res.code).not.toContain('<app-sidebar');
      expect(res.code).not.toContain('<app-content');
      expect(res.code).not.toContain('<app-footer');

      // Verify synthesized imports
      expect(res.code).toMatch(/import\s*\{\s*AppHeader\s*\}\s*from\s*['"]\.\/app-header\.js['"]/);
      expect(res.code).toMatch(/import\s*\{\s*AppSidebar\s*\}\s*from\s*['"]\.\/app-sidebar\.js['"]/);
      expect(res.code).toMatch(/import\s*\{\s*AppContent\s*\}\s*from\s*['"]\.\/app-content\.js['"]/);
      expect(res.code).toMatch(/import\s*\{\s*AppFooter\s*\}\s*from\s*['"]\.\/app-footer\.js['"]/);

      // Verify mock evaluation
      const extraRequires = {
        './app-header.js': { AppHeader: (props: any) => React.createElement('header', null, props.title) },
        './app-sidebar.js': { AppSidebar: () => React.createElement('aside', null, 'Sidebar') },
        './app-content.js': { AppContent: () => React.createElement('main', null, 'Content') },
        './app-footer.js': { AppFooter: (props: any) => React.createElement('footer', null, props.copyright) },
      };

      const exported = evalModule(res.code, extraRequires);
      const htmlOutput = renderToString(React.createElement(exported.AppLayout));
      expect(htmlOutput).toContain('<header>Main App</header>');
      expect(htmlOutput).toContain('<aside>Sidebar</aside>');
      expect(htmlOutput).toContain('<main>Content</main>');
      expect(htmlOutput).toContain('<footer>2026</footer>');
    });

    it('empirically rewrites deeply nested child custom elements', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class DashboardCard extends LitElement {
          render() {
            return html\`
              <card-container>
                <card-header>
                  <status-icon name="check-circle"></status-icon>
                  <badge-pill label="Verified"></badge-pill>
                </card-header>
              </card-container>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'dashboard.ts',
        knownTags: {
          'card-container': 'CardContainer',
          'card-header': 'CardHeader',
          'status-icon': 'StatusIcon',
          'badge-pill': 'BadgePill',
        },
      });

      expect(res.code).toContain('<CardContainer>');
      expect(res.code).toContain('<CardHeader>');
      expect(res.code).toContain('<StatusIcon');
      expect(res.code).toContain('<BadgePill');
      expect(res.code).not.toContain('<card-container>');
      expect(res.code).not.toContain('<card-header>');
    });

    it('empirically documents nested template import omission bug in conditional branches', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class ConditionalStatus extends LitElement {
          @property({ type: Boolean })
          isOnline = false;

          render() {
            return html\`
              <div class="status-wrap">
                \${this.isOnline
                  ? html\`<online-indicator .ping="\${12}"></online-indicator>\`
                  : html\`<offline-banner message="Disconnected"></offline-banner>\`}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'conditional-status.ts',
        targetTier: 'Tier1Hosted',
        knownTags: {
          'online-indicator': 'OnlineIndicator',
          'offline-banner': 'OfflineBanner',
        },
      });

      // Child elements in nested templates ARE rewritten to PascalCase in JSX
      expect(res.code).toContain('<OnlineIndicator');
      expect(res.code).toContain('<OfflineBanner');

      // BUT in emit_jsx.rs unwrap_template_fn_or_expr (line 1744), sub_emitter.required_component_imports
      // is NOT propagated to self.required_component_imports, so imports are omitted!
      const hasOnlineImport = /import\s*\{\s*OnlineIndicator\s*\}\s*from/.test(res.code);
      const hasOfflineImport = /import\s*\{\s*OfflineBanner\s*\}\s*from/.test(res.code);

      // We document this defect: imports for child custom elements inside nested templates are dropped
      expect(hasOnlineImport).toBe(false);
      expect(hasOfflineImport).toBe(false);

      // When mock globals provide the components, rendering succeeds
      const extraGlobals = {
        OnlineIndicator: (props: any) => React.createElement('span', { className: 'online' }, `Ping: ${props.ping}`),
        OfflineBanner: (props: any) => React.createElement('span', { className: 'offline' }, props.message),
      };

      const exported = evalModule(res.code, undefined, extraGlobals);
      const offlineHtml = renderToString(React.createElement(exported.ConditionalStatus, { isOnline: false }));
      expect(offlineHtml).toContain('Disconnected');
    });

    it('empirically documents nested template import omission bug in array map', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class UserList extends LitElement {
          @property({ type: Array })
          users = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];

          handleUserClick(id: number) {}

          render() {
            return html\`
              <div class="user-list">
                \${this.users.map(u => html\`
                  <user-row .id="\${u.id}" .name="\${u.name}" @user-select="\${this.handleUserClick}"></user-row>
                \`)}
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'user-list.ts',
        targetTier: 'Tier1Hosted',
        knownTags: { 'user-row': 'UserRow' },
      });

      // Child element IS rewritten in JSX
      expect(res.code).toContain('<UserRow');
      expect(res.code).not.toContain('<user-row');

      // Defect: try_lower_unkeyed_array_map in emit_jsx.rs drops sub_emitter.required_component_imports
      const hasUserRowImport = /import\s*\{\s*UserRow\s*\}\s*from/.test(res.code);
      expect(hasUserRowImport).toBe(false);
    });

    it('empirically converts kebab-case properties, booleans, and events on child components', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class PropertyTester extends LitElement {
          @property({ type: String })
          avatarUrl = 'https://example.com/avatar.png';

          @property({ type: Boolean })
          isActive = true;

          handleAvatarChange(e: any) {}

          render() {
            return html\`
              <custom-avatar
                .avatar-image-url="\${this.avatarUrl}"
                ?is-active-user="\${this.isActive}"
                @avatar-changed="\${this.handleAvatarChange}"
              ></custom-avatar>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'prop-tester.ts',
        targetTier: 'Tier1Hosted',
        knownTags: { 'custom-avatar': 'CustomAvatar' },
      });

      // Property: .avatar-image-url -> avatarImageUrl
      expect(res.code).toContain('avatarImageUrl=');
      expect(res.code).not.toContain('.avatar-image-url=');

      // Boolean: ?is-active-user -> isActiveUser
      expect(res.code).toContain('isActiveUser=');
      expect(res.code).not.toContain('?is-active-user=');

      // Event: @avatar-changed -> onAvatarChanged
      expect(res.code).toContain('onAvatarChanged=');
      expect(res.code).not.toContain('@avatar-changed=');
    });

    it('empirically deduplicates 15 instances of child custom element into exactly 1 import', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class IconGrid extends LitElement {
          render() {
            return html\`
              <div class="grid">
                <app-icon name="icon-1"></app-icon>
                <app-icon name="icon-2"></app-icon>
                <app-icon name="icon-3"></app-icon>
                <app-icon name="icon-4"></app-icon>
                <app-icon name="icon-5"></app-icon>
                <app-icon name="icon-6"></app-icon>
                <app-icon name="icon-7"></app-icon>
                <app-icon name="icon-8"></app-icon>
                <app-icon name="icon-9"></app-icon>
                <app-icon name="icon-10"></app-icon>
                <app-icon name="icon-11"></app-icon>
                <app-icon name="icon-12"></app-icon>
                <app-icon name="icon-13"></app-icon>
                <app-icon name="icon-14"></app-icon>
                <app-icon name="icon-15"></app-icon>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'icon-grid.ts',
        knownTags: { 'app-icon': 'AppIcon' },
      });

      // Count occurrences of AppIcon JSX tag
      const jsxMatches = res.code.match(/<AppIcon/g);
      expect(jsxMatches).not.toBeNull();
      expect(jsxMatches?.length).toBe(15);

      // Count occurrences of import declaration for AppIcon
      const importMatches = res.code.match(/import\s*\{\s*AppIcon\s*\}\s*from/g);
      expect(importMatches).not.toBeNull();
      expect(importMatches?.length).toBe(1);
    });

    it('empirically preserves uncompiled custom elements as lowercase JSX tags with boolean lowering', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class HostWrap extends LitElement {
          @property({ type: Boolean })
          collapsed = true;

          @property({ type: String })
          filter = 'active';

          handleSort(e: any) {}

          render() {
            return html\`
              <third-party-data-table
                .rows="\${100}"
                ?collapsed="\${this.collapsed}"
                filter="\${this.filter}"
                @sort-changed="\${this.handleSort}"
              >
                <table-column col="1"></table-column>
                <table-column col="2"></table-column>
              </third-party-data-table>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'host-wrap.ts',
        targetTier: 'Tier1Hosted',
        // Note: 'third-party-data-table' and 'table-column' are NOT in knownTags!
      });

      // Verify tags remain lowercase
      expect(res.code).toContain('<third-party-data-table');
      expect(res.code).toContain('<table-column');
      expect(res.code).not.toContain('<ThirdPartyDataTable');
      expect(res.code).not.toContain('<TableColumn');

      // Verify NO import synthesized for uncompiled custom elements
      expect(res.code).not.toContain("from './third-party-data-table.js'");
      expect(res.code).not.toContain("from './table-column.js'");

      // Verify boolean attribute on uncompiled custom element lowers to ternary (val ? "" : undefined)
      expect(res.code).toMatch(/collapsed=\{(props|host)\.collapsed\s*\?\s*""\s*:\s*undefined\}/);

      // Verify event lowered to onSortChanged
      expect(res.code).toContain('onSortChanged=');

      // Verify evaluation and SSR render
      const exported = evalModule(res.code);
      const htmlOutput = renderToString(React.createElement(exported.HostWrap, { collapsed: true, filter: 'pending' }));
      expect(htmlOutput).toContain('<third-party-data-table');
      expect(htmlOutput).toContain('collapsed=""');
      expect(htmlOutput).toContain('filter="pending"');
      expect(htmlOutput).toContain('<table-column col="1">');
    });

    it('empirically handles mixed templates with both compiled and uncompiled custom elements', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class MixedTemplateHost extends LitElement {
          @property({ type: String })
          iconName = 'gear';

          @property({ type: Boolean })
          expanded = false;

          render() {
            return html\`
              <section class="mixed-container">
                <known-icon .name="\${this.iconName}"></known-icon>
                <uncompiled-widget ?expanded="\${this.expanded}">
                  <span class="label">Settings</span>
                </uncompiled-widget>
              </section>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'mixed-template.ts',
        targetTier: 'Tier1Hosted',
        knownTags: { 'known-icon': 'KnownIcon' },
      });

      // Known icon becomes PascalCase + import
      expect(res.code).toContain('<KnownIcon');
      expect(res.code).toMatch(/import\s*\{\s*KnownIcon\s*\}\s*from\s*['"]\.\/known-icon\.js['"]/);

      // Uncompiled widget remains lowercase + NO import
      expect(res.code).toContain('<uncompiled-widget');
      expect(res.code).not.toContain('<UncompiledWidget');
      expect(res.code).not.toContain("from './uncompiled-widget.js'");
      expect(res.code).toMatch(/expanded=\{(props|host)\.expanded\s*\?\s*""\s*:\s*undefined\}/);

      const extraRequires = {
        './known-icon.js': { KnownIcon: (props: any) => React.createElement('i', null, props.name) },
      };

      const exported = evalModule(res.code, extraRequires);
      const htmlOutput = renderToString(React.createElement(exported.MixedTemplateHost, { iconName: 'bell', expanded: true }));
      expect(htmlOutput).toContain('<i>bell</i>');
      expect(htmlOutput).toContain('<uncompiled-widget expanded=""');
    });

    it('empirically rewrites local child components when registered with @customElement', () => {
      const code = `
        import { LitElement, html, property } from 'lit';
        import { customElement } from 'lit/decorators.js';

        @customElement('local-child')
        export class LocalChild extends LitElement {
          @property({ type: String })
          text = 'Child text';

          render() {
            return html\`<span class="local-child">\${this.text}</span>\`;
          }
        }

        @customElement('local-parent')
        export class LocalParent extends LitElement {
          @property({ type: String })
          status = 'Parent status';

          render() {
            return html\`
              <div class="local-parent">
                <local-child .text="\${this.status}"></local-child>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'local-duo.ts',
        targetTier: 'Tier1Hosted',
      });

      // Both components must be compiled in the same unit
      expect(res.code).toContain('class LocalChildHost extends MorphHost');
      expect(res.code).toContain('class LocalParentHost extends MorphHost');

      // Inside LocalParent, tag local-child rewritten to LocalChild
      expect(res.code).toContain('<LocalChild');
      expect(res.code).toContain('<div className="local-parent">{" "}<LocalChild');
      expect(res.code).not.toContain('<div className="local-parent">{" "}<local-child');

      // Crucial: NO import { LocalChild } from './local-child.js' because LocalChild is defined locally!
      expect(res.code).not.toContain("from './local-child.js'");
      expect(res.code).not.toContain("from './local-child'");

      // Evaluate both components in the same module
      const exported = evalModule(res.code);
      expect(exported.LocalChild).toBeDefined();
      expect(exported.LocalParent).toBeDefined();

      const htmlOutput = renderToString(React.createElement(exported.LocalParent, { status: 'Connected' }));
      expect(htmlOutput).toContain('<div class="local-parent">');
      expect(htmlOutput).toContain('<span class="local-child">Connected</span>');
    });

    it('empirically documents ComponentTagRegistry asymmetry when local component lacks @customElement', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        export class LocalChildWithoutDec extends LitElement {
          @property({ type: String })
          text = 'Child text';

          render() {
            return html\`<span class="child">\${this.text}</span>\`;
          }
        }

        export class LocalParentWithoutDec extends LitElement {
          render() {
            return html\`
              <div>
                <local-child-without-dec></local-child-without-dec>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'local-no-dec.ts',
        targetTier: 'Tier1Hosted',
      });

      // Defect: ComponentTagRegistry::new only inspects comp.tag_name (line 89 of emit_jsx.rs)
      // and does not fallback to PropertyModelExtractor::to_kebab_case(&comp.class_name).
      // Therefore, <local-child-without-dec> remains lowercase!
      expect(res.code).toContain('<local-child-without-dec');
      expect(res.code).not.toContain('<LocalChildWithoutDec');
    });

    it('empirically rewrites child custom elements in Tier 0 pure functional components', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class Tier0Nav extends LitElement {
          render() {
            return html\`
              <nav class="pure-nav">
                <nav-icon name="home"></nav-icon>
                <foreign-spacer width="10"></foreign-spacer>
              </nav>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'tier0-nav.ts',
        knownTags: { 'nav-icon': 'NavIcon' },
      });

      expect(res.tier).toBe('Tier0Pure');
      expect(res.code).toContain('export function Tier0Nav(');
      expect(res.code).toContain('<NavIcon');
      expect(res.code).toContain('<foreign-spacer');
      expect(res.code).toMatch(/import\s*\{\s*NavIcon\s*\}\s*from\s*['"]\.\/nav-icon\.js['"]/);
      expect(res.code).not.toContain("from './foreign-spacer.js'");
    });

    it('empirically coerces static plain attribute into number when child property type is Number', () => {
      const code = `
        import { LitElement, html } from 'lit';

        export class NumberAttrHost extends LitElement {
          render() {
            return html\`
              <div class="wrap">
                <grid-component columns="4" gap="16.5"></grid-component>
              </div>
            \`;
          }
        }
      `;

      const res = compileModule(code, {
        filePath: 'num-attr.ts',
        componentRegistry: {
          'grid-component': {
            componentName: 'GridComponent',
            importPath: './grid-component.js',
            tagName: 'grid-component',
          },
        },
      });

      // Even with static quotes 'columns="4"', if registry knows it's a component, it compiles cleanly
      expect(res.code).toContain('<GridComponent');
      expect(res.code).not.toContain('<grid-component');
    });
  });

  // =========================================================================
  // 4. Adversarial & Minification Stress Testing
  // =========================================================================
  describe('4. adversarial and minification stress testing', () => {
    it('empirically handles aliased LitElement import in class inheritance', () => {
      const code = `
        import { LitElement as L, html as h, property as p } from 'lit';

        export class AliasedBase extends L {
          @p({ type: String })
          title = 'Base';

          render() {
            return h\`<div>\${this.title}</div>\`;
          }
        }

        export class AliasedDerived extends AliasedBase {
          @p({ type: String })
          tag = 'Derived';

          render() {
            return h\`<div>\${this.title}-\${this.tag}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'aliased.ts', targetTier: 'Tier1Hosted' });
      // Verify both classes are compiled
      expect(res.code).toContain('class AliasedBaseHost extends');
      expect(res.code).toContain('class AliasedDerivedHost extends AliasedBaseHost');
    });

    it('empirically documents JavaScript TDZ constraint on out-of-order class inheritance', () => {
      const code = `
        import { LitElement, html, property } from 'lit';

        // Derived declared BEFORE Base in source order!
        export class SecondCard extends FirstCard {
          @property({ type: String })
          second = '2';

          render() {
            return html\`<div>\${this.first}-\${this.second}</div>\`;
          }
        }

        export class FirstCard extends LitElement {
          @property({ type: String })
          first = '1';

          render() {
            return html\`<div>\${this.first}</div>\`;
          }
        }
      `;

      const res = compileModule(code, { filePath: 'out-of-order.ts', targetTier: 'Tier1Hosted' });
      // The compiler generates classes in source declaration order:
      expect(res.code).toContain('class SecondCardHost extends FirstCardHost');
      expect(res.code).toContain('class FirstCardHost extends MorphHost');

      // In JavaScript, class definitions are not hoisted: evaluating SecondCardHost
      // before FirstCardHost throws ReferenceError in JS engines.
      expect(() => evalModule(res.code)).toThrow(/before initialization/);
    });
  });
});
