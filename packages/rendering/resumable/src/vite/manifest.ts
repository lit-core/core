import { extractCustomElementTagsAst } from '../compiler/index.js';

export interface ManifestOptions {
  chunkResolver?: (tagName: string) => string;
  basePath?: string;
}

/**
 * Scan source code or chunk code to extract defined custom element tag names
 * using the native OXC AST and semantic binding analyzer.
 */
export function extractCustomElementTags(code: string, filename?: string): string[] {
  return extractCustomElementTagsAst(code, filename);
}

/**
 * Build tag-to-chunk manifest from a map of chunks.
 */
export function buildManifest(chunkMap: Map<string, string[]> | Record<string, string[]>, options: ManifestOptions = {}): Record<string, string> {
  const manifest: Record<string, string> = {};
  const basePath = options.basePath ? options.basePath.replace(/\/+$/, '') : '';

  const entries = chunkMap instanceof Map ? Array.from(chunkMap.entries()) : Object.entries(chunkMap);

  for (const [chunkFileName, tags] of entries) {
    const chunkUrl = basePath ? `${basePath}/${chunkFileName.replace(/^\/+/, '')}` : `/${chunkFileName.replace(/^\/+/, '')}`;
    for (const tag of tags) {
      if (options.chunkResolver) {
        manifest[tag] = options.chunkResolver(tag);
      } else {
        manifest[tag] = chunkUrl;
      }
    }
  }

  return manifest;
}
