import type { FuseResult } from '@lit-core/css-fuse';
import type { HtmlFuseResult } from '@lit-core/html-fuse';
import { matchesPattern } from '../utils.js';

export interface TransformResult {
  code: string;
  map?: unknown;
}

export interface OptimizationResult {
  fuseResult: FuseResult;
  virtualSheets: Map<string, string>;
  transformedFiles: Map<string, string>;
}

export interface HtmlOptimizationResult {
  fuseResult: HtmlFuseResult;
  virtualTemplates: Map<string, string>;
  transformedFiles: Map<string, string>;
}

export function shouldProcessFile(
  id: string,
  options: {
    include?: (string | RegExp)[] | string | RegExp;
    exclude?: (string | RegExp)[] | string | RegExp;
  },
): boolean {
  const cleanId = id.split('?')[0] ?? id;
  if (!/\.[jt]sx?$/.test(cleanId)) {
    return false;
  }

  if (options.exclude) {
    const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
    for (const pattern of excludes) {
      if (matchesPattern(cleanId, pattern)) return false;
    }
  } else if (!options.include && cleanId.includes('/node_modules/')) {
    return false;
  }

  if (options.include) {
    const includes = Array.isArray(options.include) ? options.include : [options.include];
    const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
    if (!matched) return false;
  }

  return true;
}
