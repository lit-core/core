import { escapeAttribute, installIsolateGlobals, renderToString, StyleDeduplicator } from '@lit-core/ssr';
import { escapeJsonForHtml } from '../crypto.js';
import type { ServerElementClass } from '../metadata.js';
import { resolveMandatorySecret } from '../secret.js';
import type { Constructor, ServerElementRenderOptions, ServerElementRenderResult } from '../types.js';
import { allocateHostId } from './host-id.js';
import { type PreparedServerElement, prepareServerElement } from './pipeline.js';
import { brandRenderResult } from './render-result.js';

function resolveTagName(tagOrCtor: string | Constructor<any>, Ctor: any): string {
  if (typeof tagOrCtor === 'string') return tagOrCtor.toLowerCase();
  return Ctor.is?.toLowerCase() || Ctor.tagName?.toLowerCase() || 'server-element';
}

/** Serializes host attributes, skipping removed ones and (outside DSD) an empty state attribute. */
function serializeHostAttributes(prepared: PreparedServerElement, isDsd: boolean): string {
  let html = '';
  for (const [name, value] of Object.entries(prepared.hostAttributes)) {
    if (value === null) continue;
    if (!isDsd && name === 'data-lit-state' && Object.keys(prepared.state).length === 0) continue;
    html += ` ${name}="${escapeAttribute(name === 'data-lit-state' ? escapeJsonForHtml(value) : value)}"`;
  }
  return html;
}

function renderStyles(Ctor: unknown): string {
  const { sharedSheets, localStyles } = new StyleDeduplicator().processComponentStyles(Ctor as never);
  const styles = [...sharedSheets, ...localStyles];
  return styles.length > 0 ? `<style>${styles.join('\n')}</style>` : '';
}

/**
 * Instantiates a server element, injects context, executes loaders, runs Lit lifecycle and reflection,
 * signs state, and renders Declarative Shadow DOM.
 */
export async function renderServerElement(tagOrCtor: string | Constructor<any>, props: Record<string, unknown> = {}, options: ServerElementRenderOptions = {}): Promise<ServerElementRenderResult> {
  installIsolateGlobals();
  const customElements = options.customElements ?? (globalThis as any).customElements;
  const Ctor: ServerElementClass | undefined = typeof tagOrCtor === 'string' ? customElements?.get(tagOrCtor) : (tagOrCtor as ServerElementClass);

  if (!Ctor) {
    throw new Error(`[@lit-core/server-elements] Custom element constructor for '${typeof tagOrCtor === 'string' ? tagOrCtor : 'Unknown'}' not found.`);
  }

  const tagName = resolveTagName(tagOrCtor, Ctor);
  const secret = resolveMandatorySecret(options);
  const hostId = allocateHostId(options);
  const prepared = await prepareServerElement(new Ctor(), Ctor, tagName, props, hostId, options, secret);

  const mode = options.mode ?? 'dsd';
  const isDsd = mode === 'dsd';
  const shadowMarkup = prepared.shadowRenderResult == null ? '' : renderToString(prepared.shadowRenderResult, { mode, customElements, resumable: false });
  const shadowContent = `${renderStyles(Ctor)}${shadowMarkup}`;
  const attrs = serializeHostAttributes(prepared, isDsd);
  const html = isDsd ? `<${tagName}${attrs}><template shadowrootmode="open">${shadowContent}</template></${tagName}>` : `<${tagName}${attrs}>${shadowContent}</${tagName}>`;

  return brandRenderResult({ tagName, hostId, html, state: prepared.state, sig: prepared.sig, token: prepared.token });
}
