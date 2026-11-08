import { createReplayedEventInternal, RESUMED_EVENT_FLAG_INTERNAL, replayEventInternal, replayQueueInternal } from './hydrate.js';

export interface BufferedInteraction {
  event: Event;
  host: HTMLElement;
  target: Element;
  path: EventTarget[];
  timestamp: number;
}

export const RESUMED_EVENT_FLAG: string = RESUMED_EVENT_FLAG_INTERNAL;
export const createReplayedEvent: (origEvent: Event) => Event = createReplayedEventInternal;
export const replayEvent: (buffered: BufferedInteraction) => boolean = replayEventInternal;
export const replayQueue: (queue: BufferedInteraction[]) => void = replayQueueInternal;
