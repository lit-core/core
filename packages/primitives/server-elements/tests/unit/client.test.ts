import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindFormAction, dispatchServerAction } from '../../src/client.js';
import { ServerElement } from '../../src/element.js';

describe('client action dispatcher', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('dispatches action POST request with state, token, and arguments', async () => {
    class ClientTestElement extends ServerElement {
      tagName = 'client-test-element';
      attributes = [{ name: 'id', value: 'item-1' }] as any;
      getAttribute(name: string) {
        if (name === 'data-lit-token') return 'token-abc';
        if (name === 'data-lit-sig') return 'sig-xyz';
        if (name === 'data-lit-attrs') return 'id';
        if (name === 'id') return 'item-1';
        return null;
      }
    }

    const el = new ClientTestElement();

    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedHeaders: any = null;

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(init?.body);
      return new Response(JSON.stringify({ result: { reserved: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const result = await dispatchServerAction(el as unknown as HTMLElement, 'hash123', [5]);

    expect(capturedUrl).toBe('/_lit/a/hash123');
    expect(capturedHeaders['X-Lit-Action-Token']).toBe('token-abc');
    expect(capturedBody.args).toEqual([5]);
    expect(capturedBody.seq).toBe(1);
    expect(capturedBody.attrs.id).toBe('item-1');
    expect(capturedBody.sig).toBe('sig-xyz');
    expect(capturedBody.snapshotSeq).toBe(0);
    expect(result).toEqual({ reserved: 1 });
  });

  it('bindFormAction extracts form data and calls action', async () => {
    const el = { tagName: 'my-element' } as any;
    const actionSpy = vi.fn(async () => {});
    const handler = bindFormAction(el, actionSpy);

    const mockFormData = new Map<string, string>([
      ['qty', '42'],
      ['item', 'widget'],
    ]);

    const mockForm = {
      tagName: 'FORM',
    };

    // Polyfill FormData for test if not in browser or mock
    const originalFormData = (globalThis as any).FormData;
    (globalThis as any).FormData = class MockFormData {
      forEach(cb: (val: any, key: any) => void) {
        mockFormData.forEach(cb);
      }
    };

    try {
      const event = {
        preventDefault: vi.fn(),
        currentTarget: mockForm,
      } as unknown as SubmitEvent;

      handler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(actionSpy).toHaveBeenCalledWith({ qty: '42', item: 'widget' });
    } finally {
      (globalThis as any).FormData = originalFormData;
    }
  });

  it('captures action return value from ndjson patch frame { r: ... }', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
    } as any;

    const streamText = '{"s":{"count":42}}\n{"r":"updated_successfully"}\n';
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamText));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    }) as any;

    const result = await dispatchServerAction(el as unknown as HTMLElement, 'actHash');
    expect(result).toBe('updated_successfully');
    expect(el.__litState).toEqual({ count: 42 });
  });

  it('__litBindEvents binds events to Element instances including SVG elements', async () => {
    const { __litBindEvents } = await import('../../src/client.js');

    const clicked = vi.fn();
    const svgPath = {
      nodeType: 1,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'click') clicked.mockImplementation(handler);
      }),
    };

    const fakeContainer = {
      childNodes: [svgPath],
    };
    const fakeElement = {
      shadowRoot: fakeContainer,
      tagName: 'SVG-ICON',
      getAttribute: () => null,
    } as any;

    __litBindEvents(fakeElement, [
      {
        path: [0],
        event: 'click',
        actionHash: 'clickSvg',
      },
    ]);

    expect(svgPath.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('bindFormAction rejects prototype pollution keys (__proto__, constructor, prototype)', async () => {
    const el = { tagName: 'my-element' } as any;
    let capturedData: any = null;
    const actionSpy = vi.fn(async (d) => {
      capturedData = d;
    });
    const handler = bindFormAction(el, actionSpy);

    const mockFormData = new Map<string, string>([
      ['__proto__', 'evil_proto'],
      ['constructor', 'evil_constructor'],
      ['prototype', 'evil_prototype'],
      ['normalField', 'valid_value'],
    ]);

    const originalFormData = (globalThis as any).FormData;
    (globalThis as any).FormData = class MockFormData {
      forEach(cb: (val: any, key: any) => void) {
        mockFormData.forEach(cb);
      }
    };

    try {
      handler({ preventDefault: vi.fn(), currentTarget: {} } as unknown as SubmitEvent);

      expect(actionSpy).toHaveBeenCalled();
      expect(Object.getPrototypeOf(capturedData)).toBeNull();
      expect(Object.hasOwn(capturedData, '__proto__')).toBe(false);
      expect(Object.hasOwn(capturedData, 'constructor')).toBe(false);
      expect(Object.hasOwn(capturedData, 'prototype')).toBe(false);
      expect(capturedData.normalField).toBe('valid_value');
      expect(({} as any).evil_proto).toBeUndefined();
    } finally {
      (globalThis as any).FormData = originalFormData;
    }
  });

  it('bindFormAction safely handles toString, valueOf, and multi-value fields without prototype collision', async () => {
    const el = { tagName: 'my-element' } as any;
    let capturedData: any = null;
    const actionSpy = vi.fn(async (d) => {
      capturedData = d;
    });
    const handler = bindFormAction(el, actionSpy);

    const mockEntries: Array<[string, string]> = [
      ['toString', 'first_string'],
      ['toString', 'second_string'],
      ['valueOf', '42'],
      ['tag', 'alpha'],
      ['tag', 'beta'],
      ['tag', 'gamma'],
    ];

    const originalFormData = (globalThis as any).FormData;
    (globalThis as any).FormData = class MockFormData {
      forEach(cb: (val: any, key: any) => void) {
        mockEntries.forEach(([k, v]) => {
          cb(v, k);
        });
      }
    };

    try {
      handler({ preventDefault: vi.fn(), currentTarget: {} } as unknown as SubmitEvent);

      expect(actionSpy).toHaveBeenCalled();
      expect(capturedData.toString).toEqual(['first_string', 'second_string']);
      expect(capturedData.valueOf).toBe('42');
      expect(capturedData.tag).toEqual(['alpha', 'beta', 'gamma']);
      expect(typeof Object.prototype.toString).toBe('function');
    } finally {
      (globalThis as any).FormData = originalFormData;
    }
  });

  it('__litBindEvents binds events to shadowRoot with path: []', async () => {
    const { __litBindEvents } = await import('../../src/client.js');

    const shadowRootListener = vi.fn();
    const fakeShadowRoot = {
      nodeType: 11,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'click') shadowRootListener.mockImplementation(handler);
      }),
    };

    const fakeElement = {
      shadowRoot: fakeShadowRoot,
      tagName: 'TEST-COMPONENT',
      getAttribute: () => null,
    } as any;

    __litBindEvents(fakeElement, [
      {
        path: [],
        event: 'click',
        actionHash: 'rootClickAction',
      },
    ]);

    expect(fakeShadowRoot.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  it('__litBindEvents binds events to arbitrary EventTarget with path: []', async () => {
    const { __litBindEvents } = await import('../../src/client.js');

    const listener = vi.fn();
    const fakeHost = {
      nodeType: 1,
      addEventListener: vi.fn((event, handler) => {
        if (event === 'focus') listener.mockImplementation(handler);
      }),
      tagName: 'HOST-ELEMENT',
      getAttribute: () => null,
    } as any;

    __litBindEvents(fakeHost, [
      {
        path: [],
        event: 'focus',
        actionHash: 'hostFocusAction',
      },
    ]);

    expect(fakeHost.addEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
  });

  it('__litBindEvents skips text and comment nodes', async () => {
    const { __litBindEvents } = await import('../../src/client.js');

    const textNode = {
      nodeType: 3,
      addEventListener: vi.fn(),
    };
    const commentNode = {
      nodeType: 8,
      addEventListener: vi.fn(),
    };

    const fakeShadowRoot = {
      nodeType: 11,
      childNodes: [textNode, commentNode],
    };

    const fakeElement = {
      shadowRoot: fakeShadowRoot,
      tagName: 'TEST-SKIP',
      getAttribute: () => null,
    } as any;

    __litBindEvents(fakeElement, [
      { path: [0], event: 'click', actionHash: 'textAction' },
      { path: [1], event: 'click', actionHash: 'commentAction' },
    ]);

    expect(textNode.addEventListener).not.toHaveBeenCalled();
    expect(commentNode.addEventListener).not.toHaveBeenCalled();
  });

  it('captures action return value from JSON array patch frames', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
    } as any;

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify([{ s: { count: 99 }, sig: 'new-sig' }, { r: 'batch_json_success' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const result = await dispatchServerAction(el as unknown as HTMLElement, 'actHash');
    expect(result).toBe('batch_json_success');
    expect(el.__litState).toEqual({ count: 99 });
    expect(el.__litSig).toBe('new-sig');
  });

  it('captures falsy action return values (false, 0, null, "") from JSON array', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
    } as any;

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify([{ r: false }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    let result = await dispatchServerAction(el as unknown as HTMLElement, 'actHash');
    expect(result).toBe(false);

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify([{ r: 0 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    result = await dispatchServerAction(el as unknown as HTMLElement, 'actHash');
    expect(result).toBe(0);
  });

  it('drops stale out-of-order responses based on per-instance sequence numbers', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
      actionState: {
        setPending: vi.fn(),
        setSuccess: vi.fn(),
        setError: vi.fn(),
      },
    } as any;

    let resolveRequest1: (res: Response) => void;
    const promise1 = new Promise<Response>((resolve) => {
      resolveRequest1 = resolve;
    });

    let resolveRequest2: (res: Response) => void;
    const promise2 = new Promise<Response>((resolve) => {
      resolveRequest2 = resolve;
    });

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? promise1 : promise2;
    }) as any;

    const actionPromise1 = dispatchServerAction(el as unknown as HTMLElement, 'myAction');
    const actionPromise2 = dispatchServerAction(el as unknown as HTMLElement, 'myAction');

    expect(el.__litSeq).toBe(2);

    // Request 2 completes first
    resolveRequest2?.(
      new Response(JSON.stringify([{ s: { value: 'from_request_2' } }, { r: 'result_2' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res2 = await actionPromise2;
    expect(res2).toBe('result_2');
    expect(el.__litState).toEqual({ value: 'from_request_2' });
    expect(el.__litLastAppliedSeq).toBe(2);
    expect(el.actionState.setSuccess).toHaveBeenCalledWith('myAction', 'result_2');

    // Request 1 completes later (stale)
    resolveRequest1?.(
      new Response(JSON.stringify([{ s: { value: 'from_request_1_stale' } }, { r: 'result_1_stale' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res1 = await actionPromise1;
    expect(res1).toBeUndefined();
    expect(el.__litState).toEqual({ value: 'from_request_2' });
    expect(el.__litLastAppliedSeq).toBe(2);
    expect(el.actionState.setSuccess).not.toHaveBeenCalledWith('myAction', 'result_1_stale');
    expect(el.actionState.setSuccess).toHaveBeenCalledTimes(1);
  });

  it('drops stale errors and does not trigger actionState.setError for obsolete requests', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
      actionState: {
        setPending: vi.fn(),
        setSuccess: vi.fn(),
        setError: vi.fn(),
      },
    } as any;

    let rejectRequest1: (err: Error) => void;
    const promise1 = new Promise<Response>((_, reject) => {
      rejectRequest1 = reject;
    });

    let resolveRequest2: (res: Response) => void;
    const promise2 = new Promise<Response>((resolve) => {
      resolveRequest2 = resolve;
    });

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return callCount === 1 ? promise1 : promise2;
    }) as any;

    const actionPromise1 = dispatchServerAction(el as unknown as HTMLElement, 'act');
    const actionPromise2 = dispatchServerAction(el as unknown as HTMLElement, 'act');

    resolveRequest2?.(
      new Response(JSON.stringify([{ r: 'success_2' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await actionPromise2;
    expect(el.__litLastAppliedSeq).toBe(2);
    expect(el.actionState.setSuccess).toHaveBeenCalledTimes(1);

    rejectRequest1?.(new Error('Network disconnected'));

    await actionPromise1;
    expect(el.actionState.setError).not.toHaveBeenCalled();
  });

  it('halts and cancels ndjson stream if a newer request completes mid-stream', async () => {
    const el = {
      tagName: 'my-counter',
      getAttribute: () => null,
    } as any;

    let sendChunk1: () => void;
    let sendChunk2: () => void;
    const cancelSpy = vi.fn();

    const stream = new ReadableStream({
      start(controller) {
        sendChunk1 = () => {
          controller.enqueue(new TextEncoder().encode('{"s":{"step":1}}\n'));
        };
        sendChunk2 = () => {
          controller.enqueue(new TextEncoder().encode('{"s":{"step":2}}\n{"r":"done_1"}\n'));
        };
      },
      cancel: cancelSpy,
    });

    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.seq === 1) {
        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }
      return new Response(JSON.stringify([{ s: { step: 'newer' } }, { r: 'done_2' }]), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const actionPromise1 = dispatchServerAction(el as unknown as HTMLElement, 'act');

    await new Promise((r) => setTimeout(r, 10));
    sendChunk1?.();
    await new Promise((r) => setTimeout(r, 10));

    expect(el.__litState).toEqual({ step: 1 });
    expect(el.__litLastAppliedSeq).toBe(1);

    const res2 = await dispatchServerAction(el as unknown as HTMLElement, 'act');
    expect(res2).toBe('done_2');
    expect(el.__litState).toEqual({ step: 'newer' });
    expect(el.__litLastAppliedSeq).toBe(2);

    sendChunk2?.();
    const res1 = await actionPromise1;

    expect(res1).toBeUndefined();
    expect(el.__litState).toEqual({ step: 'newer' });
    expect(cancelSpy).toHaveBeenCalled();
  });
});
