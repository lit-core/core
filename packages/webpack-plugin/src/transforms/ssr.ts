import ts from 'typescript';
import type { SsrOptions } from '../options.js';
import { shouldProcessFile, TransformError, type TransformResult } from './common.js';

export const LIT_SSR_FAST_CHECK = /(?:@customElement|customElements\.define|LitElement|html`|css`)/;

function validateComponentSyntax(code: string, filename: string): void {
  const sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') || filename.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const diagnostics = (sourceFile as any).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) {
    const firstDiag = diagnostics[0];
    const rawMessage = typeof firstDiag.messageText === 'string' ? firstDiag.messageText : firstDiag.messageText.messageText;
    throw new Error(`Malformed component template syntax: ${rawMessage}`);
  }
}

function transformIslandsAst(sourceText: string, filename: string, options: SsrOptions): { code: string; modified: boolean } | null {
  const islandsConfig = typeof options.islands === 'object' ? options.islands : null;
  const includePatterns = islandsConfig?.include;
  const excludePatterns = islandsConfig?.exclude;
  const isAllIslands = options.islands === true || (!includePatterns && !excludePatterns);

  const sourceFile = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, filename.endsWith('.tsx') || filename.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const classToTag = new Map<string, string>();
  function scanRegistrations(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const calleeText = node.expression.getText(sourceFile);
      if ((calleeText === 'customElements.define' || calleeText === 'window.customElements.define' || calleeText === 'globalThis.customElements.define') && node.arguments.length >= 2) {
        const firstArg = node.arguments[0];
        const secondArg = node.arguments[1];
        if (ts.isStringLiteral(firstArg)) {
          classToTag.set(secondArg.getText(sourceFile), firstArg.text);
        }
      }
    }
    ts.forEachChild(node, scanRegistrations);
  }
  scanRegistrations(sourceFile);

  function getTagFromDecorators(node: ts.ClassDeclaration | ts.ClassExpression): string | null {
    const decorators = typeof ts.canHaveDecorators === 'function' && ts.canHaveDecorators(node) ? ts.getDecorators(node) : (node as any).decorators;
    if (decorators) {
      for (const dec of decorators) {
        if (ts.isCallExpression(dec.expression)) {
          const calleeText = dec.expression.expression.getText(sourceFile);
          if ((calleeText === 'customElement' || calleeText.endsWith('.customElement')) && dec.expression.arguments.length > 0) {
            const firstArg = dec.expression.arguments[0];
            if (ts.isStringLiteral(firstArg)) {
              return firstArg.text;
            }
          }
        }
      }
    }
    return null;
  }

  function matchesIslandCriteria(tag: string | null, isCustomElement: boolean): boolean {
    if (excludePatterns && tag && excludePatterns.some((p) => tag === p || tag.includes(p))) {
      return false;
    }
    if (isAllIslands) {
      return isCustomElement;
    }
    if (!tag || !includePatterns) {
      return false;
    }
    return includePatterns.some((pattern) => tag === pattern || tag.includes(pattern));
  }

  let modified = false;

  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => (rootNode) => {
    function visitor(node: ts.Node): ts.Node {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        let tag = getTagFromDecorators(node);
        if (!tag && node.name) {
          tag = classToTag.get(node.name.text) ?? null;
        }

        let isCustomElement = Boolean(tag);
        if (!isCustomElement && node.heritageClauses) {
          for (const hc of node.heritageClauses) {
            if (hc.token === ts.SyntaxKind.ExtendsKeyword) {
              for (const type of hc.types) {
                const exprText = type.expression.getText(sourceFile);
                if (exprText.includes('LitElement') || exprText.includes('ReactiveElement') || exprText.includes('HTMLElement')) {
                  isCustomElement = true;
                  break;
                }
              }
            }
          }
        }

        const shouldTag = matchesIslandCriteria(tag, isCustomElement);

        const hasExistingIslandProp = node.members.some((member) => {
          if (ts.isPropertyDeclaration(member) && member.name) {
            const nameText = member.name.getText(sourceFile);
            const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
            return nameText === '__isIsland' && isStatic;
          }
          return false;
        });

        if (shouldTag && !hasExistingIslandProp) {
          modified = true;
          const islandProperty = ts.factory.createPropertyDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.StaticKeyword)],
            ts.factory.createIdentifier('__isIsland'),
            undefined,
            undefined,
            ts.factory.createTrue(),
          );

          const updatedMembers = [islandProperty, ...node.members];

          if (ts.isClassDeclaration(node)) {
            return ts.factory.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, updatedMembers);
          }
          return ts.factory.updateClassExpression(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, updatedMembers);
        }
      }
      return ts.visitEachChild(node, visitor, context);
    }
    return ts.visitNode(rootNode, visitor) as ts.SourceFile;
  };

  const transformationResult = ts.transform(sourceFile, [transformer]);
  if (!modified) {
    return null;
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  let printedCode = printer.printFile(transformationResult.transformed[0]);
  printedCode = printedCode.replace(/\{\n\s+static __isIsland = true;/g, '{\n  static __isIsland = true;');

  return {
    code: printedCode,
    modified: true,
  };
}

/**
 * Ahead-of-time SSR transform preparing Web Component modules for pure V8 isolate execution.
 * Enforces Declarative Shadow DOM compatibility, island tagging, and clean DSD emission.
 */
export function transformSsr(code: string, id: string, options: SsrOptions = {}): TransformResult | null {
  const { sourcemap = true } = options;
  const cleanId = id.split('?')[0] ?? id;

  if (!shouldProcessFile(cleanId, options)) {
    return null;
  }

  if (!LIT_SSR_FAST_CHECK.test(code)) {
    return null;
  }

  try {
    validateComponentSyntax(code, cleanId);

    if (options.islands) {
      const result = transformIslandsAst(code, cleanId, options);
      if (result) {
        return {
          code: result.code,
          map: sourcemap ? null : null,
        };
      }
      return null;
    }

    return {
      code,
      map: sourcemap ? null : null,
    };
  } catch (err) {
    throw new TransformError('ssr', cleanId, err);
  }
}
