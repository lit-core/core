export interface BufferedEvent {
  event: Event;
  host: HTMLElement;
  target: EventTarget | null;
  path: EventTarget[];
  timestamp: number;
}

export const RESUMED_EVENT_FLAG = '__lit_resumed__';

/**
 * Synthesize a new event mimicking the original intercepted event.
 */
export function createReplayedEvent(origEvent: Event): Event {
  const type = origEvent.type;
  const baseInit: EventInit = {
    bubbles: origEvent.bubbles ?? true,
    cancelable: origEvent.cancelable ?? true,
    composed: origEvent.composed ?? true,
  };

  let replayed: Event;

  try {
    if (typeof PointerEvent !== 'undefined' && origEvent instanceof PointerEvent) {
      replayed = new PointerEvent(type, {
        ...baseInit,
        clientX: origEvent.clientX,
        clientY: origEvent.clientY,
        screenX: origEvent.screenX,
        screenY: origEvent.screenY,
        button: origEvent.button,
        buttons: origEvent.buttons,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
        pointerId: origEvent.pointerId,
        pointerType: origEvent.pointerType,
        pressure: origEvent.pressure,
        tiltX: origEvent.tiltX,
        tiltY: origEvent.tiltY,
        width: origEvent.width,
        height: origEvent.height,
        isPrimary: origEvent.isPrimary,
      });
    } else if (typeof MouseEvent !== 'undefined' && origEvent instanceof MouseEvent) {
      replayed = new MouseEvent(type, {
        ...baseInit,
        clientX: origEvent.clientX,
        clientY: origEvent.clientY,
        screenX: origEvent.screenX,
        screenY: origEvent.screenY,
        button: origEvent.button,
        buttons: origEvent.buttons,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
      });
    } else if (typeof KeyboardEvent !== 'undefined' && origEvent instanceof KeyboardEvent) {
      replayed = new KeyboardEvent(type, {
        ...baseInit,
        key: origEvent.key,
        code: origEvent.code,
        location: origEvent.location,
        ctrlKey: origEvent.ctrlKey,
        shiftKey: origEvent.shiftKey,
        altKey: origEvent.altKey,
        metaKey: origEvent.metaKey,
        repeat: origEvent.repeat,
      });
    } else if (typeof FocusEvent !== 'undefined' && origEvent instanceof FocusEvent) {
      replayed = new FocusEvent(type, {
        ...baseInit,
        relatedTarget: origEvent.relatedTarget,
      });
    } else if (typeof CustomEvent !== 'undefined') {
      replayed = new CustomEvent(type, {
        ...baseInit,
        detail: (origEvent as any).detail,
      });
    } else {
      replayed = new Event(type, baseInit);
    }
  } catch {
    replayed = new CustomEvent(type, baseInit);
  }

  // Mark replayed event so loader ignores it
  Object.defineProperty(replayed, RESUMED_EVENT_FLAG, {
    value: true,
    enumerable: false,
    configurable: true,
  });

  return replayed;
}

/**
 * Dispatch a replayed event to its original target.
 */
export function replayEvent(buffered: BufferedEvent): boolean {
  const { event: origEvent, target, host } = buffered;
  const dispatchTarget = target && (target as Node).isConnected ? target : host;

  if (!dispatchTarget || typeof (dispatchTarget as any).dispatchEvent !== 'function') {
    return false;
  }

  const replayed = createReplayedEvent(origEvent);
  return (dispatchTarget as any).dispatchEvent(replayed);
}

/**
 * Replay an array of buffered events in FIFO order.
 */
export function replayQueue(queue: BufferedEvent[]): void {
  while (queue.length > 0) {
    const item = queue.shift();
    if (item) {
      replayEvent(item);
    }
  }
}
