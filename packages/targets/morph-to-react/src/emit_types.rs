use lit_analysis::{EventInfo, LitComponentInfo, PropertyInfo, PropertyType};
use oxc_allocator::{Allocator, ArenaVec, CloneIn};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::{SPAN, SourceType};

/// Helper to build an identifier-based type reference like `HTMLElement` or `MorphHost`.
fn build_id_type_ref<'a>(name: &str, ast: &AstBuilder<'a>, allocator: &'a Allocator) -> TSType<'a> {
    let id_ref = IdentifierReference::boxed(SPAN, allocator.alloc_str(name), ast);
    TSType::TSTypeReference(TSTypeReference::boxed(
        SPAN,
        TSTypeName::IdentifierReference(id_ref),
        None,
        ast,
    ))
}

/// Helper to build a qualified type reference like `React.ReactNode` or `React.HTMLAttributes`.
fn build_qualified_type_ref<'a>(
    module: &str,
    member: &str,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> TSType<'a> {
    let left_id = IdentifierReference::boxed(SPAN, allocator.alloc_str(module), ast);
    let right_id = IdentifierName::new(SPAN, allocator.alloc_str(member), ast);
    let qual = TSQualifiedName::boxed(
        SPAN,
        TSTypeName::IdentifierReference(left_id),
        right_id,
        ast,
    );
    TSType::TSTypeReference(TSTypeReference::boxed(
        SPAN,
        TSTypeName::QualifiedName(qual),
        None,
        ast,
    ))
}

/// Helper to build a generic qualified type reference like `React.HTMLAttributes<HTMLElement>`.
fn build_generic_qualified_type_ref<'a>(
    module: &str,
    member: &str,
    type_args: ArenaVec<'a, TSType<'a>>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> TSType<'a> {
    let left_id = IdentifierReference::boxed(SPAN, allocator.alloc_str(module), ast);
    let right_id = IdentifierName::new(SPAN, allocator.alloc_str(member), ast);
    let qual = TSQualifiedName::boxed(
        SPAN,
        TSTypeName::IdentifierReference(left_id),
        right_id,
        ast,
    );
    let inst = TSTypeParameterInstantiation::boxed(SPAN, type_args, ast);
    TSType::TSTypeReference(TSTypeReference::boxed(
        SPAN,
        TSTypeName::QualifiedName(qual),
        Some(inst),
        ast,
    ))
}

/// Extracts any explicit TypeScript type annotation on a class property or accessor.
fn find_property_ts_type<'a>(
    class: Option<&Class<'a>>,
    prop_name: &str,
    allocator: &'a Allocator,
) -> Option<TSType<'a>> {
    if let Some(c) = class {
        for elem in &c.body.body {
            match elem {
                ClassElement::PropertyDefinition(prop)
                    if prop.key.is_specific_static_name(prop_name) =>
                {
                    if let Some(annot) = &prop.type_annotation {
                        return Some(annot.type_annotation.clone_in(allocator));
                    }
                }
                ClassElement::AccessorProperty(prop)
                    if prop.key.is_specific_static_name(prop_name) =>
                {
                    if let Some(annot) = &prop.type_annotation {
                        return Some(annot.type_annotation.clone_in(allocator));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Maps a property model type to a TypeScript AST type.
fn map_property_type_to_ts<'a>(
    prop: &PropertyInfo,
    original_class: Option<&Class<'a>>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> TSType<'a> {
    if let Some(existing) = find_property_ts_type(original_class, &prop.name, allocator) {
        return existing;
    }

    match prop.property_type {
        PropertyType::Boolean => TSType::TSBooleanKeyword(TSBooleanKeyword::boxed(SPAN, ast)),
        PropertyType::Number => TSType::TSNumberKeyword(TSNumberKeyword::boxed(SPAN, ast)),
        PropertyType::String => TSType::TSStringKeyword(TSStringKeyword::boxed(SPAN, ast)),
        PropertyType::Array => {
            let elem = TSType::TSAnyKeyword(TSAnyKeyword::boxed(SPAN, ast));
            TSType::TSArrayType(TSArrayType::boxed(SPAN, elem, ast))
        }
        PropertyType::Object => TSType::TSObjectKeyword(TSObjectKeyword::boxed(SPAN, ast)),
        PropertyType::Custom | PropertyType::Unknown => {
            TSType::TSAnyKeyword(TSAnyKeyword::boxed(SPAN, ast))
        }
    }
}

/// Builds the strongly-typed event callback function type:
/// `(event: CustomEvent<DetailType>) => void`
fn build_event_callback_type<'a>(
    event: &EventInfo,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> TSType<'a> {
    // 1. Detail generic type: CustomEvent<T> or CustomEvent<unknown>
    let detail_type = if let Some(dt) = &event.detail_type {
        build_id_type_ref(dt, ast, allocator)
    } else {
        TSType::TSUnknownKeyword(TSUnknownKeyword::boxed(SPAN, ast))
    };

    let mut generic_params = ArenaVec::new_in(ast);
    generic_params.push(detail_type);
    let custom_event_type = TSType::TSTypeReference(TSTypeReference::boxed(
        SPAN,
        TSTypeName::IdentifierReference(IdentifierReference::boxed(
            SPAN,
            allocator.alloc_str("CustomEvent"),
            ast,
        )),
        Some(TSTypeParameterInstantiation::boxed(
            SPAN,
            generic_params,
            ast,
        )),
        ast,
    ));

    // 2. Formal parameter: `event: CustomEvent<...>`
    let param_pattern =
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("event"), ast);
    let formal_param = FormalParameter::new(
        SPAN,
        ArenaVec::new_in(ast),
        param_pattern,
        Some(TSTypeAnnotation::boxed(SPAN, custom_event_type, ast)),
        None,
        false,
        None,
        false,
        false,
        ast,
    );
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(formal_param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        ast,
    );

    // 3. Return type: void
    let void_return = TSTypeAnnotation::boxed(
        SPAN,
        TSType::TSVoidKeyword(TSVoidKeyword::boxed(SPAN, ast)),
        ast,
    );

    TSType::TSFunctionType(TSFunctionType::boxed(
        SPAN,
        None,
        None,
        formal_params,
        void_return,
        ast,
    ))
}

/// Builds import declarations for the `.d.ts` file:
/// `import type * as React from 'react';`
/// `import type { MorphHost } from '@lit-core/morph-to-react/runtime';`
fn build_dts_imports<'a>(
    is_tier1: bool,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Vec<Statement<'a>> {
    let mut stmts = Vec::new();

    // 1. import type * as React from 'react';
    let mut react_specs = ArenaVec::new_in(ast);
    react_specs.push(ImportDeclarationSpecifier::new_import_namespace_specifier(
        SPAN,
        BindingIdentifier::new(SPAN, allocator.alloc_str("React"), ast),
        ast,
    ));
    let react_source = StringLiteral::new(
        SPAN,
        allocator.alloc_str("react"),
        Some(allocator.alloc_str("'react'").into()),
        ast,
    );
    let react_import = Statement::new_import_declaration(
        SPAN,
        Some(react_specs),
        react_source,
        None,
        None,
        ImportOrExportKind::Type,
        ast,
    );
    stmts.push(react_import);

    // 2. import type { MorphHost } from '@lit-core/morph-to-react/runtime';
    if is_tier1 {
        let mut runtime_specs = ArenaVec::new_in(ast);
        let imported =
            ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str("MorphHost"), ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str("MorphHost"), ast);
        runtime_specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            ast,
        ));
        let runtime_source = StringLiteral::new(
            SPAN,
            allocator.alloc_str("@lit-core/morph-to-react/runtime"),
            Some(
                allocator
                    .alloc_str("'@lit-core/morph-to-react/runtime'")
                    .into(),
            ),
            ast,
        );
        let runtime_import = Statement::new_import_declaration(
            SPAN,
            Some(runtime_specs),
            runtime_source,
            None,
            None,
            ImportOrExportKind::Type,
            ast,
        );
        stmts.push(runtime_import);
    }

    stmts
}

/// Builds the component Props interface declaration:
/// ```ts
/// export interface ComponentProps extends React.HTMLAttributes<HTMLElement> {
///   prop1?: string;
///   onEvent?: (event: CustomEvent<Detail>) => void;
///   children?: React.ReactNode;
/// }
/// ```
fn build_props_interface<'a>(
    component: &LitComponentInfo,
    original_class: Option<&Class<'a>>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Statement<'a> {
    let interface_name = allocator.alloc_str(&format!("{}Props", component.component_name));
    let id = BindingIdentifier::new(SPAN, interface_name, ast);

    // Heritage: extends React.HTMLAttributes<HTMLElement>
    let left_id = IdentifierReference::boxed(SPAN, allocator.alloc_str("React"), ast);
    let right_id = IdentifierName::new(SPAN, allocator.alloc_str("HTMLAttributes"), ast);
    let qual = TSQualifiedName::boxed(
        SPAN,
        TSTypeName::IdentifierReference(left_id),
        right_id,
        ast,
    );
    let mut html_attr_args = ArenaVec::new_in(ast);
    html_attr_args.push(build_id_type_ref("HTMLElement", ast, allocator));
    let inst = TSTypeParameterInstantiation::boxed(SPAN, html_attr_args, ast);
    let heritage = TSInterfaceHeritage::new(SPAN, TSTypeName::QualifiedName(qual), Some(inst), ast);
    let mut extends_vec = ArenaVec::new_in(ast);
    extends_vec.push(heritage);

    // Signatures in interface body
    let mut signatures = ArenaVec::new_in(ast);

    // 1. Reactive properties
    for prop in &component.properties {
        let ts_type = map_property_type_to_ts(prop, original_class, ast, allocator);
        let key = PropertyKey::new_static_identifier(SPAN, allocator.alloc_str(&prop.name), ast);
        let annot = TSTypeAnnotation::boxed(SPAN, ts_type, ast);
        let prop_sig = TSPropertySignature::boxed(
            SPAN,
            false, // computed
            true,  // optional
            false, // readonly
            key,
            Some(annot),
            ast,
        );
        signatures.push(TSSignature::TSPropertySignature(prop_sig));
    }

    // 2. Custom event callbacks
    for event in &component.events {
        let callback_type = build_event_callback_type(event, ast, allocator);
        let key =
            PropertyKey::new_static_identifier(SPAN, allocator.alloc_str(&event.prop_name), ast);
        let annot = TSTypeAnnotation::boxed(SPAN, callback_type, ast);
        let prop_sig = TSPropertySignature::boxed(
            SPAN,
            false, // computed
            true,  // optional
            false, // readonly
            key,
            Some(annot),
            ast,
        );
        signatures.push(TSSignature::TSPropertySignature(prop_sig));
    }

    // 3. Children prop: children?: React.ReactNode;
    {
        let key = PropertyKey::new_static_identifier(SPAN, allocator.alloc_str("children"), ast);
        let react_node = build_qualified_type_ref("React", "ReactNode", ast, allocator);
        let annot = TSTypeAnnotation::boxed(SPAN, react_node, ast);
        let prop_sig = TSPropertySignature::boxed(
            SPAN,
            false, // computed
            true,  // optional
            false, // readonly
            key,
            Some(annot),
            ast,
        );
        signatures.push(TSSignature::TSPropertySignature(prop_sig));
    }

    let body = TSInterfaceBody::boxed(SPAN, signatures, ast);
    let interface_decl = TSInterfaceDeclaration::boxed(
        SPAN,
        id,
        None,
        extends_vec,
        body,
        false, // declare
        ast,
    );

    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::TSInterfaceDeclaration(interface_decl),
        ast,
    ))
}

/// Builds the host class declaration for Tier 1 and Tier 2 components:
/// ```ts
/// export declare class ComponentHost extends MorphHost {
///   prop1: string;
///   focus(): boolean;
/// }
/// ```
fn build_host_class_declaration<'a>(
    component: &LitComponentInfo,
    original_class: Option<&Class<'a>>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Statement<'a> {
    let host_class_name = allocator.alloc_str(&format!("{}Host", component.component_name));
    let class_id = Some(BindingIdentifier::new(SPAN, host_class_name, ast));
    let super_class = Some(Expression::new_identifier(
        SPAN,
        allocator.alloc_str("MorphHost"),
        ast,
    ));

    let mut class_elements = ArenaVec::new_in(ast);

    // 1. Properties
    for prop in &component.properties {
        let ts_type = map_property_type_to_ts(prop, original_class, ast, allocator);
        let key = PropertyKey::new_static_identifier(SPAN, allocator.alloc_str(&prop.name), ast);
        let annot = TSTypeAnnotation::boxed(SPAN, ts_type, ast);
        let prop_def = ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(ast),
            key,
            Some(annot),
            None,  // value: none in d.ts
            false, // computed
            false, // static
            false, // declare
            false, // override
            false, // optional
            false, // definite
            false, // readonly
            None,  // accessibility
            ast,
        );
        class_elements.push(prop_def);
    }

    // 2. Public methods from original class (excluding lifecycle hooks)
    if let Some(c) = original_class {
        for elem in &c.body.body {
            if let ClassElement::MethodDefinition(method) = elem
                && !method.r#static
            {
                let name = method.key.static_name().unwrap_or_default();
                let is_lifecycle = matches!(
                    name.as_ref(),
                    "render"
                        | "connectedCallback"
                        | "disconnectedCallback"
                        | "willUpdate"
                        | "update"
                        | "updated"
                        | "firstUpdated"
                        | "shouldUpdate"
                        | "requestUpdate"
                        | "scheduleUpdate"
                );
                let is_private = name.starts_with('_') || name.starts_with('#');

                if !is_lifecycle && !is_private {
                    // Extract method return type or fallback to any
                    let ret_annot = method
                        .value
                        .return_type
                        .as_ref()
                        .map(|rt| rt.clone_in(allocator))
                        .unwrap_or_else(|| {
                            TSTypeAnnotation::boxed(
                                SPAN,
                                TSType::TSAnyKeyword(TSAnyKeyword::boxed(SPAN, ast)),
                                ast,
                            )
                        });

                    let func = Function::boxed(
                        SPAN,
                        FunctionType::FunctionDeclaration,
                        None,
                        false,
                        false,
                        false,
                        None,
                        None,
                        method.value.params.clone_in(allocator),
                        Some(ret_annot),
                        None, // body is None in declaration
                        ast,
                    );

                    let method_def = ClassElement::new_method_definition(
                        SPAN,
                        MethodDefinitionType::MethodDefinition,
                        ArenaVec::new_in(ast),
                        method.key.clone_in(allocator),
                        func,
                        MethodDefinitionKind::Method,
                        false,
                        false,
                        false,
                        false,
                        None,
                        ast,
                    );
                    class_elements.push(method_def);
                }
            }
        }
    }

    let heritage = super_class.map(|expr| ClassHeritage::new(expr, None, ast));
    let class_decl = Class::boxed(
        SPAN,
        ClassType::ClassDeclaration,
        ArenaVec::new_in(ast),
        class_id,
        None,
        heritage,
        ArenaVec::new_in(ast),
        ClassBody::boxed(SPAN, class_elements, ast),
        false, // abstract
        true,  // declare
        ast,
    );

    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::ClassDeclaration(class_decl),
        ast,
    ))
}

/// Builds the exported ForwardRef component declaration:
/// ```ts
/// export declare const Component: React.ForwardRefExoticComponent<
///   React.PropsWithoutRef<ComponentProps> & React.RefAttributes<ComponentHost>
/// >;
/// ```
fn build_forward_ref_component_declaration<'a>(
    component: &LitComponentInfo,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Statement<'a> {
    let props_type_name = format!("{}Props", component.component_name);
    let host_type_name = format!("{}Host", component.component_name);

    // 1. React.PropsWithoutRef<ComponentProps>
    let mut props_args = ArenaVec::new_in(ast);
    props_args.push(build_id_type_ref(&props_type_name, ast, allocator));
    let props_without_ref =
        build_generic_qualified_type_ref("React", "PropsWithoutRef", props_args, ast, allocator);

    // 2. React.RefAttributes<ComponentHost>
    let mut ref_args = ArenaVec::new_in(ast);
    ref_args.push(build_id_type_ref(&host_type_name, ast, allocator));
    let ref_attributes =
        build_generic_qualified_type_ref("React", "RefAttributes", ref_args, ast, allocator);

    // 3. React.PropsWithoutRef<ComponentProps> & React.RefAttributes<ComponentHost>
    let mut intersection_types = ArenaVec::new_in(ast);
    intersection_types.push(props_without_ref);
    intersection_types.push(ref_attributes);
    let intersection =
        TSType::TSIntersectionType(TSIntersectionType::boxed(SPAN, intersection_types, ast));

    // 4. React.ForwardRefExoticComponent<Intersection>
    let mut fwd_args = ArenaVec::new_in(ast);
    fwd_args.push(intersection);
    let forward_ref_type = build_generic_qualified_type_ref(
        "React",
        "ForwardRefExoticComponent",
        fwd_args,
        ast,
        allocator,
    );

    let comp_id = BindingPattern::new_binding_identifier(
        SPAN,
        allocator.alloc_str(&component.component_name),
        ast,
    );
    let annot = TSTypeAnnotation::boxed(SPAN, forward_ref_type, ast);

    let mut declarators = ArenaVec::new_in(ast);
    declarators.push(VariableDeclarator::new(
        SPAN,
        comp_id,
        Some(annot),
        None,  // init is None in declare const
        false, // definite
        ast,
    ));

    let var_decl = VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        declarators,
        true, // declare
        ast,
    );

    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        ast,
    ))
}

/// Builds the exported Tier 0 pure function declaration:
/// `export declare function Component(props: ComponentProps): React.JSX.Element;`
fn build_tier0_function_declaration<'a>(
    component: &LitComponentInfo,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Statement<'a> {
    let props_type_name = format!("{}Props", component.component_name);
    let props_type = build_id_type_ref(&props_type_name, ast, allocator);

    let param_pattern =
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("props"), ast);
    let formal_param = FormalParameter::new(
        SPAN,
        ArenaVec::new_in(ast),
        param_pattern,
        Some(TSTypeAnnotation::boxed(SPAN, props_type, ast)),
        None,
        false,
        None,
        false,
        false,
        ast,
    );
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(formal_param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        ast,
    );

    // Return type: React.JSX.Element
    let left_id = IdentifierReference::boxed(SPAN, allocator.alloc_str("React"), ast);
    let right_id = IdentifierName::new(SPAN, allocator.alloc_str("JSX"), ast);
    let qual_jsx = TSQualifiedName::boxed(
        SPAN,
        TSTypeName::IdentifierReference(left_id),
        right_id,
        ast,
    );
    let qual_element = TSQualifiedName::boxed(
        SPAN,
        TSTypeName::QualifiedName(qual_jsx),
        IdentifierName::new(SPAN, allocator.alloc_str("Element"), ast),
        ast,
    );
    let return_annot = TSTypeAnnotation::boxed(
        SPAN,
        TSType::TSTypeReference(TSTypeReference::boxed(
            SPAN,
            TSTypeName::QualifiedName(qual_element),
            None,
            ast,
        )),
        ast,
    );

    let func_name = allocator.alloc_str(&component.component_name);
    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, func_name, ast)),
        false,
        false,
        true, // declare
        None,
        None,
        formal_params,
        Some(return_annot),
        None, // body: None
        ast,
    );

    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::FunctionDeclaration(func),
        ast,
    ))
}

/// Generates a complete TypeScript `.d.ts` declaration file for a compiled Lit component.
pub fn emit_dts_declarations<'a>(
    allocator: &'a Allocator,
    component: &LitComponentInfo,
    original_class: Option<&Class<'a>>,
    is_tier1: bool,
) -> Result<String, String> {
    let ast = AstBuilder::new(allocator);

    let mut prog_stmts = ArenaVec::new_in(&ast);

    // 1. Imports
    for stmt in build_dts_imports(is_tier1, &ast, allocator) {
        prog_stmts.push(stmt);
    }

    // 2. Props interface
    let props_stmt = build_props_interface(component, original_class, &ast, allocator);
    prog_stmts.push(props_stmt);

    // 3. Host class & component declarations
    if is_tier1 {
        let host_stmt = build_host_class_declaration(component, original_class, &ast, allocator);
        prog_stmts.push(host_stmt);

        let comp_stmt = build_forward_ref_component_declaration(component, &ast, allocator);
        prog_stmts.push(comp_stmt);
    } else {
        let func_stmt = build_tier0_function_declaration(component, &ast, allocator);
        prog_stmts.push(func_stmt);
    }

    let program = Program::new(
        SPAN,
        SourceType::d_ts(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        prog_stmts,
        &ast,
    );

    let dts_code = oxc_codegen::Codegen::new().build(&program).code;
    Ok(dts_code)
}
