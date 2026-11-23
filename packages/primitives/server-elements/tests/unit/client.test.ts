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
      return new Response(JSON.stringify([{ r: { reserved: 1 } }]), {
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

  describe('action queue', () => {
    const makeEl = () =>
      ({
        tagName: 'my-counter',
        getAttribute: () => null,
        actionState: { setPending: vi.fn(), setSuccess: vi.fn(), setError: vi.fn() },
      }) as any;

    const deferred = () => {
      let resolve!: (res: Response) => void;
      let reject!: (err: Error) => void;
      const promise = new Promise<Response>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    const json = (frames: unknown[]) => new Response(JSON.stringify(frames), { status: 200, headers: { 'Content-Type': 'application/json' } });

    it('runs actions on one element strictly in order, starting each from the previous snapshot', async () => {
      const el = makeEl();
      const first = deferred();
      const bodies: any[] = [];
      globalThis.fetch = vi.fn(async (_url, init: any) => {
        bodies.push(JSON.parse(init.body));
        return bodies.length === 1 ? first.promise : json([{ s: { n: 2 }, sig: 'sig-2', sq: 2 }, { r: 'second' }]);
      }) as any;

      const one = dispatchServerAction(el, 'act');
      const two = dispatchServerAction(el, 'act');
      await new Promise((r) => setTimeout(r, 10));

      // The second request has not been sent: it must wait for the first response and its fresh snapshot.
      expect(bodies).toHaveLength(1);
      expect(el.actionState.setPending).toHaveBeenCalledTimes(2);

      first.resolve(json([{ s: { n: 1 }, sig: 'sig-1', sq: 1 }, { r: 'first' }]));
      expect(await one).toBe('first');
      expect(await two).toBe('second');

      expect(bodies).toHaveLength(2);
      expect(bodies[1].state).toEqual({ n: 1 });
      expect(bodies[1].snapshotSeq).toBe(1);
      expect(bodies.map((b) => b.seq)).toEqual([1, 2]);
      expect(el.__litState).toEqual({ n: 2 });
    });

    it('does not let a failed action block or poison the ones queued behind it', async () => {
      const el = makeEl();
      let call = 0;
      globalThis.fetch = vi.fn(async () => {
        call++;
        if (call === 1) throw new Error('Network disconnected');
        return json([{ r: 'recovered' }]);
      }) as any;

      const failing = dispatchServerAction(el, 'act');
      const following = dispatchServerAction(el, 'act');

      await expect(failing).rejects.toThrow('Network disconnected');
      expect(await following).toBe('recovered');
      expect(el.actionState.setError).toHaveBeenCalledTimes(1);
      expect(el.actionState.setSuccess).toHaveBeenCalledWith('act', 'recovered');
    });

    it('adopts the snapshot a failed action carries, so the next action is signed with it', async () => {
      const el = makeEl();
      const sent: Array<{ sig: string; snapshotSeq: number }> = [];
      let call = 0;
      globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        call++;
        if (call === 1) {
          return json([
            { s: { n: 1 }, sig: 'fresh-sig', sq: 1 },
            { e: 'Out of stock', code: 'CONFLICT' },
          ]);
        }
        return json([{ r: 'ok' }]);
      }) as any;

      await expect(dispatchServerAction(el, 'act')).rejects.toThrow('Out of stock');
      expect(await dispatchServerAction(el, 'act')).toBe('ok');

      expect(sent[1]).toMatchObject({ sig: 'fresh-sig', snapshotSeq: 1 });
    });

    it('keeps separate elements independent', async () => {
      const slow = makeEl();
      const fast = makeEl();
      const held = deferred();
      globalThis.fetch = vi.fn(async (_url, init: any) => (JSON.parse(init.body).seq === 1 && !fast.__litSeq ? held.promise : json([{ r: 'fast' }]))) as any;

      const blocked = dispatchServerAction(slow, 'act');
      expect(await dispatchServerAction(fast, 'act')).toBe('fast');

      held.resolve(json([{ r: 'slow' }]));
      expect(await blocked).toBe('slow');
    });
  });

  it('exposes field-level messages from error frames and error responses on ServerActionError', async () => {
    const el = { tagName: 'my-form', getAttribute: () => null } as any;
    const fields = { email: 'Already registered' };

    globalThis.fetch = vi.fn(
      async () => new Response(`${JSON.stringify({ e: 'Fix it.', code: 'UNPROCESSABLE_CONTENT', fields })}\n`, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }),
    ) as any;
    await expect(dispatchServerAction(el, 'hashA')).rejects.toMatchObject({ message: 'Fix it.', code: 'UNPROCESSABLE_CONTENT', fields });

    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: 'Fix it.', code: 'UNPROCESSABLE_CONTENT', fields }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
    ) as any;
    await expect(dispatchServerAction(el, 'hashA')).rejects.toMatchObject({ status: 422, code: 'UNPROCESSABLE_CONTENT', fields });
  });

  it('announces settled actions with bubbling composed DOM events', async () => {
    const events: Array<{ type: string; init: any; detail: any }> = [];
    const el = {
      tagName: 'my-form',
      getAttribute: () => null,
      dispatchEvent(event: any) {
        events.push({ type: event.type, init: { bubbles: event.bubbles, composed: event.composed }, detail: event.detail });
        return true;
      },
    } as any;

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify([{ r: 'done' }]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as any;
    await dispatchServerAction(el, 'hashA', [], { actionName: 'save' });

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Nope', code: 'FORBIDDEN' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) as any;
    await expect(dispatchServerAction(el, 'hashA', [], { actionName: 'save' })).rejects.toThrow('Nope');

    expect(events.map((e) => e.type)).toEqual(['lit-action-success', 'lit-action-error']);
    expect(events[0].init).toEqual({ bubbles: true, composed: true });
    expect(events[0].detail).toEqual({ action: 'save', result: 'done' });
    expect(events[1].detail.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  describe('pending attributes', () => {
    const makeHost = () => {
      const attrs = new Map<string, string>();
      return {
        attrs,
        el: {
          tagName: 'my-form',
          getAttribute: (name: string) => attrs.get(name) ?? null,
          setAttribute: (name: string, value: string) => attrs.set(name, value),
          removeAttribute: (name: string) => attrs.delete(name),
        } as any,
      };
    };

    it('marks the host while actions are outstanding and clears it when they settle', async () => {
      const { attrs, el } = makeHost();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      globalThis.fetch = vi.fn(async () => {
        await gate;
        return new Response(JSON.stringify([{ r: 1 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const one = dispatchServerAction(el, 'hashA', [], { actionName: 'save' });
      const two = dispatchServerAction(el, 'hashA', [], { actionName: 'save' });
      const other = dispatchServerAction(el, 'hashB', [], { actionName: 'remove' });

      expect(attrs.get('data-lit-pending')).toBe('save remove');
      expect(attrs.get('aria-busy')).toBe('true');

      release();
      await Promise.all([one, two, other]);
      expect(attrs.has('data-lit-pending')).toBe(false);
      expect(attrs.has('aria-busy')).toBe(false);
    });

    it('clears the marker after a failure too', async () => {
      const { attrs, el } = makeHost();
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'no', code: 'FORBIDDEN' }), { status: 403, headers: { 'Content-Type': 'application/json' } })) as any;

      await expect(dispatchServerAction(el, 'hashA', [], { actionName: 'save' })).rejects.toThrow('no');
      expect(attrs.has('data-lit-pending')).toBe(false);
    });
  });
});
