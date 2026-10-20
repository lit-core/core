import fs from 'node:fs';
import path from 'node:path';
import { scanTags, transformTagShake } from '@lit-core/tag-shake';
import type { Plugin } from 'vite';
import { reportTransformError } from '../errors.js';
import type { TagShakeOptions } from '../options.js';
import { matchesPattern } from '../utils.js';

const TAG_SHAKE_FAST_CHECK = /\.define\(|customElement|decorate|\bclass\b/;
const RELATIVE_IMPORT_RE = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+)['"](\.\.?\/[^'"]+)['"]/g;

function resolveRelativeFile(fromFile: string, relSpec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), relSpec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.js`, `${base}.ts`, path.join(base, 'index.js'), path.join(base, 'index.ts')];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        return c;
      }
    } catch {}
  }
  return null;
}

export function tagShake(options: TagShakeOptions = {}): Plugin {
  const { sourcemap = true, keepTags = [] } = options;
  const usedTags = new Set<string>(keepTags);
  const scannedTransitiveFiles = new Set<string>();

  function collectTransitiveTags(sourceCode: string, filePath: string, depth = 0) {
    if (depth > 3 || scannedTransitiveFiles.has(filePath)) {
      return;
    }
    scannedTransitiveFiles.add(filePath);
    try {
      const tags = scanTags(sourceCode, filePath);
      for (const t of tags) {
        usedTags.add(t);
      }
    } catch {}

    RELATIVE_IMPORT_RE.lastIndex = 0;
    const specs: string[] = [];
    let match = RELATIVE_IMPORT_RE.exec(sourceCode);
    while (match !== null) {
      if (match[1]) {
        specs.push(match[1]);
      }
      match = RELATIVE_IMPORT_RE.exec(sourceCode);
    }

    for (const relSpec of specs) {
      const targetFile = resolveRelativeFile(filePath, relSpec);
      if (targetFile && !scannedTransitiveFiles.has(targetFile)) {
        try {
          const targetCode = fs.readFileSync(targetFile, 'utf-8');
          collectTransitiveTags(targetCode, targetFile, depth + 1);
        } catch {}
      }
    }
  }

  return {
    name: 'tag-shake',
    enforce: 'post',

    buildStart() {
      usedTags.clear();
      scannedTransitiveFiles.clear();
      for (const t of keepTags) {
        usedTags.add(t);
      }
    },

    transform(code: string, id: string) {
      const cleanId = id.split('?')[0] ?? id;

      // 1. Scan application templates for used custom element tag names
      const isAppFile = !cleanId.includes('/node_modules/');
      if (isAppFile && /\.(?:[jt]sx?|html|vue|svelte|astro)$/.test(cleanId)) {
        try {
          const tags = scanTags(code, cleanId);
          for (const t of tags) {
            usedTags.add(t);
          }
        } catch (err) {
          reportTransformError(this, 'tag-shake', cleanId, err);
        }
      }

      // 2. Check if file contains registrations to prune
      if (options.exclude) {
        const excludes = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
        for (const pattern of excludes) {
          if (matchesPattern(cleanId, pattern)) return null;
        }
      }

      if (options.include) {
        const includes = Array.isArray(options.include) ? options.include : [options.include];
        const matched = includes.some((pattern) => matchesPattern(cleanId, pattern));
        if (!matched) return null;
      }

      if (!TAG_SHAKE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformTagShake(code, {
          usedTags: Array.from(usedTags),
          sourcemap,
          filename: cleanId,
        });

        if (result.preservedTags && result.preservedTags.length > 0) {
          const survivingCode = result.shakenRegistrationsCount > 0 ? result.code : code;
          collectTransitiveTags(survivingCode, cleanId, 0);
        }

        if (result.shakenRegistrationsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (err) {
        reportTransformError(this, 'tag-shake', cleanId, err);
      }
    },

    renderChunk(code: string, chunk) {
      if (!TAG_SHAKE_FAST_CHECK.test(code)) {
        return null;
      }

      try {
        const result = transformTagShake(code, {
          usedTags: Array.from(usedTags),
          sourcemap,
          filename: chunk.fileName,
        });

        if (result.shakenRegistrationsCount === 0) {
          return null;
        }

        return {
          code: result.code,
          map: result.map ? JSON.parse(result.map) : null,
        };
      } catch (err) {
        reportTransformError(this, 'tag-shake', chunk.fileName, err);
      }
    },
  };
}

export const litTagShake = tagShake;
