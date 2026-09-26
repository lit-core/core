import ts from 'typescript';
export const PartType = {
    ATTRIBUTE: 1,
    CHILD: 2,
    PROPERTY: 3,
    BOOLEAN_ATTRIBUTE: 4,
    EVENT: 5,
    ELEMENT: 6,
    COMMENT_PART: 7,
};
export const AttributeKind = {
    ATTRIBUTE: 1,
    PROPERTY: 3,
    BOOLEAN_ATTRIBUTE: 4,
    EVENT: 5,
};
export const attributePartConstructors = {
    [AttributeKind.ATTRIBUTE]: 'AttributePart',
    [AttributeKind.PROPERTY]: 'PropertyPart',
    [AttributeKind.BOOLEAN_ATTRIBUTE]: 'BooleanAttributePart',
    [AttributeKind.EVENT]: 'EventPart',
};
const attributePartConstructorNames = Object.values(attributePartConstructors);
const createImportNamespaceDeclaration = (factory, namespace, moduleSpecifier) => factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamespaceImport(namespace)), moduleSpecifier, undefined);
export const addPartConstructorImport = ({ factory, sourceFile, securityBrand, attributePartConstructorNameMap, }) => {
    const uniqueLitHtmlPrivateIdentifier = factory.createUniqueName('litHtmlPrivate');
    const brandIdx = sourceFile.statements.indexOf(securityBrand);
    if (brandIdx === -1) {
        throw new Error('Internal error: could not find security brand declaration.');
    }
    const beforeSecurityBrand = sourceFile.statements.slice(0, brandIdx);
    const afterSecurityBrand = sourceFile.statements.slice(brandIdx);
    const partsObjectBinding = attributePartConstructorNames
        .map((part) => {
        const identifierAlias = attributePartConstructorNameMap[part];
        if (!identifierAlias) {
            return undefined;
        }
        return factory.createBindingElement(undefined, factory.createIdentifier(part), identifierAlias, undefined);
    })
        .filter((i) => i !== undefined);
    if (partsObjectBinding.length === 0) {
        return sourceFile;
    }
    return factory.updateSourceFile(sourceFile, [
        ...beforeSecurityBrand,
        ...[
            createImportNamespaceDeclaration(factory, uniqueLitHtmlPrivateIdentifier, factory.createStringLiteral('lit-html/private-ssr-support.js')),
            factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
                factory.createVariableDeclaration(factory.createObjectBindingPattern(partsObjectBinding), undefined, undefined, factory.createPropertyAccessExpression(uniqueLitHtmlPrivateIdentifier, factory.createIdentifier('_$LH'))),
            ], ts.NodeFlags.Const)),
        ],
        ...afterSecurityBrand,
    ]);
};
export const createCompiledTemplate = ({ f, variableName, securityBrand, preparedHtml, parts, }) => f.createVariableStatement(undefined, f.createVariableDeclarationList([
    f.createVariableDeclaration(variableName, undefined, undefined, f.createObjectLiteralExpression([
        f.createPropertyAssignment('h', f.createTaggedTemplateExpression(securityBrand, undefined, f.createNoSubstitutionTemplateLiteral(preparedHtml))),
        f.createPropertyAssignment('parts', parts),
    ])),
], ts.NodeFlags.Const));
export const createCompiledTemplateResult = ({ f, variableName, templateExpression }) => f.createObjectLiteralExpression([
    f.createPropertyAssignment(f.createComputedPropertyName(f.createStringLiteral('_$litType$')), variableName),
    f.createPropertyAssignment('values', f.createArrayLiteralExpression(ts.isNoSubstitutionTemplateLiteral(templateExpression) ? [] : templateExpression.templateSpans.map((s) => s.expression))),
]);
export const createTemplateParts = ({ f, parts, attributePartConstructorNameMap }) => f.createArrayLiteralExpression(parts.map((part) => {
    const partProperties = [f.createPropertyAssignment('type', f.createNumericLiteral(part.type)), f.createPropertyAssignment('index', f.createNumericLiteral(part.index))];
    if (part.type === PartType.ATTRIBUTE) {
        const ctorAlias = attributePartConstructorNameMap[attributePartConstructors[part.ctorType]];
        if (ctorAlias === undefined) {
            throw new Error('Internal error: part ctor alias identifier was not passed.');
        }
        partProperties.push(f.createPropertyAssignment('name', f.createStringLiteral(part.name)), f.createPropertyAssignment('strings', f.createArrayLiteralExpression(part.strings.map((s) => f.createStringLiteral(s)))), f.createPropertyAssignment('ctor', ctorAlias));
    }
    return f.createObjectLiteralExpression(partProperties);
}));
export const createSecurityBrandTagFunction = ({ f, securityBrandIdent }) => {
    return f.createVariableStatement(undefined, f.createVariableDeclarationList([
        f.createVariableDeclaration(securityBrandIdent, undefined, undefined, f.createArrowFunction(undefined, undefined, [f.createParameterDeclaration(undefined, undefined, f.createIdentifier('i'), undefined, undefined, undefined)], undefined, f.createToken(ts.SyntaxKind.EqualsGreaterThanToken), f.createIdentifier('i'))),
    ], ts.NodeFlags.Const));
};
//# sourceMappingURL=ast-fragments.js.map