const CUSTOM_ELEMENT_REGEX = /(?:@customElement\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)|customElements\.define\s*\(\s*['"]([a-zA-Z0-9_-]+)['"])/g;
/**
 * Scan source code or chunk code to extract defined custom element tag names.
 */
export function extractCustomElementTags(code) {
    const tags = new Set();
    let match;
    // Reset regex index
    CUSTOM_ELEMENT_REGEX.lastIndex = 0;
    while ((match = CUSTOM_ELEMENT_REGEX.exec(code)) !== null) {
        const tag = match[1] || match[2];
        if (tag && tag.includes('-')) {
            tags.add(tag.toLowerCase());
        }
    }
    return Array.from(tags);
}
/**
 * Build tag-to-chunk manifest from a map of chunks.
 */
export function buildManifest(chunkMap, options = {}) {
    const manifest = {};
    const basePath = options.basePath ? options.basePath.replace(/\/+$/, '') : '';
    const entries = chunkMap instanceof Map ? Array.from(chunkMap.entries()) : Object.entries(chunkMap);
    for (const [chunkFileName, tags] of entries) {
        const chunkUrl = basePath ? `${basePath}/${chunkFileName.replace(/^\/+/, '')}` : `/${chunkFileName.replace(/^\/+/, '')}`;
        for (const tag of tags) {
            if (options.chunkResolver) {
                manifest[tag] = options.chunkResolver(tag);
            }
            else {
                manifest[tag] = chunkUrl;
            }
        }
    }
    return manifest;
}
//# sourceMappingURL=manifest.js.map