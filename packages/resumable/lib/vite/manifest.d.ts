export interface ManifestOptions {
    chunkResolver?: (tagName: string) => string;
    basePath?: string;
}
/**
 * Scan source code or chunk code to extract defined custom element tag names.
 */
export declare function extractCustomElementTags(code: string): string[];
/**
 * Build tag-to-chunk manifest from a map of chunks.
 */
export declare function buildManifest(chunkMap: Map<string, string[]> | Record<string, string[]>, options?: ManifestOptions): Record<string, string>;
//# sourceMappingURL=manifest.d.ts.map