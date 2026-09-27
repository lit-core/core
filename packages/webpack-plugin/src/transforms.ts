import fs from 'node:fs';
import path from 'node:path';
import { auditScoping, type FuseResult, fuse } from '@lit-core/css-fuse';
import { minifyEmbeddedCss } from '@lit-core/css-minifier';
import { transformElemProxy as runTransformElemProxy } from '@lit-core/elem-proxy';
import { compileHtmlAot } from '@lit-core/html-aot';
import { fuse as fuseHtml, type HtmlFuseResult } from '@lit-core/html-fuse';
import { minifyHtmlTemplates } from '@lit-core/html-minifier';
import { transformLitProps } from '@lit-core/props-lower';
import type { CssFuseOptions, CssMinifierOptions, ElemProxyOptions, HtmlAotOptions, HtmlFuseOptions, HtmlMinifierOptions, PropsLowerOptions } from './options.js';
import { matchesPattern } from './utils.js';

export const LIT_DECORATOR_FAST_CHECK = /@(?:customElement|property|state|query|queryAll|queryAsync|queryAssignedElements|queryAssignedNodes|eventOptions|localized)\b|__(?:decorate|decorateClass)\b/;
export const LIT_ELEM_PROXY_FAST_CHECK = /@customElement\b|customElements\.define\b/;
export const LIT_HTML_FAST_CHECK = /\b(?:html|svg)\s*`/;
export const LIT_CSS_FAST_CHECK = /\bcss\s*`/;

export interface TransformResult {
  code: string;
  map?: unknown;
}

export function shouldProcessFile(id: string, options: { include?: (string | RegExp)[] | string | RegExp; exclude?: (string | RegExp)[] | string | RegExp }): boolean {
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

export function transformPropsLower(code: string, id: string, options: PropsLowerOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_DECORATOR_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = transformLitProps(code, {
      sourcemap,
      filename: cleanId,
    });

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}

export function transformElemProxy(code: string, id: string, options: ElemProxyOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_ELEM_PROXY_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = runTransformElemProxy(code, {
      sourcemap,
      filename: cleanId,
      mode: options.mode,
    });

    if (result.proxiedElementsCount === 0) {
      return null;
    }

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}

export function transformHtmlMinifier(code: string, id: string, options: HtmlMinifierOptions = {}): TransformResult | null {
  const { sourcemap = false } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_HTML_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = minifyHtmlTemplates(code, {
      sourcemap,
      filename: cleanId,
    });

    if (result.templatesCount === 0) {
      return null;
    }

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}

export function transformCssMinifier(code: string, id: string, options: CssMinifierOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_CSS_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = minifyEmbeddedCss(code, {
      sourcemap,
      filename: cleanId,
    });

    if (result.minifiedTemplates === 0) {
      return null;
    }

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}

export function transformHtmlAot(code: string, id: string, options: HtmlAotOptions = {}): TransformResult | null {
  const { sourcemap = false } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_HTML_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    const result = compileHtmlAot(code, {
      filename: cleanId,
      sourcemap,
    });

    if (result.templatesCount === 0) {
      return null;
    }

    return {
      code: result.code,
      map: result.map ? JSON.parse(result.map) : null,
    };
  } catch (_err) {
    return null;
  }
}

export interface OptimizationResult {
  fuseResult: FuseResult;
  virtualSheets: Map<string, string>;
  transformedFiles: Map<string, string>;
}

export function runFuseOptimization(options: CssFuseOptions = {}): OptimizationResult {
  const {
    include = ['packages/components/**/src/**/*.ts', 'src/**/*.ts'],
    exclude = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    threshold = 2,
    outputDir = '.fused',
  } = options;

  const res = fuse({
    include,
    exclude,
    threshold,
    outputDir,
    write: false,
    virtualImports: true,
  });

  const virtualSheets = new Map<string, string>();
  const sheets = res.fusedSheets || [];
  for (const sheet of sheets) {
    virtualSheets.set(sheet.id, sheet.code);
    virtualSheets.set(`${sheet.id}.js`, sheet.code);
    virtualSheets.set(`${sheet.id}.ts`, sheet.code);
    virtualSheets.set(sheet.fileName, sheet.code);
  }

  const transformedFiles = new Map<string, string>();
  const files = res.rewrittenFiles || [];
  for (const file of files) {
    if (file.filePath && file.transformedCode) {
      transformedFiles.set(file.filePath, file.transformedCode);
      const abs = path.resolve(file.filePath);
      transformedFiles.set(abs, file.transformedCode);
      try {
        const real = fs.realpathSync(abs);
        transformedFiles.set(real, file.transformedCode);
      } catch {}
    }
  }

  return {
    fuseResult: res,
    virtualSheets,
    transformedFiles,
  };
}

export function runScopingAudit(options: CssFuseOptions = {}) {
  const { include = ['packages/components/**/src/**/*.ts', 'src/**/*.ts'], exclude = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'], threshold = 2 } = options;

  return auditScoping({
    include,
    exclude,
    threshold,
  });
}

export interface HtmlOptimizationResult {
  fuseResult: HtmlFuseResult;
  virtualTemplates: Map<string, string>;
  transformedFiles: Map<string, string>;
}

export function runHtmlFuseOptimization(options: HtmlFuseOptions = {}): HtmlOptimizationResult {
  const {
    include = ['packages/components/**/src/**/*.ts', 'src/**/*.ts'],
    exclude = ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**', '**/dist/**'],
    threshold = 2,
    minFragmentLength = 15,
    outputDir = '.fused-html',
  } = options;

  const res = fuseHtml({
    include,
    exclude,
    threshold,
    minFragmentLength,
    outputDir,
    write: false,
    virtualImports: true,
  });

  const virtualTemplates = new Map<string, string>();
  const templates = res.fusedTemplates || [];
  for (const tpl of templates) {
    virtualTemplates.set(tpl.id, tpl.code);
    virtualTemplates.set(`${tpl.id}.js`, tpl.code);
    virtualTemplates.set(`${tpl.id}.ts`, tpl.code);
    virtualTemplates.set(tpl.fileName, tpl.code);
  }

  const transformedFiles = new Map<string, string>();
  const files = res.rewrittenFiles || [];
  for (const file of files) {
    if (file.filePath && file.transformedCode) {
      transformedFiles.set(file.filePath, file.transformedCode);
      const abs = path.resolve(file.filePath);
      transformedFiles.set(abs, file.transformedCode);
      try {
        const real = fs.realpathSync(abs);
        transformedFiles.set(real, file.transformedCode);
      } catch {}
    }
  }

  return {
    fuseResult: res,
    virtualTemplates,
    transformedFiles,
  };
}
