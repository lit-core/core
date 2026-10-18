/**
 * Unwraps Web Component :host(...) pseudo-classes into standard element selectors
 * for SSR / light DOM styling, accurately preserving nested parentheses in :not(...)
 * and compound selectors, while correctly neutralizing impossible sibling host
 * combinators (:host + :host) that cannot match in native Shadow DOM.
 */
export function transformHostCss(css: string, fallbackHost = ''): string {
  let result = '';
  let i = 0;
  let sawHost = false;
  let sawSiblingCombinator = false;

  while (i < css.length) {
    if (css.startsWith(':host(', i)) {
      i += 6;
      const start = i;
      let depth = 1;
      while (i < css.length && depth > 0) {
        if (css[i] === '(') depth++;
        else if (css[i] === ')') depth--;
        i++;
      }
      const inner = css.slice(start, i - 1);
      if (sawHost && sawSiblingCombinator) {
        result += ':not(*)';
      } else {
        result += inner;
      }
      sawHost = true;
      sawSiblingCombinator = false;
    } else if (css.startsWith(':host', i)) {
      if (sawHost && sawSiblingCombinator) {
        result += ':not(*)';
      } else {
        result += fallbackHost;
      }
      i += 5;
      sawHost = true;
      sawSiblingCombinator = false;
    } else {
      const ch = css[i];
      if (ch === '+' || ch === '~') {
        sawSiblingCombinator = true;
      } else if (ch !== ' ' && ch !== '\t' && ch !== '\n') {
        sawHost = false;
        sawSiblingCombinator = false;
      }
      result += ch;
      i++;
    }
  }
  return result;
}
