/**
 * Ultra-compact keyed list reconciler (<300 bytes minified).
 * Performs DOM diffing and reordering for dynamic lists.
 */
export function reconcile(container, marker, items, keyFn, renderFn, cache) {
    const newKeys = new Set();
    let before = marker;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = keyFn(item);
        newKeys.add(key);
        let entry = cache.get(key);
        if (!entry) {
            const node = renderFn(item);
            entry = { node, item };
            cache.set(key, entry);
        }
        if (entry.node.previousSibling !== before) {
            container.insertBefore(entry.node, before.nextSibling);
        }
        before = entry.node;
    }
    for (const [key, entry] of cache) {
        if (!newKeys.has(key)) {
            if (entry.node.parentNode) {
                entry.node.parentNode.removeChild(entry.node);
            }
            cache.delete(key);
        }
    }
}
