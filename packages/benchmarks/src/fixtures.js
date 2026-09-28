import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

/**
 * Locate a package directory in the monorepo.
 * @param {string} pkg
 * @returns {string}
 */
export function resolvePackageDir(pkg) {
  const possiblePaths = [path.join(rootDir, 'node_modules', pkg), path.resolve('node_modules', pkg), path.resolve(__dirname, '../node_modules', pkg)];
  const found = possiblePaths.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`Package not found in node_modules: ${pkg}`);
  }
  return fs.realpathSync(found);
}

/**
 * Read component source file from node_modules.
 * @param {string} pkg
 * @param {string} subpath
 * @returns {string}
 */
export function readComponentSource(pkg, subpath) {
  const pkgDir = resolvePackageDir(pkg);
  const filePath = path.join(pkgDir, subpath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Component file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Extract CSS content from a style module file.
 * @param {string} source
 * @returns {string}
 */
export function extractCssFromModule(source) {
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

  const fnMatch = /css\s*\(\s*\[?\s*["'`\x60]([\s\S]*?)["'`\x60]\s*\]?\s*\)/.exec(source);
  if (fnMatch) {
    try {
      return JSON.parse(`"${fnMatch[1].replace(/"/g, '\\"')}"`);
    } catch {
      return fnMatch[1];
    }
  }

  const genericMatch = /`([\s\S]*?:host[\s\S]*?)`/.exec(source);
  if (genericMatch) {
    return genericMatch[1];
  }

  return '';
}

/**
 * Find and read component CSS source file from node_modules.
 * @param {string} pkg
 * @param {string} [cssSubpath]
 * @param {string} [sourceSubpath]
 * @returns {string}
 */
export function findComponentCssSource(pkg, cssSubpath, sourceSubpath) {
  const pkgDir = resolvePackageDir(pkg);
  let initialSource = '';
  let initialDir = '';

  if (cssSubpath) {
    const directPath = path.join(pkgDir, cssSubpath);
    if (fs.existsSync(directPath)) {
      initialSource = fs.readFileSync(directPath, 'utf-8');
      initialDir = path.dirname(directPath);
    }
  }

  if (!initialSource && sourceSubpath) {
    const srcFile = path.join(pkgDir, sourceSubpath);
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
    const chunkImport = /from\s*['"](\.\.?\/[^'"]+)['"]/.exec(initialSource);
    if (chunkImport && !initialSource.includes('css`') && !initialSource.includes('css(') && !initialSource.includes(':host')) {
      const chunkPath = path.resolve(initialDir, chunkImport[1]);
      let resolvedChunk = chunkPath;
      if (fs.existsSync(resolvedChunk) && fs.statSync(resolvedChunk).isDirectory()) {
        const potential = [
          path.join(resolvedChunk, 'index.js'),
          path.join(resolvedChunk, `${path.basename(resolvedChunk)}.styles.js`),
          path.join(resolvedChunk, `${path.basename(resolvedChunk)}.component.js`),
        ];
        resolvedChunk = potential.find((p) => fs.existsSync(p)) || resolvedChunk;
      } else if (!fs.existsSync(resolvedChunk) && fs.existsSync(`${resolvedChunk}.js`)) {
        resolvedChunk = `${resolvedChunk}.js`;
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

  return initialSource;
}

/**
 * Extract HTML template strings from Lit component source code.
 * @param {string} source
 * @returns {string[]}
 */
export function extractHtmlTemplates(source) {
  const templates = [];
  let index = 0;
  while (index < source.length) {
    const match = source.slice(index).match(/(?:html|[a-zA-Z0-9_$]+)?\s*`/);
    if (!match || match.index === undefined) break;
    const start = index + match.index + match[0].length;
    let i = start;
    let inBraces = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (inBraces > 0) {
        if (ch === '{') inBraces++;
        else if (ch === '}') inBraces--;
        i++;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        inBraces = 1;
        i += 2;
        continue;
      }
      if (ch === '`') {
        const content = source.slice(start, i);
        if (/<(?:div|span|button|svg|slot|label|input|p|a|ul|li|section|header|footer|[a-zA-Z0-9]+-[a-zA-Z0-9]+)[\s>]/.test(content)) {
          templates.push(content);
        }
        index = i + 1;
        break;
      }
      i++;
    }
    if (i >= source.length) break;
  }
  return templates;
}

/**
 * Recursively read component file and its local imported dependencies.
 * @param {string} pkg
 * @param {string} subpath
 * @returns {string}
 */
export function readComponentFullSource(pkg, subpath) {
  const pkgDir = resolvePackageDir(pkg);
  const filePath = path.join(pkgDir, subpath);
  if (!fs.existsSync(filePath)) return '';
  let full = fs.readFileSync(filePath, 'utf-8');
  const dir = path.dirname(filePath);

  const imports = [...full.matchAll(/from\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  for (const imp of imports) {
    let resolved = path.resolve(dir, imp);
    if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.js')) resolved += '.js';
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      full += '\n' + fs.readFileSync(resolved, 'utf-8');
    }
  }
  return full;
}

/**
 * Extract HTML templates from a component, following chunk or internal re-exports if needed.
 * @param {string} pkg
 * @param {string} subpath
 * @returns {string[]}
 */
export function extractComponentTemplates(pkg, subpath) {
  const full = readComponentFullSource(pkg, subpath);
  return extractHtmlTemplates(full);
}

/**
 * Real enterprise components registry for all 5 design systems.
 * Matches packages/tests/src/components.ts (255 production Lit Custom Elements).
 */
export const ENTERPRISE_COMPONENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'enterprise-components.json'), 'utf-8'));
