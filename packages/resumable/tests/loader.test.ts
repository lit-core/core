import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { compileResumableLoader } from '../src/client/compiler.js';
import { createReplayedEvent, RESUMED_EVENT_FLAG, replayEvent, replayQueue } from '../src/client/replay.js';

describe('resumable AOT compiler and inline microloader', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('generates a compact inline loader under 1.5 KB via oxc AST codegen', () => {
    const inlineScript = compileResumableLoader({
      manifest: { 'user-profile': '/assets/user-profile.js' },
    });
    expect(inlineScript).toBeTypeOf('string');
    expect(inlineScript.length).toBeGreaterThan(100);
    expect(inlineScript.length).toBeLessThan(1536); // Verify <=1.5 KB constraint
    expect(inlineScript).toContain('__lit_resumed__');
    expect(inlineScript).toContain('user-profile');
    expect(inlineScript).toContain('/assets/user-profile.js');
    // Ensure no naive /components/ fallback
    expect(inlineScript).not.toContain('/components/');
  });

  it('prunes idle hydration AST block when idle_hydration is false', () => {
    const scriptWithIdle = compileResumableLoader({
      manifest: { 'user-profile': '/assets/user-profile.js' },
      idleHydration: true,
    });
    const scriptWithoutIdle = compileResumableLoader({
      manifest: { 'user-profile': '/assets/user-profile.js' },
      idleHydration: false,
    });

    expect(scriptWithIdle).toContain('requestIdleCallback');
    expect(scriptWithoutIdle).not.toContain('requestIdleCallback');
    expect(scriptWithoutIdle.length).toBeLessThan(scriptWithIdle.length);
  });

  it('injects custom event list into AST array without string splicing', () => {
    const customEvents = ['dblclick', 'contextmenu'];
    const script = compileResumableLoader({
      manifest: { 'card-item': '/dist/card.js' },
      events: customEvents,
      preloadOnHover: false,
    });
    expect(script).toContain('dblclick');
    expect(script).toContain('contextmenu');
    expect(script).not.toContain('"click"');
    expect(script).not.toContain('"keydown"');
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

  it('executes compiled inline loader and intercepts interactions on unupgraded components', async () => {
    const script = compileResumableLoader({
      manifest: {
        'interactive-card': '/assets/card.js',
      },
      idleHydration: false,
    });

    // Execute compiled loader script in window context
    const runLoader = new Function(script);
    runLoader();

    const host = document.createElement('interactive-card');
    const button = document.createElement('button');
    button.textContent = 'Click me';
    host.appendChild(button);
    document.body.appendChild(host);

    let eventDispatchedAfterUpgrade = false;
    button.addEventListener('click', (e) => {
      if ((e as any)[RESUMED_EVENT_FLAG]) {
        eventDispatchedAfterUpgrade = true;
      }
    });

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);

    // Event is intercepted and held while component upgrades
    expect(eventDispatchedAfterUpgrade).toBe(false);

    // Simulate custom elements definition (as would happen when chunk loads)
    customElements.define('interactive-card', class extends HTMLElement {});

    // Wait for microtasks
    await new Promise((r) => setTimeout(r, 10));

    expect(eventDispatchedAfterUpgrade).toBe(true);

    host.remove();
  });
});
