import { SourceMap } from 'node:module';

export interface SourceMapPayload {
  version: number;
  sources: string[];
  names?: string[];
  sourceRoot?: string;
  sourcesContent?: string[];
  mappings: string;
}

export interface MappedFrame {
  originalSource: string | null;
  originalLine: number | null;
  originalColumn: number | null;
  name: string | null;
  rawFrame: string;
}

/**
 * Parses stack trace string into mapped locations using the provided source map.
 */
export function mapStackTrace(rawStack: string, rawSourceMap: SourceMapPayload | string, bundleFileName = 'bundle.js'): { mappedStack: string; frames: MappedFrame[] } {
  const mapPayload: SourceMapPayload = typeof rawSourceMap === 'string' ? JSON.parse(rawSourceMap) : rawSourceMap;

  let sm: SourceMap;
  try {
    sm = new SourceMap(mapPayload as any);
  } catch {
    return { mappedStack: rawStack, frames: [] };
  }

  const lines = rawStack.split('\n');
  const mappedFrames: MappedFrame[] = [];
  const re = new RegExp(`${bundleFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`);

  const mappedLines = lines.map((line) => {
    const match = re.exec(line);
    if (!match) return line;

    const lineNum = Number.parseInt(match[1], 10);
    const colNum = Number.parseInt(match[2], 10);

    try {
      const entry = sm.findEntry(lineNum - 1, colNum - 1);
      if (entry && 'originalSource' in entry && entry.originalSource) {
        const origLine = (entry.originalLine ?? 0) + 1;
        const origCol = (entry.originalColumn ?? 0) + 1;
        const entryName = (entry as any).name;
        const origName = entryName ? ` (${entryName})` : '';

        mappedFrames.push({
          originalSource: entry.originalSource,
          originalLine: origLine,
          originalColumn: origCol,
          name: entryName || null,
          rawFrame: line,
        });

        return line.replace(match[0], `${entry.originalSource}:${origLine}:${origCol}${origName}`);
      }
    } catch {
      // Fall back to unmapped line
    }
    return line;
  });

  return {
    mappedStack: mappedLines.join('\n'),
    frames: mappedFrames,
  };
}
