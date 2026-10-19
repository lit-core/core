/**
 * Runtime helpers for dynamic Lit directives.
 */

export function _classMap(classes: Record<string, any> | null | undefined): string {
  if (!classes || typeof classes !== 'object') return '';
  return Object.entries(classes)
    .filter(([, val]) => Boolean(val))
    .map(([key]) => key)
    .join(' ');
}

export function _styleMap(styles: Record<string, any> | null | undefined): Record<string, any> {
  if (!styles || typeof styles !== 'object') return {};
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(styles)) {
    if (val === null || val === undefined) continue;
    if (key.startsWith('--')) {
      result[key] = val;
    } else {
      const camel = key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      result[camel] = val;
    }
  }
  return result;
}

export function _range(startOrEnd: number, end?: number, step = 1): number[] {
  const start = end === undefined ? 0 : startOrEnd;
  const stop = end === undefined ? startOrEnd : end;
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < stop; i += step) {
      result.push(i);
    }
  } else if (step < 0) {
    for (let i = start; i > stop; i += step) {
      result.push(i);
    }
  }
  return result;
}
