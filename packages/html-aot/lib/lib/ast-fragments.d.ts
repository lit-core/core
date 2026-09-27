import ts from 'typescript';
export declare const PartType: {
    readonly ATTRIBUTE: 1;
    readonly CHILD: 2;
    readonly PROPERTY: 3;
    readonly BOOLEAN_ATTRIBUTE: 4;
    readonly EVENT: 5;
    readonly ELEMENT: 6;
    readonly COMMENT_PART: 7;
};
export type PartType = (typeof PartType)[keyof typeof PartType];
export declare const AttributeKind: {
    readonly ATTRIBUTE: 1;
    readonly PROPERTY: 3;
    readonly BOOLEAN_ATTRIBUTE: 4;
    readonly EVENT: 5;
};
export type AttributeKind = (typeof AttributeKind)[keyof typeof AttributeKind];
export type TemplatePart = {
    type: typeof PartType.CHILD | typeof PartType.COMMENT_PART | typeof PartType.ELEMENT;
    index: number;
} | {
    type: typeof PartType.ATTRIBUTE;
    index: number;
    name: string;
    strings: Array<string>;
    ctorType: AttributeKind;
};
export declare const attributePartConstructors: {
    readonly 1: 'AttributePart';
    readonly 3: 'PropertyPart';
    readonly 4: 'BooleanAttributePart';
    readonly 5: 'EventPart';
};
export interface AttributePartConstructorAliases {
    AttributePart?: ts.Identifier;
    PropertyPart?: ts.Identifier;
    BooleanAttributePart?: ts.Identifier;
    EventPart?: ts.Identifier;
}
export declare const addPartConstructorImport: ({ factory, sourceFile, securityBrand, attributePartConstructorNameMap, }: {
    sourceFile: ts.SourceFile;
    securityBrand: ts.Statement;
    factory: ts.NodeFactory;
    attributePartConstructorNameMap: AttributePartConstructorAliases;
}) => ts.SourceFile;
export declare const createCompiledTemplate: ({ f, variableName, securityBrand, preparedHtml, parts, }: {
    f: ts.NodeFactory;
    variableName: ts.Identifier;
    securityBrand: ts.Identifier;
    preparedHtml: string;
    parts: ts.ArrayLiteralExpression;
}) => ts.VariableStatement;
export declare const createCompiledTemplateResult: ({ f, variableName, templateExpression }: {
    f: ts.NodeFactory;
    variableName: ts.Identifier;
    templateExpression: ts.TemplateLiteral;
}) => ts.ObjectLiteralExpression;
export declare const createTemplateParts: ({ f, parts, attributePartConstructorNameMap }: {
    f: ts.NodeFactory;
    parts: TemplatePart[];
    attributePartConstructorNameMap: AttributePartConstructorAliases;
}) => ts.ArrayLiteralExpression;
export declare const createSecurityBrandTagFunction: ({ f, securityBrandIdent }: {
    f: ts.NodeFactory;
    securityBrandIdent: ts.Identifier;
}) => ts.VariableStatement;
//# sourceMappingURL=ast-fragments.d.ts.map