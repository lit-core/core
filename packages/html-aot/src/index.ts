import ts from 'typescript';
import { type CompiledTemplateStats, compileLitTemplates } from './lib/template-transform.js';

export {
  AttributeKind,
  PartType,
  type TemplatePart,
} from './lib/ast-fragments.js';
export { type CompiledTemplateStats, compileLitTemplates };

export interface HtmlAotOptions {
  filename?: string;
  sourcemap?: boolean;
}

export interface HtmlAotResult {
  code: string;
  map?: string;
  templatesCount: number;
}

/**
 * Ahead-of-time compile Lit HTML template literals in a source string.
 * Transforms `html` tagged templates into `CompiledTemplateResult`s that
 * skip Lit's runtime prepare and parse phase.
 */
export function compileHtmlAot(source: string, options: HtmlAotOptions = {}): HtmlAotResult {
  const stats: CompiledTemplateStats = { templatesCompiled: 0 };
  const filename = options.filename || 'source.ts';

  const transpileResult = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      sourceMap: options.sourcemap ?? false,
    },
    transformers: {
      before: [compileLitTemplates(stats)],
    },
  });

  return {
    code: transpileResult.outputText,
    map: transpileResult.sourceMapText,
    templatesCount: stats.templatesCompiled,
  };
}

export const transformHtmlAot = compileHtmlAot;
export default compileHtmlAot;
