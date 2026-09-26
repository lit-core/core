import ts from 'typescript';
export declare const isKnownLitHtmlModuleSpecifier: (specifier: string) => boolean;
export declare const getTypeChecker: (filename: string, source: string) => TypeChecker;
export declare class TypeChecker {
    private checker;
    constructor(typeChecker: ts.TypeChecker);
    isLitHtmlTaggedTemplateExpression(node: ts.TaggedTemplateExpression): boolean;
    private isResolvedIdentifierLitHtmlTemplate;
    private isResolvedPropertyAccessLitHtmlNamespace;
}
//# sourceMappingURL=type-checker.d.ts.map