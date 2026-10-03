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
});
