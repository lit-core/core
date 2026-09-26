import ts from 'typescript';

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  skipDefaultLibCheck: true,
  skipLibCheck: true,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
};

export const isKnownLitHtmlModuleSpecifier = (specifier: string): boolean => {
  return specifier === 'lit' || specifier === 'lit-html' || specifier.startsWith('lit/') || specifier.startsWith('lit-html/');
};

export const getTypeChecker = (filename: string, source: string) => {
  const languageServiceHost = new SingleFileLanguageServiceHost(filename, source);
  const languageService = ts.createLanguageService(languageServiceHost, ts.createDocumentRegistry());

  const program = languageService.getProgram();
  if (!program) {
    throw new Error('Internal error: could not start TypeScript program');
  }
  return new TypeChecker(program.getTypeChecker());
};

export class TypeChecker {
  private checker: ts.TypeChecker;

  constructor(typeChecker: ts.TypeChecker) {
    this.checker = typeChecker;
  }

  isLitHtmlTaggedTemplateExpression(node: ts.TaggedTemplateExpression): boolean {
    if (ts.isIdentifier(node.tag)) {
      return this.isResolvedIdentifierLitHtmlTemplate(node.tag);
    }
    if (ts.isPropertyAccessExpression(node.tag)) {
      return this.isResolvedPropertyAccessLitHtmlNamespace(node.tag);
    }
    return false;
  }

  private isResolvedIdentifierLitHtmlTemplate(node: ts.Identifier): boolean {
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
      if (!ts.isNamedImports(namedImports)) return false;
      const importClause = namedImports.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDecl = importClause.parent;
      if (!ts.isImportDeclaration(importDecl)) return false;
      if (!ts.isStringLiteral(importDecl.moduleSpecifier)) return false;
      return isKnownLitHtmlModuleSpecifier(importDecl.moduleSpecifier.text);
    }

    // Direct identifier declaration or variable alias
    if (node.text === 'html') {
      return true;
    }

    return false;
  }

  private isResolvedPropertyAccessLitHtmlNamespace(node: ts.PropertyAccessExpression): boolean {
    if (node.name.text !== 'html') {
      return false;
    }
    if (ts.isIdentifier(node.expression)) {
      const symbol = this.checker.getSymbolAtLocation(node.expression);
      if (!symbol) return false;
      const decl = symbol.declarations?.[0];
      if (!decl) return false;
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

class SingleFileLanguageServiceHost implements ts.LanguageServiceHost {
  private compilerOptions: ts.CompilerOptions = compilerOptions;
  private filename: string;
  private source: string;

  constructor(filename: string, source: string) {
    this.filename = filename;
    this.source = source;
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.compilerOptions;
  }
  getScriptFileNames(): string[] {
    return [this.filename];
  }
  getScriptVersion(_: string): string {
    return '1';
  }
  getScriptSnapshot(filename: string): ts.IScriptSnapshot | undefined {
    if (filename === this.filename) {
      return ts.ScriptSnapshot.fromString(this.source);
    }
    return undefined;
  }
  getCurrentDirectory(): string {
    return '.';
  }
  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }
  readFile(filename: string): string | undefined {
    if (filename === this.filename) {
      return this.source;
    }
    return undefined;
  }
  fileExists(filename: string): boolean {
    return filename === this.filename;
  }
}
