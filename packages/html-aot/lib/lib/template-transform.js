import { getTextContent, isCommentNode, isElementNode, isTextNode, traverse } from '@parse5/tools';
import { _$LH as litHtmlPrivate } from 'lit-html/private-ssr-support.js';
import { parseFragment, serialize } from 'parse5';
import ts from 'typescript';
import { addPartConstructorImport, createCompiledTemplate, createCompiledTemplateResult, createSecurityBrandTagFunction, createTemplateParts, PartType, } from './ast-fragments.js';
import { getTypeChecker } from './type-checker.js';
const { getTemplateHtml, markerMatch, marker, boundAttributeSuffix } = litHtmlPrivate;
export function unreachable(x) {
    throw new Error(`Unreachable code reached: ${JSON.stringify(x)}`);
}
const rawTextElement = /^(?:script|style|textarea|title)$/i;
const elementDoesNotSupportInnerHtmlExpressions = new Set(['template', 'textarea']);
export class CompiledTemplatePass {
    context;
    stats;
    static getTransformer(stats) {
        return (context) => {
            return (sourceFile) => {
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
    topLevelStatementToTemplate = new Map();
    expressionToTemplate = new Map();
    addedSecurityBrandVariableStatement = null;
    attributePartConstructorNames = {};
    securityBrandIdent;
    checker;
    constructor(context, sourceFile, stats) {
        this.context = context;
        this.stats = stats;
        this.securityBrandIdent = context.factory.createUniqueName('b');
        this.checker = getTypeChecker(sourceFile.fileName, sourceFile.text);
    }
    findTemplates(sourceFile) {
        const nodeStack = [];
        const find = (node) => {
            return ts.visitNode(node, (childNode) => {
                nodeStack.push(childNode);
                if (ts.isTaggedTemplateExpression(childNode) && this.checker.isLitHtmlTaggedTemplateExpression(childNode)) {
                    const topStatement = (nodeStack[1] || childNode);
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
    rewriteTemplates(node) {
        const rewrite = (visitedNode) => {
            if (this.topLevelStatementToTemplate.has(visitedNode)) {
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
    litHtmlPrepareRenderPhase(templateExpression) {
        if (templateContainsOctalEscapes(templateExpression)) {
            return { shouldCompile: false };
        }
        const parts = [];
        const spoofedTemplate = ts.isNoSubstitutionTemplateLiteral(templateExpression)
            ? [templateExpression.text]
            : [templateExpression.head.text, ...templateExpression.templateSpans.map((s) => s.literal.text)];
        spoofedTemplate.raw = '';
        let html = '';
        let attrNames = [];
        try {
            [html, attrNames] = getTemplateHtml(spoofedTemplate, 1);
        }
        catch {
            return { shouldCompile: false };
        }
        const ast = parseFragment(html, {
            sourceCodeLocationInfo: false,
        });
        let nodeIndex = -1;
        let attrNameIndex = 0;
        let shouldCompile = true;
        traverse(ast, {
            'pre:node': (node) => {
                if (isElementNode(node)) {
                    const attributesToRemove = new Set();
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
                                    const [, prefix, caseSensitiveName] = /([.?@])?(.*)/.exec(realName);
                                    parts.push({
                                        type: PartType.ATTRIBUTE,
                                        index: nodeIndex,
                                        name: caseSensitiveName,
                                        strings: statics,
                                        ctorType: prefix === '.' ? PartType.PROPERTY : prefix === '?' ? PartType.BOOLEAN_ATTRIBUTE : prefix === '@' ? PartType.EVENT : PartType.ATTRIBUTE,
                                    });
                                }
                                else {
                                    parts.push({
                                        type: PartType.ELEMENT,
                                        index: nodeIndex,
                                    });
                                }
                            }
                        }
                        node.attrs = node.attrs.filter((attr) => !attributesToRemove.has(attr));
                    }
                    if (rawTextElement.test(node.tagName)) {
                        const hasMarkers = getTextContent(node).includes(marker);
                        if (hasMarkers) {
                            shouldCompile = false;
                            return false;
                        }
                    }
                }
                else if (isCommentNode(node)) {
                    if (node.data === markerMatch) {
                        parts.push({
                            type: PartType.CHILD,
                            index: nodeIndex,
                        });
                    }
                    else {
                        let i = -1;
                        while (true) {
                            i = node.data.indexOf(marker, i + 1);
                            if (i === -1)
                                break;
                            parts.push({ type: PartType.COMMENT_PART, index: nodeIndex });
                            i += marker.length - 1;
                        }
                        node.data = node.data.replaceAll(marker, '');
                    }
                }
                else if (isTextNode(node)) {
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
    addTopLevelCompiledTemplate(node) {
        if (!this.topLevelStatementToTemplate.has(node)) {
            throw new Error("Internal error: 'this.topLevelStatementToTemplate' must contain 'node'.");
        }
        const f = this.context.factory;
        const topLevelTemplates = [];
        for (const template of this.topLevelStatementToTemplate.get(node)) {
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
            topLevelTemplates.push(createCompiledTemplate({
                f,
                variableName: template.variableName,
                preparedHtml,
                parts,
                securityBrand: this.securityBrandIdent,
            }));
            if (this.stats) {
                this.stats.templatesCompiled++;
            }
        }
        const addedTopLevelTemplates = [
            ...topLevelTemplates,
            ts.visitEachChild(node, (childNode) => this.rewriteTemplates(childNode), this.context),
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
    rewriteTemplateResultToCompiledTemplateResult(node) {
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
export const compileLitTemplates = (stats) => CompiledTemplatePass.getTransformer(stats);
const containsOctalEscapeRegex = /^([^\\|\s]|\\.)*?\\(0)*[1-9]/;
const templateContainsOctalEscapes = (templateExpression) => {
    const rawTextForOctalCheck = ts.isNoSubstitutionTemplateLiteral(templateExpression)
        ? [templateExpression.rawText]
        : [templateExpression.head.rawText, ...templateExpression.templateSpans.map((s) => s.literal.rawText)];
    for (const staticString of rawTextForOctalCheck) {
        if (containsOctalEscapeRegex.test(staticString)) {
            return true;
        }
    }
    return false;
};
//# sourceMappingURL=template-transform.js.map