import ts from 'typescript';
import { compileLitTemplates } from './lib/template-transform.js';
export { AttributeKind, PartType, } from './lib/ast-fragments.js';
export { compileLitTemplates };
/**
 * Ahead-of-time compile Lit HTML template literals in a source string.
 * Transforms `html` tagged templates into `CompiledTemplateResult`s that
 * skip Lit's runtime prepare and parse phase.
 */
export function compileHtmlAot(source, options = {}) {
    const stats = { templatesCompiled: 0 };
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
//# sourceMappingURL=index.js.map