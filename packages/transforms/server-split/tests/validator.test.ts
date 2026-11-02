import { describe, expect, it } from 'vitest';
import { splitServerElement } from '../src/index.js';

describe('argument validation synthesis (SE102 / SE105)', () => {
  it('synthesizes runtime argument validator for primitives and literal unions', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class FormActionComponent extends LitElement {
        static properties = {
          success: { type: Boolean },
        };

        @action()
        async submit(
          username: string,
          age: number,
          newsletter: boolean,
          tier: 'free' | 'pro' | 'enterprise'
        ) {
          this.success = true;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    expect(res.hasErrors).toBe(false);
    expect(res.workerCode).toContain('function __lit_validate_submit(args)');
    expect(res.workerCode).toContain('if (!Array.isArray(args)) throw new TypeError("Action arguments must be an array");');
    expect(res.workerCode).toContain('typeof p0 !== "string"');
    expect(res.workerCode).toContain('!Number.isFinite(p1)');
    expect(res.workerCode).toContain('typeof p2 !== "boolean"');
    expect(res.workerCode).toContain('p3 !== "free" && p3 !== "pro" && p3 !== "enterprise"');
  });

  it('synthesizes argument validator for arrays and object shapes', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class ComplexActionComponent extends LitElement {
        static properties = {
          tags: { type: Array },
        };

        @action()
        async updateTags(tags: string[], config: { active: boolean, label?: string }) {
          this.tags = tags;
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.isServerElement).toBe(true);
    expect(res.hasErrors).toBe(false);
    expect(res.workerCode).toContain('function __lit_validate_updateTags(args)');
    expect(res.workerCode).toContain('!Array.isArray(p0)');
    expect(res.workerCode).toContain('typeof p1 !== "object"');
  });

  it('reports SE105 error when action parameter is missing type annotation', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class UntypedComponent extends LitElement {
        @action()
        async send(untypedArg) {
          console.log(untypedArg);
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se105 = res.diagnostics.find((d) => d.code === 'SE105');
    expect(se105).toBeDefined();
    expect(se105?.message).toContain("Missing parameter type annotation on @action() parameter 'untypedArg'");
  });

  it('reports SE102 error when action parameter uses unsupported type', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class UnsupportedParamComponent extends LitElement {
        @action()
        async register(handler: Function) {
          handler();
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(true);
    const se102 = res.diagnostics.find((d) => d.code === 'SE102');
    expect(se102).toBeDefined();
    expect(se102?.message).toContain("Unsupported type reference 'Function'");
  });

  it('enforces prototype pollution defense and strict object keys', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class StrictComp extends LitElement {
        @action()
        async save(config: { title: string, count: number }) {
          console.log(config);
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(false);

    const fnCode = res.workerCode.slice(res.workerCode.indexOf('function __lit_validate_save'));
    const validatorFn = new Function(`class StrictComp {}; ${fnCode}; return __lit_validate_save;`)();

    // Valid object passes
    expect(() => validatorFn([{ title: 'hello', count: 10 }])).not.toThrow();

    // Prototype pollution: __proto__
    const protoPollution = JSON.parse('{"title":"test","count":1,"__proto__":{"polluted":true}}');
    expect(() => validatorFn([protoPollution])).toThrow(TypeError);
    expect(() => validatorFn([protoPollution])).toThrow(/Prototype pollution/);

    // Prototype pollution: constructor
    expect(() => validatorFn([{ title: 'test', count: 1, constructor: {} }])).toThrow(TypeError);

    // Unexpected key (strict mode)
    expect(() => validatorFn([{ title: 'test', count: 1, extraKey: 'evil' }])).toThrow(TypeError);
    expect(() => validatorFn([{ title: 'test', count: 1, extraKey: 'evil' }])).toThrow(/unexpected unlisted property/);
  });

  it('enforces array element validation, rejects sparse arrays, and rejects Infinity/NaN', () => {
    const code = `
      import { LitElement } from 'lit';
      import { action } from '@lit-core/server-elements';

      export class ArrayComp extends LitElement {
        @action()
        async process(nums: number[], val: number) {
          console.log(nums, val);
        }
      }
    `;

    const res = splitServerElement(code);
    expect(res.hasErrors).toBe(false);

    const fnCode = res.workerCode.slice(res.workerCode.indexOf('function __lit_validate_process'));
    const validatorFn = new Function(`class ArrayComp {}; ${fnCode}; return __lit_validate_process;`)();

    // Valid array and number
    expect(() => validatorFn([[1, 2, 3], 42])).not.toThrow();

    // Rejects Infinity and -Infinity
    expect(() => validatorFn([[1, 2, 3], Infinity])).toThrow(TypeError);
    expect(() => validatorFn([[1, 2, 3], -Infinity])).toThrow(TypeError);
    expect(() => validatorFn([[1, 2, 3], NaN])).toThrow(TypeError);

    // Rejects sparse arrays
    const sparse = [1];
    sparse[2] = 3;
    expect(() => validatorFn([sparse, 10])).toThrow(TypeError);
    expect(() => validatorFn([sparse, 10])).toThrow(/sparse arrays with holes are not allowed/);

    // Rejects array element of wrong type
    expect(() => validatorFn([[1, 'invalid', 3], 10])).toThrow(TypeError);
  });
});
