import type { Plugin } from 'vite';
export interface ResumableOptions {
    /**
     * Include glob patterns for resumable components.
     */
    include?: string[];
    /**
     * Exclude glob patterns.
     */
    exclude?: string[];
    /**
     * Preload component chunks on idle or hover.
     * @default true
     */
    preloadOnHover?: boolean;
    /**
     * Custom chunk URL resolver.
     */
    chunkResolver?: (tagName: string) => string;
    /**
     * Automatically inject the client adapter into component modules.
     * @default true
     */
    injectAdapter?: boolean;
}
export declare function resumable(options?: ResumableOptions): Plugin;
export declare const litResumable: typeof resumable;
export default resumable;
//# sourceMappingURL=index.d.ts.map