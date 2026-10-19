import { describe, expect, it } from 'vitest';
import { scanTags, transformTagShake } from '../src/index.js';

describe('scanTags', () => {
  it('extracts valid custom element tag names from templates', () => {
    const code = `
      import { html } from 'lit';
      const t = html\`
        <cds-button size="sm">Click</cds-button>
        <sp-action-button active></sp-action-button>
        <div>Standard HTML</div>
        <wa-icon-button name="gear"></wa-icon-button>
        </cds-button>
      \`;
    `;
    const tags = scanTags(code);
    expect(tags).toEqual(['cds-button', 'sp-action-button', 'wa-icon-button']);
  });

  it('ignores standard HTML tags without hyphens', () => {
    const code = '<div><span><button>Click</button></span></div>';
    const tags = scanTags(code);
    expect(tags).toEqual([]);
  });

  it('scans JSX and TSX element names', () => {
    const code = `
      export function MyComponent() {
        return (
          <div>
            <cds-button size="md">Click</cds-button>
            <sp-action-button active />
          </div>
        );
      }
    `;
    const tags = scanTags(code, 'component.tsx');
    expect(tags).toEqual(['cds-button', 'sp-action-button']);
  });

  it('does not match tags inside comments or attributes', () => {
    const code = `
      import { html } from 'lit';
      const t = html\`
        <!-- <cds-ignored></cds-ignored> -->
        <div title="<cds-ignored-too>">
          <cds-button></cds-button>
        </div>
      \`;
    `;
    const tags = scanTags(code);
    expect(tags).toEqual(['cds-button']);
  });

  it('does not match JS binary comparisons or math expressions', () => {
    const code = `
      const a = 10;
      const b = 5;
      const c = 2;
      if (a < b - c) {
        console.log('math');
      }
    `;
    const tags = scanTags(code, 'math.js');
    expect(tags).toEqual([]);
  });

  it('detects DOM APIs document.createElement and querySelector', () => {
    const code = `
      const btn = document.createElement('cds-button');
      const dialog = document.querySelector('cds-modal.active');
      customElements.whenDefined('sp-picker');
    `;
    const tags = scanTags(code, 'dom.js');
    expect(tags).toEqual(['cds-button', 'cds-modal', 'sp-picker']);
  });
});

describe('transformTagShake unit tests', () => {
  it('prunes unreferenced customElements.define and unreferenced imports', () => {
    const code = `
      import { CDSAccordion } from './accordion.js';
      import { CDSButton } from './button.js';

      customElements.define('cds-accordion', CDSAccordion);
      customElements.define('cds-button', CDSButton);
    `;

    const res = transformTagShake(code, {
      usedTags: ['cds-button'],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.removedTags).toEqual(['cds-accordion']);
    expect(res.preservedTags).toEqual(['cds-button']);
    expect(res.code).toContain('customElements.define("cds-button", CDSButton);');
    expect(res.code).not.toContain('cds-accordion');
    expect(res.code).not.toContain('CDSAccordion');
    expect(res.code).toContain('import { CDSButton } from "./button.js";');
  });

  it('bails out cleanly when dynamic tag registration is encountered', () => {
    const code = `
      import { CDSButton } from './button.js';
      const prefix = 'cds';
      customElements.define(prefix + '-button', CDSButton);
    `;

    const res = transformTagShake(code, {
      usedTags: ['cds-button'],
    });

    expect(res.shakenRegistrationsCount).toBe(0);
    expect(res.removedTags).toEqual([]);
    expect(res.code).toBe(code);
  });

  it('preserves imports if the class is exported or used elsewhere as a value', () => {
    const code = `
      import { MyCard } from './card.js';

      customElements.define('my-card', MyCard);

      export { MyCard };
    `;

    const res = transformTagShake(code, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.removedTags).toEqual(['my-card']);
    // Registration is removed, but import and export are preserved!
    expect(res.code).not.toContain('customElements.define("my-card"');
    expect(res.code).toContain('import { MyCard } from "./card.js";');
    expect(res.code).toContain('export { MyCard };');
  });

  it('prunes class decorator @customElement when tag is unreferenced', () => {
    const code = `
      import { LitElement } from 'lit';
      import { customElement } from 'lit/decorators.js';

      @customElement('dead-widget')
      export class DeadWidget extends LitElement {}
    `;

    const res = transformTagShake(code, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.removedTags).toEqual(['dead-widget']);
    expect(res.code).not.toContain("@customElement('dead-widget')");
    expect(res.code).toContain('export class DeadWidget extends LitElement');
  });

  it('marks module as empty when all imports and registrations are purged', () => {
    const code = `
      import { DeadWidget } from './dead-widget.js';
      customElements.define('dead-widget', DeadWidget);
    `;

    const res = transformTagShake(code, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.isEmpty).toBe(true);
    expect(res.code.trim()).toBe('');
  });

  describe('shadowed customElements registry safety', () => {
    it('does not shake or prune shadowed customElements defined at module scope', () => {
      const code = `
        import { MyElement } from './my-element.js';
        const customElements = { define: () => {} };
        customElements.define('my-element', MyElement);
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.preservedTags).toEqual([]);
      expect(res.isEmpty).toBe(false);
      expect(res.code).toContain("import { MyElement } from './my-element.js';");
      expect(res.code).toContain('const customElements = { define: () => {} };');
      expect(res.code).toContain("customElements.define('my-element', MyElement);");
    });

    it('does not shake shadowed customElements inside function or block scope', () => {
      const code = `
        import { LocalWidget } from './local-widget.js';

        function setupRegistry() {
          const customElements = { define: () => {} };
          customElements.define('local-widget', LocalWidget);
        }
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("import { LocalWidget } from './local-widget.js';");
      expect(res.code).toContain("customElements.define('local-widget', LocalWidget);");
    });

    it('does not shake when customElements is a function parameter', () => {
      const code = `
        import { Comp } from './comp.js';

        function registerWith(customElements) {
          customElements.define('scoped-comp', Comp);
        }
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("import { Comp } from './comp.js';");
      expect(res.code).toContain("customElements.define('scoped-comp', Comp);");
    });

    it('does not shake window.customElements when window is shadowed locally', () => {
      const code = `
        import { Dialog } from './dialog.js';
        const window = { customElements: { define: () => {} } };
        window.customElements.define('app-dialog', Dialog);
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("import { Dialog } from './dialog.js';");
      expect(res.code).toContain("window.customElements.define('app-dialog', Dialog);");
    });

    it('selectively shakes global customElements while preserving shadowed registrations', () => {
      const code = `
        import { GlobalElement } from './global-element.js';
        import { LocalElement } from './local-element.js';

        // Global registration to shake
        customElements.define('global-element', GlobalElement);

        // Shadowed registration to keep
        function init() {
          const customElements = { define: () => {} };
          customElements.define('local-element', LocalElement);
        }
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['global-element']);
      expect(res.code).not.toContain('global-element');
      expect(res.code).not.toContain('GlobalElement');
      expect(res.code).toContain('LocalElement');
      expect(res.code).toContain('local-element');
    });

    it('prunes unused component import even when shadowed by local parameter', () => {
      const code = `
        import { DeadWidget } from './dead-widget.js';
        customElements.define('dead-widget', DeadWidget);

        function helper(DeadWidget) {
          console.log(DeadWidget);
        }
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['dead-widget']);
      expect(res.prunedImportsCount).toBe(1);
      expect(res.code).not.toContain('import { DeadWidget }');
      expect(res.code).toContain('function helper(DeadWidget)');
    });
  });

  describe('aliased @customElement decorator shaking', () => {
    it('prunes class decorator when @customElement is imported under an alias and unused', () => {
      const code = `
        import { LitElement } from 'lit';
        import { customElement as ce } from 'lit/decorators.js';

        @ce('dead-widget')
        export class DeadWidget extends LitElement {}
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['dead-widget']);
      expect(res.code).not.toContain("@ce('dead-widget')");
      expect(res.code).not.toContain('customElement as ce');
      expect(res.code).toContain('export class DeadWidget extends LitElement');
    });

    it('preserves aliased @customElement when tag is referenced in usedTags', () => {
      const code = `
        import { LitElement } from 'lit';
        import { customElement as ce } from 'lit/decorators.js';

        @ce('live-widget')
        export class LiveWidget extends LitElement {}
      `;

      const res = transformTagShake(code, {
        usedTags: ['live-widget'],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.preservedTags).toEqual(['live-widget']);
      expect(res.code).toContain("@ce('live-widget')");
      expect(res.code).toContain("import { customElement as ce } from 'lit/decorators.js';");
    });

    it('correctly handles mixed canonical and aliased customElement decorators in same module', () => {
      const code = `
        import { LitElement } from 'lit';
        import { customElement, customElement as ce } from 'lit/decorators.js';

        @customElement('kept-tag')
        export class KeptTag extends LitElement {}

        @ce('dead-tag')
        export class DeadTag extends LitElement {}
      `;

      const res = transformTagShake(code, {
        usedTags: ['kept-tag'],
      });

      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['dead-tag']);
      expect(res.preservedTags).toEqual(['kept-tag']);
      expect(res.code).toContain('@customElement("kept-tag")');
      expect(res.code).not.toContain('dead-tag');
      expect(res.code).toContain('customElement');
      expect(res.code).not.toContain('customElement as ce');
    });

    it('shakes transpiled __decorate call using aliased customElement helper', () => {
      const code = `
        import { customElement as ce } from 'lit/decorators.js';
        import { DeadWidget } from './dead-widget.js';

        __decorate([
          ce('dead-widget')
        ], DeadWidget);
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['dead-widget']);
      expect(res.prunedImportsCount).toBe(2);
      expect(res.isEmpty).toBe(true);
      expect(res.code.trim()).toBe('');
    });

    it('ignores non-Lit decorator even if imported under matching name or alias', () => {
      const code = `
        import { customElement as ce } from './third-party-lib.js';

        @ce('other-widget')
        export class OtherWidget {}
      `;

      const res = transformTagShake(code, {
        usedTags: [],
      });

      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("@ce('other-widget')");
      expect(res.code).toContain("import { customElement as ce } from './third-party-lib.js';");
    });

    it('deterministically prunes multiple specifiers from a shared import without index shifting', () => {
      const code = `
        import { CompA, CompB, CompC } from './components.js';

        customElements.define('comp-a', CompA);
        customElements.define('comp-b', CompB);
        customElements.define('comp-c', CompC);
      `;

      // Execute across 20 iterations to guarantee determinism against hash-order variance
      for (let i = 0; i < 20; i++) {
        const res = transformTagShake(code, {
          usedTags: ['comp-c'],
        });

        expect(res.shakenRegistrationsCount).toBe(2);
        expect(res.removedTags).toEqual(['comp-a', 'comp-b']);
        expect(res.preservedTags).toEqual(['comp-c']);
        expect(res.prunedImportsCount).toBe(2);
        expect(res.isEmpty).toBe(false);

        // Verify the live component CompC is preserved and dead components CompA, CompB are removed
        expect(res.code).toContain('import { CompC } from "./components.js";');
        expect(res.code).not.toContain('CompA');
        expect(res.code).not.toContain('CompB');
        expect(res.code).toContain('customElements.define("comp-c", CompC);');
        expect(res.code).not.toContain('comp-a');
        expect(res.code).not.toContain('comp-b');
      }
    });

    it('deterministically prunes all specifiers and drops import statement across multiple runs', () => {
      const code = `
        import { CompA, CompB, CompC } from './components.js';

        customElements.define('comp-a', CompA);
        customElements.define('comp-b', CompB);
        customElements.define('comp-c', CompC);
      `;

      for (let i = 0; i < 20; i++) {
        const res = transformTagShake(code, {
          usedTags: [],
        });

        expect(res.shakenRegistrationsCount).toBe(3);
        expect(res.removedTags).toEqual(['comp-a', 'comp-b', 'comp-c']);
        expect(res.prunedImportsCount).toBe(3);
        expect(res.isEmpty).toBe(true);
        expect(res.code.trim()).toBe('');
      }
    });
  });

  describe('ambient @customElement decorator scoping', () => {
    it('prunes ambient @customElement when unreferenced and not shadowed', () => {
      const code = `
        @customElement('ambient-dead')
        export class AmbientDead extends HTMLElement {}
      `;
      const res = transformTagShake(code, { usedTags: [] });
      expect(res.shakenRegistrationsCount).toBe(1);
      expect(res.removedTags).toEqual(['ambient-dead']);
      expect(res.code).not.toContain("@customElement('ambient-dead')");
    });

    it('preserves ambient @customElement when tag is referenced in usedTags', () => {
      const code = `
        @customElement('ambient-live')
        export class AmbientLive extends HTMLElement {}
      `;
      const res = transformTagShake(code, { usedTags: ['ambient-live'] });
      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.preservedTags).toEqual(['ambient-live']);
      expect(res.code).toContain("@customElement('ambient-live')");
    });

    it('does not shake @customElement when shadowed at module root scope', () => {
      const code = `
        const customElement = (tag) => (cls) => cls;
        @customElement('shadowed-root')
        export class ShadowedRoot extends HTMLElement {}
      `;
      const res = transformTagShake(code, { usedTags: [] });
      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("@customElement('shadowed-root')");
    });

    it('does not shake transpiled customElement helper when shadowed locally', () => {
      const code = `
        const customElement = (tag) => (cls) => cls;
        __decorate([
          customElement('shadowed-transpiled')
        ], MyComponent);
      `;
      const res = transformTagShake(code, { usedTags: [] });
      expect(res.shakenRegistrationsCount).toBe(0);
      expect(res.removedTags).toEqual([]);
      expect(res.code).toContain("customElement('shadowed-transpiled')");
    });
  });
});
