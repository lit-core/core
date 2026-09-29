import { type CompiledTemplateStats, compileLitTemplates } from './lib/template-transform.js';
export { AttributeKind, PartType, type TemplatePart, } from './lib/ast-fragments.js';
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
export declare function compileHtmlAot(source: string, options?: HtmlAotOptions): HtmlAotResult;
export declare const transformHtmlAot: typeof compileHtmlAot;
export default compileHtmlAot;
