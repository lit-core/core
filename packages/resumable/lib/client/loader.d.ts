export interface LoaderOptions {
    /**
     * Tag name to chunk URL manifest map.
     */
    manifest?: Record<string, string>;
    /**
     * Custom function to resolve a tag name to a chunk URL.
     */
    chunkResolver?: (tagName: string) => string;
    /**
     * Preload component chunks on pointer hover.
     * @default true
     */
    preloadOnHover?: boolean;
    /**
     * Events to intercept for resumption.
     * @default ['click', 'input', 'change', 'keydown', 'submit', 'pointerdown', 'focusin', 'focusout']
     */
    events?: string[];
    /**
     * Callback fired when a component is upgraded.
     */
    onUpgrade?: (tagName: string) => void;
}
export declare const DEFAULT_RESUMPTION_EVENTS: string[];
/**
 * Client-side loader controller that manages interception, chunk loading, and event replay.
 */
export declare class ResumableLoader {
    private bufferedEvents;
    private loadingTags;
    private preloadedUrls;
    private manifest;
    private chunkResolver?;
    private preloadOnHover;
    private events;
    private cleanupFns;
    constructor(options?: LoaderOptions);
    /**
     * Resolve chunk URL for a custom element tag name.
     */
    resolveChunk(tagName: string): string;
    /**
     * Preload a component chunk via <link rel="modulepreload"> or dynamic import.
     */
    preload(tagName: string): void;
    /**
     * Load chunk and wait for custom element definition.
     */
    loadAndUpgrade(tagName: string): Promise<void>;
    /**
     * Find all un-upgraded custom element hosts in an event's composed path.
     */
    findUnupgradedHosts(path: EventTarget[]): HTMLElement[];
    /**
     * Handle an intercepted interaction event.
     */
    handleEvent(event: Event): Promise<void>;
    /**
     * Flush all buffered events.
     */
    flush(): void;
    /**
     * Attach interception listeners to window.
     */
    start(): () => void;
    /**
     * Stop intercepting and remove all attached listeners.
     */
    stop(): void;
}
/**
 * Initialize the loader in the current window.
 */
export declare function initLoader(options?: LoaderOptions): ResumableLoader;
/**
 * Generate the inline ~1.2 KB micro-loader script for injection into <head>.
 */
export declare function generateInlineLoader(manifest?: Record<string, string>, options?: {
    preloadOnHover?: boolean;
}): string;
//# sourceMappingURL=loader.d.ts.map