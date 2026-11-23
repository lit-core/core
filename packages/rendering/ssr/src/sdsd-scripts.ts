import { escapeAttribute } from './compiler-bridge.js';

/**
 * Standards-based inline swap helper for out-of-order Streaming Declarative Shadow DOM (SDSD).
 * Traverses nested shadow roots via `[data-lit-ssr="id"]`, optionally applies resolved host attributes,
 * and replaces `<!--$b:id-->...<!--/$b:id-->` comment range boundaries with the resolved `<template id="cN">`
 * content fragment, removing both comment markers and the temporary `<template>` element upon completion.
 */
export const SDSD_SWAP_SCRIPT =
  'var $s=(p,b,c,d=document,r=d,t=d.getElementById(c))=>{p.map(i=>r=r.querySelector(`[data-lit-ssr="${i}"]`).shadowRoot);p=d.createTreeWalker(r,128);while(c=p.nextNode())if(c.data=="$b:"+b){while((d=c.nextSibling)&&(d.remove(),d.data!="/$b:"+b));c.replaceWith(...(t.content||t).childNodes)}t.remove()}';

/**
 * Request-scoped shared `CSSStyleSheet` adoption helper for deduplicated constructable stylesheets.
 * Preserves cascade order `[sharedSheets, localOverrides]` across Chromium, Firefox, and Safari.
 */
export const CSS_ADOPT_SCRIPT =
  '$c=(r=document,m=window.__litCS||={})=>{for(const e of r.querySelectorAll("*")){const s=e.shadowRoot;if(s){for(const t of s.querySelectorAll("style[data-lit-sheet]")){const k=t.dataset.litSheet;if(k&&!m[k]){const c=new CSSStyleSheet();c.replaceSync(t.textContent||"");m[k]=c}}const a=e.dataset.litAdopt;if(a){delete e.dataset.litAdopt;const l=s.querySelector("style[data-lit-local]"),p=a.split(" ").map(k=>m[k]).filter(Boolean);if(l){const c=new CSSStyleSheet();c.replaceSync(l.textContent||"");l.remove();p.push(c)}if(p.length)s.adoptedStyleSheets=[...p,...s.adoptedStyleSheets]}$c(s,m)}}}';

export function formatSdsdBootstrapScript(nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  return `<script${nonceAttr}>${SDSD_SWAP_SCRIPT}</script>`;
}

export function formatCssAdoptScript(includeBootstrap: boolean, nonce?: string): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  return includeBootstrap ? `<script${nonceAttr}>${CSS_ADOPT_SCRIPT};$c()</script>` : `<script${nonceAttr}>$c()</script>`;
}

export function formatAdoptedUrlFallbackScript(entries: ReadonlyArray<{ url: string; css: string }>, nonce?: string): string {
  if (entries.length === 0) return '';
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  const payload = JSON.stringify(Object.fromEntries(entries.map((e) => [e.url, e.css]))).replace(/</g, '\\u003c');
  return `<script${nonceAttr}>if(!("shadowRootAdoptedStyleSheets"in HTMLTemplateElement.prototype)){const u=${payload},m=window.__litUS||={};for(const[k,v]of Object.entries(u))if(!m[k]){const c=new CSSStyleSheet();c.replaceSync(v);m[k]=c}const w=r=>{for(const e of r.querySelectorAll("*")){const s=e.shadowRoot;if(s){const a=e.dataset.litAdoptedUrls;if(a){delete e.dataset.litAdoptedUrls;const l=s.querySelector("style[data-lit-local]"),p=a.split(" ").map(k=>m[k]).filter(Boolean);if(l){const c=new CSSStyleSheet();c.replaceSync(l.textContent||"");l.remove();p.push(c)}if(p.length)s.adoptedStyleSheets=[...p,...s.adoptedStyleSheets]}w(s)}}};w(document)}</script>`;
}

export function formatSdsdTailChunk(
  chunkId: string,
  shadowPath: readonly number[],
  boundaryId: number,
  htmlContent: string,
  nonce?: string,
  isSvg?: boolean,
  hostAttributes?: Record<string, string | null>,
): string {
  const nonceAttr = nonce ? ` nonce="${escapeAttribute(nonce)}"` : '';
  const pathJson = `[${shadowPath.join(',')}]`;
  const tag = isSvg ? 'svg' : 'template';
  let hostPatch = '';
  if (hostAttributes && Object.keys(hostAttributes).length > 0 && shadowPath.length > 0) {
    const attrsJson = JSON.stringify(hostAttributes).replace(/</g, '\\u003c');
    hostPatch = `;(()=>{let r=document,h;for(const i of ${pathJson})h=r.querySelector(\`[data-lit-ssr="\${i}"]\`),r=h.shadowRoot;if(h){for(const[k,v]of Object.entries(${attrsJson}))v==null?h.removeAttribute(k):h.setAttribute(k,v);h.__litRebind?.()}})()`;
  }
  return `<${tag} id="${escapeAttribute(chunkId)}">${htmlContent}</${tag}><script${nonceAttr}>$s(${pathJson},${boundaryId},${JSON.stringify(chunkId)})${hostPatch}</script>`;
}
