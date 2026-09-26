export const VIRTUAL_FUSED_PREFIX = 'virtual:css-fuse/';
export const RESOLVED_FUSED_PREFIX = '\0virtual:css-fuse/';

const LEGACY_VIRTUAL_PREFIX = 'virtual:lit-css-fuse/';
const LEGACY_RESOLVED_PREFIX = '\0virtual:lit-css-fuse/';

export function formatVirtualId(id: string): string {
  if (id.startsWith(VIRTUAL_FUSED_PREFIX)) {
    return RESOLVED_FUSED_PREFIX + id.slice(VIRTUAL_FUSED_PREFIX.length);
  }
  if (id.startsWith(LEGACY_VIRTUAL_PREFIX)) {
    return RESOLVED_FUSED_PREFIX + id.slice(LEGACY_VIRTUAL_PREFIX.length);
  }
  if (id.startsWith('_fused_')) {
    const filename = id.endsWith('.js') ? id : `${id}.js`;
    return RESOLVED_FUSED_PREFIX + filename;
  }
  return id;
}

export function isVirtualFusedId(id: string): boolean {
  return (
    id.startsWith(VIRTUAL_FUSED_PREFIX) ||
    id.startsWith(RESOLVED_FUSED_PREFIX) ||
    id.startsWith(LEGACY_VIRTUAL_PREFIX) ||
    id.startsWith(LEGACY_RESOLVED_PREFIX) ||
    id.startsWith('_fused_') ||
    id.startsWith('\0css-fuse:') ||
    id.startsWith('\0lit-css-fuse:')
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
