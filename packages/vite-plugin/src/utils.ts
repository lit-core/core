export const VIRTUAL_FUSED_PREFIX = 'virtual:css-fuse/';
export const RESOLVED_FUSED_PREFIX = '\0virtual:css-fuse/';

const LEGACY_VIRTUAL_PREFIX = 'virtual:lit-css-fuse/';
const LEGACY_RESOLVED_PREFIX = '\0virtual:lit-css-fuse/';

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
  const match = id.match(/_fused_[a-zA-Z0-9_-]+(?:\.js)?/);
  if (match) {
    const filename = match[0].endsWith('.js') ? match[0] : `${match[0]}.js`;
    return RESOLVED_FUSED_PREFIX + filename;
  }
  return id;
}

export function isVirtualFusedId(id: string): boolean {
  if (isVirtualHtmlFusedId(id)) {
    return false;
  }
  const normalized = id.replace(/^\.\//, '');
  return (
    id.startsWith(VIRTUAL_FUSED_PREFIX) ||
    id.startsWith(RESOLVED_FUSED_PREFIX) ||
    id.startsWith(LEGACY_VIRTUAL_PREFIX) ||
    id.startsWith(LEGACY_RESOLVED_PREFIX) ||
    id.startsWith('_fused_') ||
    id.startsWith('\0css-fuse:') ||
    id.startsWith('\0lit-css-fuse:') ||
    normalized.startsWith('.fused/_fused_') ||
    id.includes('/.fused/_fused_') ||
    id.includes('/_fused_') ||
    /_fused_[a-zA-Z0-9_-]+/.test(id)
  );
}

export function extractSheetId(resolvedId: string): string {
  if (resolvedId.startsWith(RESOLVED_FUSED_PREFIX)) {
    return resolvedId.slice(RESOLVED_FUSED_PREFIX.length);
  }
  if (resolvedId.startsWith(LEGACY_RESOLVED_PREFIX)) {
    return resolvedId.slice(LEGACY_RESOLVED_PREFIX.length);
  }
  if (resolvedId.startsWith('\0css-fuse:')) {
    return resolvedId.slice('\0css-fuse:'.length);
  }
  if (resolvedId.startsWith('\0lit-css-fuse:')) {
    return resolvedId.slice('\0lit-css-fuse:'.length);
  }
  return resolvedId;
}

export const VIRTUAL_HTML_FUSED_PREFIX = 'virtual:html-fuse/';
export const RESOLVED_HTML_FUSED_PREFIX = '\0virtual:html-fuse/';

export function formatVirtualHtmlId(id: string): string {
  if (id.startsWith(VIRTUAL_HTML_FUSED_PREFIX)) {
    return RESOLVED_HTML_FUSED_PREFIX + id.slice(VIRTUAL_HTML_FUSED_PREFIX.length);
  }
  const match = id.match(/_fused_(?:html|svg)_[a-zA-Z0-9_-]+(?:\.js)?/);
  if (match) {
    const filename = match[0].endsWith('.js') ? match[0] : `${match[0]}.js`;
    return RESOLVED_HTML_FUSED_PREFIX + filename;
  }
  return id;
}

export function isVirtualHtmlFusedId(id: string): boolean {
  const normalized = id.replace(/^\.\//, '');
  return (
    id.startsWith(VIRTUAL_HTML_FUSED_PREFIX) ||
    id.startsWith(RESOLVED_HTML_FUSED_PREFIX) ||
    id.startsWith('_fused_html_') ||
    id.startsWith('_fused_svg_') ||
    normalized.startsWith('.fused-html/_fused_') ||
    id.includes('/.fused-html/_fused_') ||
    /_fused_(?:html|svg)_[a-zA-Z0-9_-]+/.test(id)
  );
}

export function extractHtmlTemplateId(resolvedId: string): string {
  if (resolvedId.startsWith(RESOLVED_HTML_FUSED_PREFIX)) {
    return resolvedId.slice(RESOLVED_HTML_FUSED_PREFIX.length);
  }
  return resolvedId;
}

