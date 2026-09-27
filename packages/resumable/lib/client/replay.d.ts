export interface BufferedEvent {
    event: Event;
    host: HTMLElement;
    target: EventTarget | null;
    path: EventTarget[];
    timestamp: number;
}
export declare const RESUMED_EVENT_FLAG = "__lit_resumed__";
/**
 * Synthesize a new event mimicking the original intercepted event.
 */
export declare function createReplayedEvent(origEvent: Event): Event;
/**
 * Dispatch a replayed event to its original target.
 */
export declare function replayEvent(buffered: BufferedEvent): boolean;
/**
 * Replay an array of buffered events in FIFO order.
 */
export declare function replayQueue(queue: BufferedEvent[]): void;
//# sourceMappingURL=replay.d.ts.map