import { describe, expect, it } from 'vitest';
import { transformTagShake } from '../src/index.js';

describe('carbon barrel dead code elimination', () => {
  it('eliminates unreferenced Carbon components from multi-component barrels', () => {
    const carbonBarrel = `
      import { CDSAccordion } from './components/accordion/index.js';
      import { CDSButton } from './components/button/index.js';
      import { CDSDropdown } from './components/dropdown/index.js';
      import { CDSModal } from './components/modal/index.js';

      customElements.define('cds-accordion', CDSAccordion);
      customElements.define('cds-button', CDSButton);
      customElements.define('cds-dropdown', CDSDropdown);
      customElements.define('cds-modal', CDSModal);
    `;

    // Application only uses <cds-button> and <cds-modal>
    const res = transformTagShake(carbonBarrel, {
      usedTags: ['cds-button', 'cds-modal'],
    });

    expect(res.shakenRegistrationsCount).toBe(2);
    expect(res.removedTags).toEqual(['cds-accordion', 'cds-dropdown']);
    expect(res.preservedTags).toEqual(['cds-button', 'cds-modal']);

    // Check code contents
    expect(res.code).toContain('customElements.define("cds-button", CDSButton);');
    expect(res.code).toContain('customElements.define("cds-modal", CDSModal);');
    expect(res.code).toContain('import { CDSButton } from "./components/button/index.js";');
    expect(res.code).toContain('import { CDSModal } from "./components/modal/index.js";');

    // Dead components are pruned completely
    expect(res.code).not.toContain('cds-accordion');
    expect(res.code).not.toContain('CDSAccordion');
    expect(res.code).not.toContain('cds-dropdown');
    expect(res.code).not.toContain('CDSDropdown');
  });

  it('handles window.customElements.define variant', () => {
    const code = `
      import { CDSTag } from './components/tag/index.js';
      window.customElements.define('cds-tag', CDSTag);
    `;

    const res = transformTagShake(code, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.isEmpty).toBe(true);
    expect(res.code.trim()).toBe('');
  });
});
