import { describe, expect, it, vi } from 'vitest';
import type { ActionContext, LoaderContext } from '../../src/context.js';
import { executeServerAction, executeServerLoader } from '../../src/edge.js';
import { ServerElement } from '../../src/element.js';

describe('ServerElement and ServerElementMixin', () => {
  it('instantiates and provides reactive action state tracking', () => {
    class MyElement extends ServerElement {
      renderCount = 0;
      override requestUpdate() {
        this.renderCount++;
        super.requestUpdate();
      }
    }

    const el = new MyElement();
    expect(el.isActionPending('reserve')).toBe(false);
    expect(el.getActionState('reserve').status).toBe('idle');

    el.actionState.setPending('reserve');
    expect(el.isActionPending('reserve')).toBe(true);
    expect(el.getActionState('reserve').status).toBe('pending');
    expect(el.renderCount).toBeGreaterThan(0);

    el.actionState.setSuccess('reserve', { success: true });
    expect(el.isActionPending('reserve')).toBe(false);
    expect(el.getActionState('reserve').status).toBe('success');
    expect(el.getActionState('reserve').data).toEqual({ success: true });

    const err = new Error('Out of stock');
    el.actionState.setError('reserve', err);
    expect(el.isActionPending('reserve')).toBe(false);
    expect(el.getActionState('reserve').status).toBe('error');
    expect(el.getActionState('reserve').error).toBe(err);
  });

  it('executes server loader and server action with context', async () => {
    class DataElement extends ServerElement {
      data = '';
      async load(env: any) {
        this.data = `loaded from ${env.REGION}`;
      }
      async updateData(suffix: string) {
        this.data += suffix;
        return this.data;
      }
    }

    const el = new DataElement();
    const mockContext: LoaderContext = {
      env: { REGION: 'eu-west-1' },
      request: new Request('http://localhost/test'),
      url: new URL('http://localhost/test'),
      params: {},
      signal: new AbortController().signal,
      cookies: new Map(),
      headers: new Headers(),
    };

    await executeServerLoader(el, mockContext, 'load');
    expect(el.data).toBe('loaded from eu-west-1');

    const actionContext: ActionContext = {
      ...mockContext,
      seq: 1,
      clientState: {},
      actionToken: 'tok123',
      setCookie: vi.fn(),
      setHeader: vi.fn(),
    };

    const res = await executeServerAction(el, actionContext, 'updateData', ['!']);
    expect(res).toBe('loaded from eu-west-1!');
    expect(el.data).toBe('loaded from eu-west-1!');
  });
});
