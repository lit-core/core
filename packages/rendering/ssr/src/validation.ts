export const VALID_TAG_NAME_RE = /^[a-z][a-z0-9._-]*$/;

export const VALID_ATTR_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;

export const validTagCache = new Set<string>();

export const validAttrCache = new Set<string>();

export function isValidTagName(name: string): boolean {
  if (validTagCache.has(name)) return true;
  if (VALID_TAG_NAME_RE.test(name)) {
    validTagCache.add(name);
    return true;
  }
  return false;
}

export function isValidAttrName(name: string): boolean {
  if (validAttrCache.has(name)) return true;
  if (VALID_ATTR_NAME_RE.test(name)) {
    validAttrCache.add(name);
    return true;
  }
  return false;
}
