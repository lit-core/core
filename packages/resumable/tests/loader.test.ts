import './setup.js';
import { describe, expect, it, vi } from 'vitest';
import { generateInlineLoader, initLoader, ResumableLoader } from '../src/client/loader.js';
import { createReplayedEvent, RESUMED_EVENT_FLAG, replayEvent, replayQueue } from '../src/client/replay.js';

describe('resumable client loader and event replay', () => {
  it('generates a compact inline loader under 1.5 KB', () => {
    const inlineScript = generateInlineLoader({ 'user-profile': '/assets/user-profile.js' });
    expect(inlineScript).toBeTypeOf('string');
    expect(inlineScript.length).toBeGreaterThan(100);
    expect(inlineScript.length).toBeLessThan(1500); // Verify ~1.2 KB constraint
    expect(inlineScript).toContain('__lit_resumed__');
    expect(inlineScript).toContain('user-profile');
  });

  it('correctly creates replayed events preserving standard properties', () => {
    const orig = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 120,
      clientY: 240,
      ctrlKey: true,
      shiftKey: false,
    });

    const replayed = createReplayedEvent(orig) as MouseEvent;
    expect(replayed.type).toBe('click');
    expect(replayed.bubbles).toBe(true);
    expect(replayed.composed).toBe(true);
    expect(replayed.clientX).toBe(120);
    expect(replayed.clientY).toBe(240);
    expect(replayed.ctrlKey).toBe(true);
    expect((replayed as any)[RESUMED_EVENT_FLAG]).toBe(true);
  });

  it('dispatches replayed events without losing target', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const received: Event[] = [];
    target.addEventListener('click', (e) => {
      received.push(e);
    });

    const orig = new MouseEvent('click', { bubbles: true, cancelable: true });
    const success = replayEvent({
      event: orig,
      host,
      target,
      path: [target, host, document.body],
      timestamp: Date.now(),
    });

    expect(success).toBe(true);
    expect(received.length).toBe(1);
    expect(received[0].type).toBe('click');
    expect((received[0] as any)[RESUMED_EVENT_FLAG]).toBe(true);

    target.remove();
    host.remove();
  });

  it('replays buffered queue in FIFO order', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);

    const clicks: number[] = [];
    target.addEventListener('click', () => {
      clicks.push(clicks.length + 1);
    });

    const queue = [
      {
        event: new MouseEvent('click'),
        host: target,
        target,
        path: [target],
        timestamp: 1,
      },
      {
        event: new MouseEvent('click'),
        host: target,
        target,
        path: [target],
        timestamp: 2,
      },
      {
        event: new MouseEvent('click'),
        host: target,
        target,
        path: [target],
        timestamp: 3,
      },
    ];

    replayQueue(queue);
    expect(clicks).toEqual([1, 2, 3]);
    expect(queue.length).toBe(0);

    target.remove();
  });

  it('resolves chunk paths using manifest and custom resolver', () => {
    const loaderWithManifest = new ResumableLoader({
      manifest: {
        'my-card': '/assets/card-abc.js',
      },
    });
    expect(loaderWithManifest.resolveChunk('my-card')).toBe('/assets/card-abc.js');
    expect(loaderWithManifest.resolveChunk('unknown-card')).toBe('/components/unknown-card.js');

    const loaderWithResolver = new ResumableLoader({
      chunkResolver: (tag) => `/dist/${tag}/bundle.js`,
    });
    expect(loaderWithResolver.resolveChunk('nav-bar')).toBe('/dist/nav-bar/bundle.js');
  });

  it('identifies un-upgraded custom elements in composed path', () => {
    const loader = new ResumableLoader();

    const normalDiv = document.createElement('div');
    const customHost = document.createElement('unupgraded-profile');

    const path = [normalDiv, customHost, document.body];
    const unupgraded = loader.findUnupgradedHosts(path);

    expect(unupgraded.length).toBe(1);
    expect(unupgraded[0]).toBe(customHost);
  });

  it('ignores replayed events to prevent infinite interception loops', async () => {
    const loader = new ResumableLoader();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    (event as any)[RESUMED_EVENT_FLAG] = true;

    const spy = vi.spyOn(event, 'preventDefault');
    await loader.handleEvent(event);

    expect(spy).not.toHaveBeenCalled();
  });

  it('attaches and cleans up listeners via start and stop', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const loader = initLoader({ preloadOnHover: true });
    expect(addSpy).toHaveBeenCalled();

    loader.stop();
    expect(removeSpy).toHaveBeenCalled();

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
