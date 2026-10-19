import type { Plugin } from 'vite';
import { extractLitCoreVirtualSubpath, formatVirtualLitCoreId, isVirtualLitCoreId } from '../utils.js';
import { getVirtualLitCoreModule } from '../virtual.js';

export function litVirtual(): Plugin {
  return {
    name: 'lit-virtual',
    enforce: 'pre',

    resolveId(id) {
      if (isVirtualLitCoreId(id)) {
        return formatVirtualLitCoreId(id);
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
