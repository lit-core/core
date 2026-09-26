import ts from 'typescript';
const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    skipDefaultLibCheck: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
};
export const isKnownLitHtmlModuleSpecifier = (specifier) => {
    return specifier === 'lit' || specifier === 'lit-html' || specifier.startsWith('lit/') || specifier.startsWith('lit-html/');
};
export const getTypeChecker = (filename, source) => {
    const languageServiceHost = new SingleFileLanguageServiceHost(filename, source);
    const languageService = ts.createLanguageService(languageServiceHost, ts.createDocumentRegistry());
    const program = languageService.getProgram();
    if (!program) {
        throw new Error('Internal error: could not start TypeScript program');
    }
    return new TypeChecker(program.getTypeChecker());
};
export class TypeChecker {
    checker;
    constructor(typeChecker) {
        this.checker = typeChecker;
    }
    isLitHtmlTaggedTemplateExpression(node) {
        if (ts.isIdentifier(node.tag)) {
            return this.isResolvedIdentifierLitHtmlTemplate(node.tag);
        }
        if (ts.isPropertyAccessExpression(node.tag)) {
            return this.isResolvedPropertyAccessLitHtmlNamespace(node.tag);
        }
        return false;
    }
    isResolvedIdentifierLitHtmlTemplate(node) {
        // Fast path: if identifier text is not html and not imported, check symbol
        const symbol = this.checker.getSymbolAtLocation(node);
        if (!symbol) {
            // In isolated environments without full imports, check identifier name
            return node.text === 'html';
        }
        const decl = symbol.declarations?.[0];
        if (!decl) {
            return node.text === 'html';
        }
        if (ts.isImportSpecifier(decl)) {
            const propertyName = decl.propertyName?.text ?? decl.name.text;
            if (propertyName !== 'html') {
                return false;
            }
            const namedImports = decl.parent;
            if (!ts.isNamedImports(namedImports))
                return false;
            const importClause = namedImports.parent;
            if (!ts.isImportClause(importClause))
                return false;
            const importDecl = importClause.parent;
            if (!ts.isImportDeclaration(importDecl))
                return false;
            if (!ts.isStringLiteral(importDecl.moduleSpecifier))
                return false;
            return isKnownLitHtmlModuleSpecifier(importDecl.moduleSpecifier.text);
        }
        // Direct identifier declaration or variable alias
        if (node.text === 'html') {
            return true;
        }
        return false;
    }
    isResolvedPropertyAccessLitHtmlNamespace(node) {
        if (node.name.text !== 'html') {
            return false;
        }
        if (ts.isIdentifier(node.expression)) {
            const symbol = this.checker.getSymbolAtLocation(node.expression);
            if (!symbol)
                return false;
            const decl = symbol.declarations?.[0];
            if (!decl)
                return false;
            if (ts.isNamespaceImport(decl)) {
                const importClause = decl.parent;
                const importDecl = importClause.parent;
                if (ts.isImportDeclaration(importDecl) && ts.isStringLiteral(importDecl.moduleSpecifier)) {
                    return isKnownLitHtmlModuleSpecifier(importDecl.moduleSpecifier.text);
                }
            }
        }
        return false;
    }
}
class SingleFileLanguageServiceHost {
    compilerOptions = compilerOptions;
    filename;
    source;
    constructor(filename, source) {
        this.filename = filename;
        this.source = source;
    }
    getCompilationSettings() {
        return this.compilerOptions;
    }
    getScriptFileNames() {
        return [this.filename];
    }
    getScriptVersion(_) {
        return '1';
    }
    getScriptSnapshot(filename) {
        if (filename === this.filename) {
            return ts.ScriptSnapshot.fromString(this.source);
        }
        return undefined;
    }
    getCurrentDirectory() {
        return '.';
    }
    getDefaultLibFileName(options) {
        return ts.getDefaultLibFilePath(options);
    }
    readFile(filename) {
        if (filename === this.filename) {
            return this.source;
        }
        return undefined;
    }
    fileExists(filename) {
        return filename === this.filename;
    }
}
//# sourceMappingURL=type-checker.js.map