import { escapeAttribute, type SsrRenderContext } from './compiler-bridge.js';
import { getCtorSsrMeta } from './component/ctor-meta.js';
import { EMPTY_ADOPTED_URLS } from './render-constants.js';

export const SERVER_ELEMENT_SYMBOL = Symbol.for('@lit-core/server-elements/element');

export const SERVER_LOADER_SYMBOL = Symbol.for('@lit-core/server-elements/loader');

export const SERVER_ACTION_SYMBOL = Symbol.for('@lit-core/server-elements/action');

export function isServerElementClassOrInstance(Ctor: any, instance?: any): boolean {
  return Boolean(instance?.[SERVER_ELEMENT_SYMBOL] || Ctor?.[SERVER_ELEMENT_SYMBOL] || Ctor?.[SERVER_LOADER_SYMBOL] || Ctor?.[SERVER_ACTION_SYMBOL]);
}

export function isClientHydratableLitHost(Ctor: any, instance?: any): boolean {
  return Boolean(Ctor?._$litElement$) && !isServerElementClassOrInstance(Ctor, instance);
}

export function buildShadowStyleAndTemplateOpen(Ctor: any, context: SsrRenderContext): { templateOpenTag: string; styleTag: string; adoptKeys: string[]; adoptedUrls: string[] } {
  const urlResolver = context.adoptedStyleSheets?.urlResolver;
  if (!context.nonce && !urlResolver) {
    const meta = Ctor ? getCtorSsrMeta(Ctor) : null;
    const { styleTag, adoptKeys } = context.styleDeduplicator.resolveDefaultStyleTag(Ctor, context.cssFuse);
    return {
      templateOpenTag: meta ? meta.defaultTemplateOpenTag : '<template shadowrootmode="open">',
      styleTag,
      adoptKeys,
      adoptedUrls: EMPTY_ADOPTED_URLS,
    };
  }

  const nonceAttr = context.nonce ? ` nonce="${escapeAttribute(context.nonce)}"` : '';
  const shadowOpts = Ctor?.shadowRootOptions;
  const shadowMode = shadowOpts?.mode === 'closed' ? 'closed' : 'open';
  const delegatesAttr = shadowOpts?.delegatesFocus ? ' shadowrootdelegatesfocus' : '';

  if (urlResolver && context.cssFuse) {
    const { local: localStyles, sharedEntries } = context.compilerBridge.extractComponentStyles(Ctor);
    if (sharedEntries.length > 0) {
      const urls: string[] = [];
      for (const entry of sharedEntries) {
        const url = urlResolver(entry.key, entry.css);
        urls.push(url);
        context.styleDeduplicator.recordAdoptedUrlSheet(url, entry.css);
      }
      const escapedUrls = urls.map((u) => escapeAttribute(u));
      const adoptedAttr = ` shadowrootadoptedstylesheets="${escapedUrls.join(' ')}"`;
      const styleTag = localStyles.length > 0 ? `<style data-lit-local${nonceAttr}>${localStyles.join('\n')}</style>` : '';
      return {
        templateOpenTag: `<template shadowrootmode="${shadowMode}"${delegatesAttr}${adoptedAttr}>`,
        styleTag,
        adoptKeys: [],
        adoptedUrls: urls,
      };
    }
  }

  const resolved = context.styleDeduplicator.resolveComponentStyles(Ctor, context.cssFuse);
  let styleTag = '';

  // Emit first-occurrence shared sheets in exact declaration order before local overrides (Invariant #1)
  for (const entry of resolved.firstTimeShared) {
    styleTag += `<style data-lit-sheet="${escapeAttribute(entry.key)}"${nonceAttr}>${entry.css}</style>`;
  }

  if (resolved.localStyles.length > 0) {
    const localAttr = resolved.adoptedSharedKeys.length > 0 ? ' data-lit-local' : '';
    styleTag += `<style${localAttr}${nonceAttr}>${resolved.localStyles.join('\n')}</style>`;
  }

  return {
    templateOpenTag: `<template shadowrootmode="${shadowMode}"${delegatesAttr}>`,
    styleTag,
    adoptKeys: resolved.adoptedSharedKeys,
    adoptedUrls: [],
  };
}
