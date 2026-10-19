export interface ErrorLocation {
  line: number;
  column: number;
  file?: string;
}

export interface RollupErrorPayload {
  message: string;
  id?: string;
  loc?: ErrorLocation;
  pos?: number;
  stack?: string;
  cause?: unknown;
}

/**
 * Extracts line, column, and position from various error shapes (NAPI errors,
 * oxc diagnostics, lightningcss errors, syntax errors).
 */
export function extractErrorLocation(err: unknown): { loc?: ErrorLocation; pos?: number } {
  if (!err || typeof err !== 'object') {
    return {};
  }

  const anyErr = err as Record<string, any>;

  // Direct loc object: { line, column, file }
  if (anyErr.loc && typeof anyErr.loc.line === 'number') {
    return {
      loc: {
        line: anyErr.loc.line,
        column: anyErr.loc.column ?? 0,
        file: anyErr.loc.file,
      },
    };
  }

  // Direct line and column properties
  if (typeof anyErr.line === 'number') {
    return {
      loc: {
        line: anyErr.line,
        column: typeof anyErr.column === 'number' ? anyErr.column : typeof anyErr.col === 'number' ? anyErr.col : 0,
      },
    };
  }

  // Pos property
  if (typeof anyErr.pos === 'number') {
    return { pos: anyErr.pos };
  }

  // Parse line and column from error message string
  if (typeof anyErr.message === 'string') {
    const lineColMatch = anyErr.message.match(/(?::|\bline\s+)(\d+)(?::|,?\s*(?:col|column)?\s*)(\d+)/i);
    if (lineColMatch) {
      const line = Number.parseInt(lineColMatch[1], 10);
      const column = Number.parseInt(lineColMatch[2], 10);
      if (!Number.isNaN(line) && !Number.isNaN(column)) {
        return { loc: { line, column } };
      }
    }
  }

  return {};
}

/**
 * Reports a build failure to Rollup/Vite via this.error(...) with source location.
 * Falls back to throwing a standard Error if called outside a Rollup plugin context.
 */
export function reportTransformError(context: any, pluginName: string, id: string, err: unknown): never {
  const cleanId = id.split('?')[0] ?? id;
  const rawMessage = err instanceof Error ? err.message : typeof (err as any)?.message === 'string' ? (err as any).message : String(err);
  const { loc, pos } = extractErrorLocation(err);

  const errorPayload: RollupErrorPayload = {
    message: `[${pluginName}] Transform failed for ${cleanId}: ${rawMessage}`,
    id: cleanId,
    ...(loc ? { loc } : {}),
    ...(pos !== undefined ? { pos } : {}),
    stack: err instanceof Error ? err.stack : undefined,
    cause: err,
  };

  if (context && typeof context.error === 'function') {
    context.error(errorPayload);
  }

  const fallbackError = new Error(errorPayload.message);
  Object.assign(fallbackError, errorPayload);
  throw fallbackError;
}
