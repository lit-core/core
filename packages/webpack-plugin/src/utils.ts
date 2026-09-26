export const VIRTUAL_FUSED_PREFIX = 'virtual:css-fuse/';
export const RESOLVED_FUSED_PREFIX = '\0virtual:css-fuse/';

const LEGACY_VIRTUAL_PREFIX = 'virtual:lit-css-fuse/';
const LEGACY_RESOLVED_PREFIX = '\0virtual:lit-css-fuse/';

export const VIRTUAL_HTML_FUSED_PREFIX = 'virtual:html-fuse/';
export const RESOLVED_HTML_FUSED_PREFIX = '\0virtual:html-fuse/';

export const BARE_FUSED_ID_REGEX = /^_fused_[a-zA-Z0-9_-]+(?:\.js)?$/;
export const BARE_HTML_FUSED_ID_REGEX = /^_fused_(?:html|svg)_[a-zA-Z0-9_-]+(?:\.js)?$/;

export function formatVirtualId(id: string): string {
  if (isVirtualHtmlFusedId(id)) {
    return id;
  }
  if (id.startsWith(VIRTUAL_FUSED_PREFIX)) {
    return RESOLVED_FUSED_PREFIX + id.slice(VIRTUAL_FUSED_PREFIX.length);
  }
  if (id.startsWith(LEGACY_VIRTUAL_PREFIX)) {
    return RESOLVED_FUSED_PREFIX + id.slice(LEGACY_VIRTUAL_PREFIX.length);
  }
  if (BARE_FUSED_ID_REGEX.test(id)) {
    const filename = id.endsWith('.js') ? id : `${id}.js`;
    return RESOLVED_FUSED_PREFIX + filename;
  }
  return id;
}

export function isVirtualFusedId(id: string): boolean {
  if (isVirtualHtmlFusedId(id)) {
    return false;
  }
  return id.startsWith(VIRTUAL_FUSED_PREFIX) || id.startsWith(RESOLVED_FUSED_PREFIX) || id.startsWith(LEGACY_VIRTUAL_PREFIX) || id.startsWith(LEGACY_RESOLVED_PREFIX) || BARE_FUSED_ID_REGEX.test(id);
}

export function extractSheetId(resolvedId: string): string {
  if (resolvedId.startsWith(RESOLVED_FUSED_PREFIX)) {
    return resolvedId.slice(RESOLVED_FUSED_PREFIX.length);
  }
  if (resolvedId.startsWith(LEGACY_RESOLVED_PREFIX)) {
    return resolvedId.slice(LEGACY_RESOLVED_PREFIX.length);
  }
  if (resolvedId.startsWith(VIRTUAL_FUSED_PREFIX)) {
    return resolvedId.slice(VIRTUAL_FUSED_PREFIX.length);
  }
  if (resolvedId.startsWith(LEGACY_VIRTUAL_PREFIX)) {
    return resolvedId.slice(LEGACY_VIRTUAL_PREFIX.length);
  }
  return resolvedId;
}

export function formatVirtualHtmlId(id: string): string {
  if (id.startsWith(VIRTUAL_HTML_FUSED_PREFIX)) {
    return RESOLVED_HTML_FUSED_PREFIX + id.slice(VIRTUAL_HTML_FUSED_PREFIX.length);
  }
  if (id.startsWith('virtual:lit-html-fuse/')) {
    return RESOLVED_HTML_FUSED_PREFIX + id.slice('virtual:lit-html-fuse/'.length);
  }
  if (BARE_HTML_FUSED_ID_REGEX.test(id)) {
    const filename = id.endsWith('.js') ? id : `${id}.js`;
    return RESOLVED_HTML_FUSED_PREFIX + filename;
  }
  return id;
}

export function isVirtualHtmlFusedId(id: string): boolean {
  return (
    id.startsWith(VIRTUAL_HTML_FUSED_PREFIX) ||
    id.startsWith(RESOLVED_HTML_FUSED_PREFIX) ||
    id.startsWith('virtual:lit-html-fuse/') ||
    id.startsWith('\0virtual:lit-html-fuse/') ||
    BARE_HTML_FUSED_ID_REGEX.test(id)
  );
}

export function extractHtmlTemplateId(resolvedId: string): string {
  if (resolvedId.startsWith(RESOLVED_HTML_FUSED_PREFIX)) {
    return resolvedId.slice(RESOLVED_HTML_FUSED_PREFIX.length);
  }
  if (resolvedId.startsWith('\0virtual:lit-html-fuse/')) {
    return resolvedId.slice('\0virtual:lit-html-fuse/'.length);
  }
  if (resolvedId.startsWith(VIRTUAL_HTML_FUSED_PREFIX)) {
    return resolvedId.slice(VIRTUAL_HTML_FUSED_PREFIX.length);
  }
  if (resolvedId.startsWith('virtual:lit-html-fuse/')) {
    return resolvedId.slice('virtual:lit-html-fuse/'.length);
  }
  return resolvedId;
}

const globRegexCache = new Map<string, RegExp>();

export function globToRegex(glob: string): RegExp {
  const cached = globRegexCache.get(glob);
  if (cached) return cached;

  let regexStr = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '/' || c === '\\') {
      regexStr += '[/\\\\]';
    } else if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/' || glob[i + 1] === '\\') {
          i++;
          regexStr += '(?:.*[/\\\\])?';
        } else {
          regexStr += '.*';
        }
      } else {
        regexStr += '[^/\\\\]*';
      }
    } else if (c === '?') {
      regexStr += '[^/\\\\]';
    } else if (['.', '+', '^', '$', '(', ')', '|', '{', '}'].includes(c)) {
      regexStr += `\\${c}`;
    } else {
      regexStr += c;
    }
  }

  const prefix = glob.startsWith('*') || glob.startsWith('/') || glob.startsWith('\\') ? '^' : '(?:^|[/\\\\])';
  const re = new RegExp(`${prefix}${regexStr}$`);
  globRegexCache.set(glob, re);
  return re;
}

export function matchesPattern(cleanId: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) {
    return pattern.test(cleanId);
  }
  if (typeof pattern === 'string') {
    if (pattern.includes('*') || pattern.includes('?')) {
      return globToRegex(pattern).test(cleanId);
    }
    return cleanId.includes(pattern);
  }
  return false;
}
