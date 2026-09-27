import { getTextContent, isCommentNode, isElementNode, isTextNode, traverse } from '@parse5/tools';
import { _$LH as litHtmlPrivate } from 'lit-html/private-ssr-support.js';
import { parseFragment, serialize } from 'parse5';
import ts from 'typescript';
import {
  type AttributePartConstructorAliases,
  addPartConstructorImport,
  createCompiledTemplate,
  createCompiledTemplateResult,
  createSecurityBrandTagFunction,
  createTemplateParts,
  PartType,
  type TemplatePart,
} from './ast-fragments.js';
import { getTypeChecker } from './type-checker.js';

const { getTemplateHtml, markerMatch, marker, boundAttributeSuffix } = litHtmlPrivate;

export function unreachable(x: never): never {
  throw new Error(`Unreachable code reached: ${JSON.stringify(x)}`);
}

interface TemplateInfo {
  topStatement: ts.Statement;
  node: ts.TaggedTemplateExpression;
  variableName: ts.Identifier;
}

const rawTextElement = /^(?:script|style|textarea|title)$/i;

const elementDoesNotSupportInnerHtmlExpressions = new Set(['template', 'textarea']);

export interface CompiledTemplateStats {
  templatesCompiled: number;
}

export class CompiledTemplatePass {
  static getTransformer(stats?: CompiledTemplateStats): ts.TransformerFactory<ts.SourceFile> {
    return (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> => {
      return (sourceFile: ts.SourceFile): ts.SourceFile => {
        const pass = new CompiledTemplatePass(context, sourceFile, stats);
        pass.findTemplates(sourceFile);
        if (pass.expressionToTemplate.size === 0) {
          return sourceFile;
        }
        const transformedSourceFile = pass.rewriteTemplates(sourceFile);
        if (!ts.isSourceFile(transformedSourceFile)) {
          throw new Error('Internal error: expected source file to be transformed into another source file.');
        }

        if (pass.addedSecurityBrandVariableStatement !== null && Object.keys(pass.attributePartConstructorNames).length > 0) {
          return addPartConstructorImport({
            factory: context.factory,
            sourceFile: transformedSourceFile,
            securityBrand: pass.addedSecurityBrandVariableStatement,
            attributePartConstructorNameMap: pass.attributePartConstructorNames,
          });
        }
        return transformedSourceFile;
      };
    };
  }

  private readonly topLevelStatementToTemplate = new Map<ts.Statement, TemplateInfo[]>();
  private readonly expressionToTemplate = new Map<ts.TaggedTemplateExpression, TemplateInfo>();

  addedSecurityBrandVariableStatement: ts.Statement | null = null;
  private readonly attributePartConstructorNames: AttributePartConstructorAliases = {};
  private readonly securityBrandIdent: ts.Identifier;
  private readonly checker: ReturnType<typeof getTypeChecker>;

  private constructor(
    private readonly context: ts.TransformationContext,
    sourceFile: ts.SourceFile,
    private readonly stats?: CompiledTemplateStats,
  ) {
    this.securityBrandIdent = context.factory.createUniqueName('b');
    this.checker = getTypeChecker(sourceFile.fileName, sourceFile.text);
  }

  private findTemplates(sourceFile: ts.SourceFile) {
    const nodeStack: Array<ts.Node> = [];

    const find = <T extends ts.Node>(node: T): ts.Node => {
      return ts.visitNode(node, (childNode: ts.Node): ts.Node => {
        nodeStack.push(childNode);
        if (ts.isTaggedTemplateExpression(childNode) && this.checker.isLitHtmlTaggedTemplateExpression(childNode)) {
          const topStatement = (nodeStack[1] || childNode) as ts.Statement;
          const templateInfo = {
            topStatement,
            node: childNode,
            variableName: this.context.factory.createUniqueName('lit_template'),
          };
          const templates = this.topLevelStatementToTemplate.get(topStatement) ?? [];
          templates.push(templateInfo);
          this.topLevelStatementToTemplate.set(topStatement, templates);
          this.expressionToTemplate.set(childNode, templateInfo);
        }
        const result = ts.visitEachChild(childNode, find, this.context);
        nodeStack.pop();
        return result;
      });
    };

    find(sourceFile);
  }

  private rewriteTemplates<T extends ts.Node>(node: T): ts.Node {
    const rewrite = (visitedNode: ts.Node): ts.VisitResult<ts.Node> => {
      if (this.topLevelStatementToTemplate.has(visitedNode as ts.Statement)) {
        return this.addTopLevelCompiledTemplate(visitedNode);
      }
      const maybeRewritten = this.rewriteTemplateResultToCompiledTemplateResult(visitedNode);
      return ts.visitEachChild(maybeRewritten, rewrite, this.context);
    };

    const rewrittenNode = ts.visitNode(node, rewrite);
    if (!rewrittenNode) {
      throw new Error("Internal error: unexpected undefined 'rewrittenNode'.");
    }
    return rewrittenNode;
  }

  private litHtmlPrepareRenderPhase(templateExpression: ts.TemplateLiteral): { shouldCompile: false } | { shouldCompile: true; preparedHtml: string; parts: TemplatePart[] } {
    if (templateContainsOctalEscapes(templateExpression)) {
      return { shouldCompile: false };
    }

    const parts: Array<TemplatePart> = [];

    const spoofedTemplate = ts.isNoSubstitutionTemplateLiteral(templateExpression)
      ? ([templateExpression.text] as unknown as TemplateStringsArray)
      : ([templateExpression.head.text, ...templateExpression.templateSpans.map((s: ts.TemplateSpan) => s.literal.text)] as unknown as TemplateStringsArray);

    (spoofedTemplate as unknown as { raw: string }).raw = '';
    let html: any = '';
    let attrNames: Array<string | undefined> = [];
    try {
      [html, attrNames] = getTemplateHtml(spoofedTemplate, 1);
    } catch {
      return { shouldCompile: false };
    }

    const ast = parseFragment(html as unknown as string, {
      sourceCodeLocationInfo: false,
    });

    let nodeIndex = -1;
    let attrNameIndex = 0;
    let shouldCompile = true;

    traverse(ast, {
      'pre:node': (node: any): boolean | void => {
        if (isElementNode(node)) {
          const attributesToRemove = new Set<unknown>();
          if (node.tagName.includes(marker)) {
            shouldCompile = false;
            return false;
          }
          if (elementDoesNotSupportInnerHtmlExpressions.has(node.tagName) && serialize(node).includes(marker)) {
            shouldCompile = false;
            return false;
          }
          if (node.attrs.length > 0) {
            for (const attr of node.attrs) {
              const isAttributePart = attr.name.endsWith(boundAttributeSuffix);
              const isElementPart = attr.name.startsWith(marker);
              if (isAttributePart || isElementPart) {
                attributesToRemove.add(attr);
                if (isAttributePart) {
                  const realName = attrNames[attrNameIndex++];
                  if (realName === undefined) {
                    throw new Error('Internal error: realName is not defined.');
                  }
                  const statics = attr.value.split(marker);
                  const [, prefix, caseSensitiveName] = /([.?@])?(.*)/.exec(realName)!;
                  parts.push({
                    type: PartType.ATTRIBUTE,
                    index: nodeIndex,
                    name: caseSensitiveName,
                    strings: statics,
                    ctorType: prefix === '.' ? PartType.PROPERTY : prefix === '?' ? PartType.BOOLEAN_ATTRIBUTE : prefix === '@' ? PartType.EVENT : PartType.ATTRIBUTE,
                  });
                } else {
                  parts.push({
                    type: PartType.ELEMENT,
                    index: nodeIndex,
                  });
                }
              }
            }
            node.attrs = node.attrs.filter((attr: any) => !attributesToRemove.has(attr));
          }
          if (rawTextElement.test(node.tagName)) {
            const hasMarkers = getTextContent(node).includes(marker);
            if (hasMarkers) {
              shouldCompile = false;
              return false;
            }
          }
        } else if (isCommentNode(node)) {
          if (node.data === markerMatch) {
            parts.push({
              type: PartType.CHILD,
              index: nodeIndex,
            });
          } else {
            let i = -1;
            while (true) {
              i = node.data.indexOf(marker, i + 1);
              if (i === -1) break;
              parts.push({ type: PartType.COMMENT_PART, index: nodeIndex });
              i += marker.length - 1;
            }
            node.data = node.data.replaceAll(marker, '');
          }
        } else if (isTextNode(node)) {
          nodeIndex--;
        }
        nodeIndex++;
      },
    });

    if (!shouldCompile) {
      return { shouldCompile: false };
    }

    const f = this.context.factory;
    for (const part of parts) {
      if (part.type === PartType.ATTRIBUTE) {
        const ctorType = part.ctorType;
        switch (ctorType) {
          case PartType.ATTRIBUTE: {
            this.attributePartConstructorNames.AttributePart ??= f.createUniqueName('A');
            break;
          }
          case PartType.BOOLEAN_ATTRIBUTE: {
            this.attributePartConstructorNames.BooleanAttributePart ??= f.createUniqueName('B');
            break;
          }
          case PartType.EVENT: {
            this.attributePartConstructorNames.EventPart ??= f.createUniqueName('E');
            break;
          }
          case PartType.PROPERTY: {
            this.attributePartConstructorNames.PropertyPart ??= f.createUniqueName('P');
            break;
          }
          default: {
            throw new Error(`Internal error: unexpected attribute type: ${ctorType}`);
          }
        }
      }
    }

    const preparedHtml = serialize(ast).replace(new RegExp(`<!--\\?${marker.replace(/\$/g, '\\$')}-->`, 'g'), '<?>');

    return {
      shouldCompile: true,
      preparedHtml,
      parts,
    };
  }

  private addTopLevelCompiledTemplate(node: ts.Node): ts.Statement[] {
    if (!this.topLevelStatementToTemplate.has(node as ts.Statement)) {
      throw new Error("Internal error: 'this.topLevelStatementToTemplate' must contain 'node'.");
    }

    const f = this.context.factory;
    const topLevelTemplates: ts.VariableStatement[] = [];
    for (const template of this.topLevelStatementToTemplate.get(node as ts.Statement)!) {
      const result = this.litHtmlPrepareRenderPhase(template.node.template);
      if (!result.shouldCompile) {
        this.expressionToTemplate.delete(template.node);
        continue;
      }
      const { parts: partData, preparedHtml } = result;
      const parts = createTemplateParts({
        f,
        parts: partData,
        attributePartConstructorNameMap: this.attributePartConstructorNames,
      });

      topLevelTemplates.push(
        createCompiledTemplate({
          f,
          variableName: template.variableName,
          preparedHtml,
          parts,
          securityBrand: this.securityBrandIdent,
        }),
      );

      if (this.stats) {
        this.stats.templatesCompiled++;
      }
    }

    const addedTopLevelTemplates: ts.Statement[] = [
      ...(topLevelTemplates as ts.Statement[]),
      ts.visitEachChild(node, (childNode: ts.Node) => this.rewriteTemplates(childNode), this.context) as ts.Statement,
    ];

    if (this.addedSecurityBrandVariableStatement === null && topLevelTemplates.length > 0) {
      this.addedSecurityBrandVariableStatement = createSecurityBrandTagFunction({
        f,
        securityBrandIdent: this.securityBrandIdent,
      });
      addedTopLevelTemplates.unshift(this.addedSecurityBrandVariableStatement);
    }

    return addedTopLevelTemplates;
  }

  private rewriteTemplateResultToCompiledTemplateResult(node: ts.Node): ts.Node {
    const f = this.context.factory;
    if (!ts.isTaggedTemplateExpression(node)) {
      return node;
    }
    const templateInfo = this.expressionToTemplate.get(node);
    if (templateInfo === undefined) {
      return node;
    }
    return createCompiledTemplateResult({
      f,
      variableName: templateInfo.variableName,
      templateExpression: node.template,
    });
  }
}

export const compileLitTemplates = (stats?: CompiledTemplateStats): ts.TransformerFactory<ts.SourceFile> => CompiledTemplatePass.getTransformer(stats);

const containsOctalEscapeRegex = /^([^\\|\s]|\\.)*?\\(0)*[1-9]/;

const templateContainsOctalEscapes = (templateExpression: ts.TemplateLiteral): boolean => {
  const rawTextForOctalCheck = ts.isNoSubstitutionTemplateLiteral(templateExpression)
    ? ([templateExpression.rawText] as unknown as TemplateStringsArray)
    : ([templateExpression.head.rawText, ...templateExpression.templateSpans.map((s: ts.TemplateSpan) => s.literal.rawText)] as unknown as TemplateStringsArray);

  for (const staticString of rawTextForOctalCheck) {
    if (containsOctalEscapeRegex.test(staticString)) {
      return true;
    }
  }
  return false;
};
