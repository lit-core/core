import fs from 'node:fs';
import path from 'node:path';
import { auditScoping, fuse } from '@lit-core/css-fuse';
import { fuse as fuseHtml } from '@lit-core/html-fuse';
import type { CssFuseOptions, HtmlFuseOptions } from '../options.js';
import type { HtmlOptimizationResult, OptimizationResult } from './common.js';

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
