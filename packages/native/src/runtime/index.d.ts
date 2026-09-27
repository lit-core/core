/**
 * Ultra-lightweight micro-runtime base class for Mode B native Web Components.
 * Provides microtask-batched reactive updates and DOM path resolution.
 */
export declare class NativeElement extends HTMLElement {
    static observedAttributes: string[];
    protected __dirty: number;
    protected __scheduled: boolean;
    constructor();
    /**
     * Request an asynchronous update with property bitmask.
     */
    requestUpdate(bit?: number): void;
    /**
     * Subclass-overridden reactive DOM update routine.
     */
    protected __update(_mask: number): void;
    /**
     * Ahead-of-time precomputed DOM child path resolver.
     * Eliminates runtime TreeWalker traversal by direct indexing.
     */
    protected __resolve(root: Node, paths: number[][]): Node[];
}
