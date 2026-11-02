/**
 * Ahead-of-time structural DOM path resolver helper.
 * Traverses native C++ .childNodes pointers in nanoseconds, eliminating
 * runtime TreeWalker comment-node and element discovery during component mount.
 *
 * @param root The root container node (ShadowRoot, DocumentFragment, or Element)
 * @param path Array of child indices from root to the target node
 * @returns The resolved DOM Node
 */
export declare function resolveNodeByPath(root: Node, path: number[]): Node;
/**
 * Resolves multiple target nodes from an array of precomputed structural paths.
 *
 * @param root The root container node
 * @param paths Array of child index paths
 * @returns Array of resolved DOM Nodes
 */
export declare function resolveNodesByPaths(root: Node, paths: number[][]): Node[];
/**
 * Prepares component parts directly via precomputed structural paths,
 * bypassing document.createTreeWalker.
 *
 * @param root The root container node (e.g. this.shadowRoot)
 * @param paths Precomputed static __litPartPaths
 * @param callback Callback invoked for each resolved part node
 */
export declare function preparePartsWithPaths<T = Node>(root: Node, paths: number[][], callback?: (node: Node, index: number) => T): T[];
/**
 * Resolves the parent element for a sole text child part, enabling fast O(1)
 * direct updates via parentEl.textContent = val without indexing child nodes.
 *
 * @param root The root container node (ShadowRoot or Element)
 * @param parentPath Structural child index path to the parent element
 * @returns The resolved parent Element
 */
export declare function resolveSoleTextParent(root: Node, parentPath: number[]): Element;
/**
 * Resolves the start and end markers (<?start name="pN"> and <?end>)
 * for a range-addressed dynamic expression, supporting both ProcessingInstruction
 * nodes (WHATWG HTML5 / WICG type 7) and Comment nodes (type 8).
 *
 * @param root The root container node (ShadowRoot or Element)
 * @param markerName Name of the part (e.g. "p0")
 * @param startPath Optional direct structural path to the start marker
 * @returns Object containing the start and end marker Nodes
 */
export declare function resolveRangeMarkers(root: Node, markerName: string, startPath?: number[]): {
    start: Node;
    end: Node;
};
