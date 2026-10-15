export interface ManifestOptions {
  chunkResolver?: (tagName: string) => string;
  basePath?: string;
}

const CUSTOM_ELEMENT_REGEX = /(?:@?customElement\s*\(\s*['"]([a-zA-Z0-9_-]+)['"]\s*\)|customElements\.define\s*\(\s*['"]([a-zA-Z0-9_-]+)['"])/g;

/**
 * Scan source code or chunk code to extract defined custom element tag names.
 */
export function extractCustomElementTags(code: string): string[] {
  const tags = new Set<string>();

  // Documentation examples in comments must not register tags. Only block comments and
  // whole-line comments are stripped, so `//` inside strings or minified code is untouched.
  const scanned = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  // Reset regex index
  CUSTOM_ELEMENT_REGEX.lastIndex = 0;
  let match = CUSTOM_ELEMENT_REGEX.exec(scanned);
  while (match !== null) {
    const tag = match[1] || match[2];
    if (tag?.includes('-')) {
      tags.add(tag.toLowerCase());
    }
    match = CUSTOM_ELEMENT_REGEX.exec(scanned);
  }

  return Array.from(tags);
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
