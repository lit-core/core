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

export class TransformError extends Error {
  readonly plugin: string;
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly loc?: { line: number; column: number };

  constructor(plugin: string, file: string, err: unknown) {
    const origMessage = err instanceof Error ? err.message : typeof (err as any)?.message === 'string' ? (err as any).message : String(err);
    super(`[${plugin}] Transform failed on ${file}: ${origMessage}`);
    this.name = 'TransformError';
    this.plugin = plugin;
    this.file = file;

    const anyErr = err as any;
    let line = anyErr?.line ?? anyErr?.loc?.line;
    let column = anyErr?.column ?? anyErr?.loc?.column ?? anyErr?.col;
    if (typeof line !== 'number' && typeof origMessage === 'string') {
      const lineColMatch = origMessage.match(/(?::|\bline\s+)(\d+)(?::|,?\s*(?:col|column)?\s*)(\d+)/i);
      if (lineColMatch) {
        const parsedLine = Number.parseInt(lineColMatch[1], 10);
        const parsedCol = Number.parseInt(lineColMatch[2], 10);
        if (!Number.isNaN(parsedLine) && !Number.isNaN(parsedCol)) {
          line = parsedLine;
          column = parsedCol;
        }
      }
    }
    if (typeof line === 'number') this.line = line;
    if (typeof column === 'number') this.column = column;
    if (typeof line === 'number' && typeof column === 'number') {
      this.loc = { line, column };
    }

    if (err instanceof Error && err.stack) {
      this.stack = err.stack;
    }
  }
}
