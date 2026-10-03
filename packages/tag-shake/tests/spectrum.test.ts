import { describe, expect, it } from 'vitest';
import { transformTagShake } from '../src/index.js';

describe('spectrum bundle dead code elimination', () => {
  it('prunes unreferenced Spectrum registration entries', () => {
    const spectrumModule = `
      import { Button } from './Button.js';
      import { ActionButton } from './ActionButton.js';
      import { ClearButton } from './ClearButton.js';

      customElements.define('sp-button', Button);
      customElements.define('sp-action-button', ActionButton);
      customElements.define('sp-clear-button', ClearButton);
    `;

    const res = transformTagShake(spectrumModule, {
      usedTags: ['sp-button'],
    });

    expect(res.shakenRegistrationsCount).toBe(2);
    expect(res.removedTags).toEqual(['sp-action-button', 'sp-clear-button']);
    expect(res.preservedTags).toEqual(['sp-button']);

    expect(res.code).toContain('customElements.define("sp-button", Button);');
    expect(res.code).toContain('import { Button } from "./Button.js";');
    expect(res.code).not.toContain('sp-action-button');
    expect(res.code).not.toContain('ActionButton');
    expect(res.code).not.toContain('sp-clear-button');
    expect(res.code).not.toContain('ClearButton');
  });

  it('marks side-effect module as empty when solitary registration is dead', () => {
    const entry = `
      import { Sidenav } from './Sidenav.js';
      customElements.define('sp-sidenav', Sidenav);
    `;

    const res = transformTagShake(entry, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.isEmpty).toBe(true);
    expect(res.code.trim()).toBe('');
  });
});
