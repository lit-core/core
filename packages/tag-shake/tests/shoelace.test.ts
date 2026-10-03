import { describe, expect, it } from 'vitest';
import { transformTagShake } from '../src/index.js';

describe('shoelace / web awesome static define dead code elimination', () => {
  it('prunes unreferenced Class.define() calls and dead class imports', () => {
    const code = `
      import { WaButton } from './button.component.js';
      import { WaIcon } from './icon.component.js';
      import { WaDialog } from './dialog.component.js';

      WaButton.define('wa-button');
      WaIcon.define('wa-icon');
      WaDialog.define('wa-dialog');
    `;

    // Project only uses <wa-button>
    const res = transformTagShake(code, {
      usedTags: ['wa-button'],
    });

    expect(res.shakenRegistrationsCount).toBe(2);
    expect(res.removedTags).toEqual(['wa-icon', 'wa-dialog']);
    expect(res.preservedTags).toEqual(['wa-button']);

    expect(res.code).toContain('WaButton.define("wa-button");');
    expect(res.code).toContain('import { WaButton } from "./button.component.js";');
    expect(res.code).not.toContain('wa-icon');
    expect(res.code).not.toContain('WaIcon');
    expect(res.code).not.toContain('wa-dialog');
    expect(res.code).not.toContain('WaDialog');
  });

  it('preserves component class import if Class.define is pruned but class is re-exported', () => {
    const code = `
      import { SlButton } from './button.component.js';

      SlButton.define('sl-button');

      export { SlButton };
    `;

    const res = transformTagShake(code, {
      usedTags: [],
    });

    expect(res.shakenRegistrationsCount).toBe(1);
    expect(res.removedTags).toEqual(['sl-button']);
    expect(res.code).not.toContain('SlButton.define("sl-button");');
    expect(res.code).toContain('import { SlButton } from "./button.component.js";');
    expect(res.code).toContain('export { SlButton };');
  });
});
