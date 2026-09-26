import ts from 'typescript';
export declare function unreachable(x: never): never;
export interface CompiledTemplateStats {
    templatesCompiled: number;
}
export declare class CompiledTemplatePass {
    private readonly context;
    private readonly stats?;
    static getTransformer(stats?: CompiledTemplateStats): ts.TransformerFactory<ts.SourceFile>;
    private readonly topLevelStatementToTemplate;
    private readonly expressionToTemplate;
    addedSecurityBrandVariableStatement: ts.Statement | null;
    private readonly attributePartConstructorNames;
    private readonly securityBrandIdent;
    private readonly checker;
    private constructor();
    private findTemplates;
    private rewriteTemplates;
    private litHtmlPrepareRenderPhase;
    private addTopLevelCompiledTemplate;
    private rewriteTemplateResultToCompiledTemplateResult;
}
export declare const compileLitTemplates: (stats?: CompiledTemplateStats) => ts.TransformerFactory<ts.SourceFile>;
//# sourceMappingURL=template-transform.d.ts.map