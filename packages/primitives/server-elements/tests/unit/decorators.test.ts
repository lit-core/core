import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { action } from '../../src/decorators/action.js';
import { loader } from '../../src/decorators/loader.js';
import { UncompiledServerElementError } from '../../src/errors.js';
import { ACTION_SYMBOL, LOADER_SYMBOL } from '../../src/symbols.js';

describe('server element decorators', () => {
  const originalTestMode = (globalThis as any).__LIT_SERVER_ELEMENTS_TEST_MODE__;

  beforeEach(() => {
    delete (globalThis as any).__LIT_SERVER_ELEMENTS_TEST_MODE__;
    delete (globalThis as any).__ALLOW_UNCOMPILED_SERVER_ELEMENTS__;
  });

  afterEach(() => {
    if (originalTestMode !== undefined) {
      (globalThis as any).__LIT_SERVER_ELEMENTS_TEST_MODE__ = originalTestMode;
    } else {
      delete (globalThis as any).__LIT_SERVER_ELEMENTS_TEST_MODE__;
    }
  });

  it('throws UncompiledServerElementError when @loader() runs uncompiled', () => {
    expect(() => {
      const dec = loader();
      class TestComponent {
        async loadData() {}
      }
      dec(TestComponent.prototype, 'loadData', Object.getOwnPropertyDescriptor(TestComponent.prototype, 'loadData'));
    }).toThrow(UncompiledServerElementError);
  });

  it('throws UncompiledServerElementError when @action() runs uncompiled', () => {
    expect(() => {
      const dec = action();
      class TestComponent {
        async mutateData() {}
      }
      dec(TestComponent.prototype, 'mutateData', Object.getOwnPropertyDescriptor(TestComponent.prototype, 'mutateData'));
    }).toThrow(UncompiledServerElementError);
  });

  it('allows decorator evaluation when __LIT_SERVER_ELEMENTS_TEST_MODE__ is enabled', () => {
    (globalThis as any).__LIT_SERVER_ELEMENTS_TEST_MODE__ = true;

    const loadDec = loader({ revalidate: 'always' });
    const actionDec = action({ name: 'customAction' });

    class TestComponent {
      async loadData() {}
      async mutateData() {}
    }

    const loadDesc = Object.getOwnPropertyDescriptor(TestComponent.prototype, 'loadData');
    const actDesc = Object.getOwnPropertyDescriptor(TestComponent.prototype, 'mutateData');

    loadDec(TestComponent.prototype, 'loadData', loadDesc);
    actionDec(TestComponent.prototype, 'mutateData', actDesc);

    expect((TestComponent.prototype.loadData as any)[LOADER_SYMBOL]).toEqual({ revalidate: 'always' });
    expect((TestComponent.prototype.mutateData as any)[ACTION_SYMBOL]).toEqual({ name: 'customAction' });
  });
});
