/**
 * Ultra-compact keyed list reconciler (<300 bytes minified).
 * Performs DOM diffing and reordering for dynamic lists.
 */
export declare function reconcile<T>(container: Node, marker: Node, items: T[], keyFn: (item: T) => string | number, renderFn: (item: T) => Node, cache: Map<string | number, {
    node: Node;
    item: T;
}>): void;
