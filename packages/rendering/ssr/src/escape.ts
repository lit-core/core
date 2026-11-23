export const HTML_ESCAPE_RE = /[&<>"]/;

export const HTML_ESCAPE_GLOBAL_RE = /[&<>"]/g;

export const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function replaceHtmlChar(ch: string): string {
  return HTML_ESCAPE_MAP[ch];
}

export function escapeHtml(str: string): string {
  return HTML_ESCAPE_RE.test(str) ? str.replace(HTML_ESCAPE_GLOBAL_RE, replaceHtmlChar) : str;
}

export function escapeAttribute(str: string): string {
  return HTML_ESCAPE_RE.test(str) ? str.replace(HTML_ESCAPE_GLOBAL_RE, replaceHtmlChar) : str;
}
