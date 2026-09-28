import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve path relative to root directory.
 */
export function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

/**
 * Read component source file from node_modules.
 */
export function readComponentSource(pkg: string, subpath: string): string {
  const filePath = path.resolve(process.cwd(), 'node_modules', pkg, subpath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Component file not found at: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Find and read component CSS source file from node_modules.
 * Follows re-exports and inspects component directory if needed.
 */
export function findComponentCssSource(pkg: string, cssSubpath?: string, sourceSubpath?: string): string {
  let initialSource = '';
  let initialDir = '';

  if (cssSubpath) {
    const directPath = path.resolve(process.cwd(), 'node_modules', pkg, cssSubpath);
    if (fs.existsSync(directPath)) {
      initialSource = fs.readFileSync(directPath, 'utf-8');
      initialDir = path.dirname(directPath);
    }
  }

  if (!initialSource && sourceSubpath) {
    const srcFile = path.resolve(process.cwd(), 'node_modules', pkg, sourceSubpath);
    if (fs.existsSync(srcFile)) {
      const dir = path.dirname(srcFile);
      initialDir = dir;
      try {
        const files = fs.readdirSync(dir);
        const styleFile = files.find((f) => f.endsWith('.styles.js') || f.endsWith('.scss.js') || f.endsWith('.css.js') || f.endsWith('.cssresult.js'));
        if (styleFile) {
          initialSource = fs.readFileSync(path.join(dir, styleFile), 'utf-8');
        } else {
          initialSource = fs.readFileSync(srcFile, 'utf-8');
        }
      } catch {
        initialSource = fs.readFileSync(srcFile, 'utf-8');
      }
    }
  }

  if (initialSource) {
    // If it re-exports from a chunk or sibling file, follow the import
    const chunkImport = /from\s*['"](\.\.?\/[^'"]+)['"]/.exec(initialSource);
    if (chunkImport && !initialSource.includes('css`') && !initialSource.includes('css(') && !initialSource.includes(':host')) {
      const chunkPath = path.resolve(initialDir, chunkImport[1]);
      let resolvedChunk = chunkPath;
      if (fs.existsSync(resolvedChunk) && fs.statSync(resolvedChunk).isDirectory()) {
        const potential = [
          path.join(resolvedChunk, 'index.js'),
          path.join(resolvedChunk, path.basename(resolvedChunk) + '.styles.js'),
          path.join(resolvedChunk, path.basename(resolvedChunk) + '.component.js'),
        ];
        resolvedChunk = potential.find((p) => fs.existsSync(p)) || resolvedChunk;
      } else if (!fs.existsSync(resolvedChunk) && fs.existsSync(resolvedChunk + '.js')) {
        resolvedChunk = resolvedChunk + '.js';
      }

      if (fs.existsSync(resolvedChunk) && fs.statSync(resolvedChunk).isFile()) {
        const chunkContent = fs.readFileSync(resolvedChunk, 'utf-8');
        if (extractCssFromModule(chunkContent).length > 0) {
          return chunkContent;
        }
      }
    }

    if (extractCssFromModule(initialSource).length > 0) {
      return initialSource;
    }
  }

  // Fallback: search directory and parent directory for any styles file
  if (sourceSubpath) {
    const srcFile = path.resolve(process.cwd(), 'node_modules', pkg, sourceSubpath);
    const dir = path.dirname(srcFile);
    const parentDir = path.dirname(dir);
    for (const searchDir of [dir, parentDir]) {
      try {
        const files = fs.readdirSync(searchDir);
        for (const f of files) {
          if (f.endsWith('.styles.js') || f.endsWith('.scss.js') || f.endsWith('.css.js') || f.endsWith('.cssresult.js')) {
            const content = fs.readFileSync(path.join(searchDir, f), 'utf-8');
            if (extractCssFromModule(content).length > 0) {
              return content;
            }
          }
        }
      } catch {}
    }
  }

  // Fallback for Web Awesome shared styles
  if (pkg === '@awesome.me/webawesome') {
    const hostStylesPath = path.resolve(process.cwd(), 'node_modules/@awesome.me/webawesome/dist/styles/component/host.styles.js');
    if (fs.existsSync(hostStylesPath)) {
      return fs.readFileSync(hostStylesPath, 'utf-8');
    }
    const hostStylesTs = path.resolve(process.cwd(), 'node_modules/@awesome.me/webawesome/dist/styles/component/host.styles.ts');
    if (fs.existsSync(hostStylesTs)) {
      return fs.readFileSync(hostStylesTs, 'utf-8');
    }
  }

  return initialSource;
}

/**
 * Extract CSS content from a style module file.
 * Handles tagged templates: css`...`, aliased t`...`, and array calls: css(["..."]).
 */
export function extractCssFromModule(source: string): string {
  // Pattern 1: Accumulate all css`...` or aliased template literals
  let accumulated = '';
  const templateMatches = source.matchAll(/(?:css|[a-zA-Z0-9_$]+)\s*`([\s\S]*?)`/g);
  for (const match of templateMatches) {
    if (match[1] && match[1].length > 5) {
      accumulated += '\n' + match[1];
    }
  }
  if (accumulated.trim().length > 0) {
    return accumulated;
  }

  // Pattern 2: Carbon css(["..."]) or css("...")
  const fnMatch = /css\s*\(\s*\[?\s*["'`\x60]([\s\S]*?)["'`\x60]\s*\]?\s*\)/.exec(source);
  if (fnMatch) {
    try {
      return JSON.parse(`"${fnMatch[1].replace(/"/g, '\\"')}"`);
    } catch {
      return fnMatch[1];
    }
  }

  // Pattern 3: Any template literal with CSS-like rules
  const genericMatch = /`([\s\S]*?:host[\s\S]*?)`/.exec(source);
  if (genericMatch) {
    return genericMatch[1];
  }

  return '';
}
