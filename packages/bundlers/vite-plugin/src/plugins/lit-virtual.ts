import { resolveLitPrivateSsrSupportForVite } from '@lit-core/resumable/vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { extractLitCoreVirtualSubpath, formatVirtualLitCoreId, isVirtualLitCoreId, resolveFromVirtualOrigin } from '../utils.js';
import { getVirtualLitCoreModule } from '../virtual.js';

export function litVirtual(): Plugin {
  let config: ResolvedConfig | undefined;

  return {
    name: 'lit-virtual',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    resolveId(id, importer, resolveOpts) {
      if (id === 'lit-html/private-ssr-support.js') {
        const isSsr = Boolean(resolveOpts?.ssr || config?.build?.ssr);
        const conditions = config?.resolve?.conditions ?? [];
        const isDev = Boolean(conditions.includes('development') || (!conditions.includes('production') && config?.mode === 'development'));
        return resolveLitPrivateSsrSupportForVite(config?.root, isSsr, isDev, this as any, importer, resolveOpts as any);
      }
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
      }
      if (importer?.startsWith('\0') && !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !id.startsWith('virtual:')) {
        const resolved = resolveFromVirtualOrigin(id, undefined, config?.root);
        if (resolved) return resolved;
      }
      return undefined;
    },

    load(id) {
      if (isVirtualLitCoreId(id)) {
        const subpath = extractLitCoreVirtualSubpath(id);
        const code = getVirtualLitCoreModule(subpath);
        if (code) {
          return {
            code,
            map: null,
          };
        }
      }
      return undefined;
    },
  };
}

export const litVirtualPlugin = litVirtual;
