use crate::emit_css::build_jsx_style_element;
use crate::emit_jsx::{
    collect_constant_strings, collect_static_ids, lower_expression_lit_templates,
    lower_range_in_statement, lower_statement_lit_templates, rewrite_statement_this_to_host,
    ComponentTagRegistry, JsxEmitOptions, JsxEmitter, QueryLoweringInfo, TemplateLoweringScope,
    ThisRewritingTarget,
};
use crate::CompileOptionsDto;
use lit_analysis::{LitComponentInfo, PropertyModelExtractor, PropertyType};
use oxc_allocator::{Allocator, ArenaBox, ArenaVec, CloneIn};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

/// Scans a component class for @query and @queryAll decorators.
pub fn scan_queries<'a>(
    class: Option<&Class<'a>>,
    _component: &LitComponentInfo,
    symbol_ctx: Option<&lit_analysis::SymbolProofContext<'a>>,
) -> Vec<QueryLoweringInfo> {
    let mut queries = Vec::new();

    if let Some(c) = class {
        if let Some(ctx) = symbol_ctx {
            let member_decs = lit_analysis::DecoratorExtractor::extract_member_decorators(c, ctx);
            for dec in member_decs {
                let prop_name = match dec.target_member {
                    Some(name) => name,
                    None => continue,
                };
                match dec.kind {
                    lit_analysis::LitDecoratorKind::Query { selector } => {
                        queries.push(QueryLoweringInfo {
                            ref_var_name: format!("{}Ref", prop_name),
                            property_name: prop_name,
                            selector,
                            is_all: false,
                        });
                    }
                    lit_analysis::LitDecoratorKind::QueryAll { selector } => {
                        queries.push(QueryLoweringInfo {
                            ref_var_name: format!("{}Ref", prop_name),
                            property_name: prop_name,
                            selector,
                            is_all: true,
                        });
                    }
                    _ => {}
                }
            }
        } else {
            for element in &c.body.body {
                match element {
                    ClassElement::PropertyDefinition(prop) => {
                        let prop_name = prop.key.static_name().unwrap_or_default();
                        for dec in &prop.decorators {
                            if let Expression::CallExpression(call) = &dec.expression {
                                let callee_name = match &call.callee {
                                    Expression::Identifier(id) => Some(id.name.as_str()),
                                    Expression::StaticMemberExpression(mem) => {
                                        Some(mem.property.name.as_str())
                                    }
                                    _ => None,
                                };
                                if let Some(name) = callee_name {
                                    if name == "query" || name == "queryAll" {
                                        let is_all = name == "queryAll";
                                        if let Some(arg0) = call.arguments.first() {
                                            if let Some(Expression::StringLiteral(lit)) =
                                                arg0.as_expression()
                                            {
                                                queries.push(QueryLoweringInfo {
                                                    property_name: prop_name.to_string(),
                                                    selector: lit.value.as_str().to_string(),
                                                    ref_var_name: format!("{}Ref", prop_name),
                                                    is_all,
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    ClassElement::AccessorProperty(prop) => {
                        let prop_name = prop.key.static_name().unwrap_or_default();
                        for dec in &prop.decorators {
                            if let Expression::CallExpression(call) = &dec.expression {
                                let callee_name = match &call.callee {
                                    Expression::Identifier(id) => Some(id.name.as_str()),
                                    Expression::StaticMemberExpression(mem) => {
                                        Some(mem.property.name.as_str())
                                    }
                                    _ => None,
                                };
                                if let Some(name) = callee_name {
                                    if name == "query" || name == "queryAll" {
                                        let is_all = name == "queryAll";
                                        if let Some(arg0) = call.arguments.first() {
                                            if let Some(Expression::StringLiteral(lit)) =
                                                arg0.as_expression()
                                            {
                                                queries.push(QueryLoweringInfo {
                                                    property_name: prop_name.to_string(),
                                                    selector: lit.value.as_str().to_string(),
                                                    ref_var_name: format!("{}Ref", prop_name),
                                                    is_all,
                                                });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    queries
}

/// Builds import statements for React and the MorphHost runtime.
pub fn build_tier1_imports<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    required_helpers: &std::collections::BTreeSet<String>,
) -> (Statement<'a>, Statement<'a>) {
    // 1. import React, { forwardRef, useRef } from 'react';
    let mut react_specs = ArenaVec::new_in(ast);
    react_specs.push(ImportDeclarationSpecifier::new_import_default_specifier(
        SPAN,
        BindingIdentifier::new(SPAN, allocator.alloc_str("React"), ast),
        ast,
    ));
    for name in &["forwardRef", "useRef"] {
        let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(name), ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(name), ast);
        react_specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            ast,
        ));
    }
    let react_source = StringLiteral::new(SPAN, allocator.alloc_str("react"), None, ast);
    let react_import = Statement::new_import_declaration(
        SPAN,
        Some(react_specs),
        react_source,
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    );

    // 2. import { MorphHost, useMorphHost, ...required_helpers } from '@lit-core/morph-to-react/runtime';
    let mut runtime_specs = ArenaVec::new_in(ast);
    for name in &["MorphHost", "useMorphHost"] {
        let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(name), ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(name), ast);
        runtime_specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            ast,
        ));
    }
    for name in required_helpers {
        let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(name), ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(name), ast);
        runtime_specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            ast,
        ));
    }
    let runtime_source = StringLiteral::new(
        SPAN,
        allocator.alloc_str("@lit-core/morph-to-react/runtime"),
        None,
        ast,
    );
    let runtime_import = Statement::new_import_declaration(
        SPAN,
        Some(runtime_specs),
        runtime_source,
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    );

    (react_import, runtime_import)
}

/// Builds query getter method on ComponentNameHost:
/// ```ts
/// get btn() {
///   return this._queryRefs['btn']?.current ?? this.querySelector('#btn');
/// }
/// ```
fn build_query_getter<'a>(
    query: &QueryLoweringInfo,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> ClassElement<'a> {
    let prop_name = allocator.alloc_str(&query.property_name);
    let selector = allocator.alloc_str(&query.selector);

    // this.querySelector(selector) or this.querySelectorAll(selector)
    let fallback_query = {
        let this_expr = Expression::new_this_expression(SPAN, ast);
        let query_fn_name = if query.is_all {
            "querySelectorAll"
        } else {
            "querySelector"
        };
        let query_fn_member = Expression::new_static_member_expression(
            SPAN,
            this_expr,
            IdentifierName::new(SPAN, allocator.alloc_str(query_fn_name), ast),
            false,
            ast,
        );
        let mut args = ArenaVec::new_in(ast);
        args.push(Argument::from(Expression::new_string_literal(
            SPAN, selector, None, ast,
        )));
        Expression::new_call_expression(SPAN, query_fn_member, None, args, false, ast)
    };

    let return_expr = if query.is_all {
        fallback_query
    } else {
        // this._queryRefs['prop']
        let this_expr = Expression::new_this_expression(SPAN, ast);
        let query_refs_member = Expression::new_static_member_expression(
            SPAN,
            this_expr,
            IdentifierName::new(SPAN, allocator.alloc_str("_queryRefs"), ast),
            false,
            ast,
        );
        let prop_key_expr = Expression::new_string_literal(SPAN, prop_name, None, ast);
        let ref_access = Expression::new_computed_member_expression(
            SPAN,
            query_refs_member,
            prop_key_expr,
            false,
            ast,
        );

        // ref_access.current
        let ref_current = Expression::new_static_member_expression(
            SPAN,
            ref_access.clone_in(allocator),
            IdentifierName::new(SPAN, allocator.alloc_str("current"), ast),
            false,
            ast,
        );

        // ref_current !== null
        let ref_current_not_null = Expression::new_binary_expression(
            SPAN,
            ref_current.clone_in(allocator),
            BinaryOperator::StrictInequality,
            Expression::new_null_literal(SPAN, ast),
            ast,
        );

        // ref_access && (ref_current !== null)
        let test_expr = Expression::new_logical_expression(
            SPAN,
            ref_access,
            LogicalOperator::And,
            ref_current_not_null,
            ast,
        );

        // fallback_query ?? null
        let fallback_coalesce = Expression::new_logical_expression(
            SPAN,
            fallback_query,
            LogicalOperator::Coalesce,
            Expression::new_null_literal(SPAN, ast),
            ast,
        );

        // test_expr ? ref_current : (fallback_query ?? null)
        Expression::new_conditional_expression(SPAN, test_expr, ref_current, fallback_coalesce, ast)
    };

    let mut stmts = ArenaVec::new_in(ast);
    stmts.push(Statement::new_return_statement(
        SPAN,
        Some(return_expr),
        ast,
    ));

    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
        None,
        ast,
    );

    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        params,
        None,
        Some(func_body),
        ast,
    );

    let getter_key = PropertyKey::new_static_identifier(SPAN, prop_name, ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        getter_key,
        func,
        MethodDefinitionKind::Get,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

/// Parses a string literal or falls back to property type default.
fn parse_literal_or_fallback<'a>(
    val_str: &str,
    prop_type: PropertyType,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
) -> Expression<'a> {
    match prop_type {
        PropertyType::Boolean => {
            let b = val_str == "true" || val_str == "!0";
            Expression::new_boolean_literal(SPAN, b, ast)
        }
        PropertyType::Number => {
            if let Ok(num) = val_str.parse::<f64>() {
                Expression::new_numeric_literal(SPAN, num, None, NumberBase::Decimal, ast)
            } else {
                Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast)
            }
        }
        PropertyType::String => {
            let trimmed = val_str.trim_matches(|c| c == '\'' || c == '"');
            Expression::new_string_literal(SPAN, allocator.alloc_str(trimmed), None, ast)
        }
        _ => Expression::new_null_literal(SPAN, ast),
    }
}

/// Recursively lowers a class heritage expression, replacing LitElement with MorphHost
/// or base custom element classes with their corresponding <Base>Host identifiers.
pub fn lower_heritage_expression<'a>(
    expr: &Expression<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    base_class_mapping: Option<(&str, &str)>, // (original_name, host_name)
    symbol_ctx: Option<&lit_analysis::SymbolProofContext<'a>>,
) -> Expression<'a> {
    match expr {
        Expression::Identifier(ident) => {
            let is_lit_base = if let Some(ctx) = symbol_ctx {
                matches!(
                    ctx.resolve_symbol(ident),
                    Some(lit_analysis::CanonicalLitSymbol::LitElement)
                        | Some(lit_analysis::CanonicalLitSymbol::ReactiveElement)
                ) || ident.name == "LitElement"
                    || ident.name == "ReactiveElement"
            } else {
                ident.name == "LitElement" || ident.name == "ReactiveElement"
            };

            if is_lit_base {
                Expression::new_identifier(SPAN, allocator.alloc_str("MorphHost"), ast)
            } else if let Some((orig, host)) = base_class_mapping {
                if ident.name == orig {
                    Expression::new_identifier(SPAN, allocator.alloc_str(host), ast)
                } else {
                    expr.clone_in(allocator)
                }
            } else {
                expr.clone_in(allocator)
            }
        }
        Expression::CallExpression(call) => {
            let new_callee = call.callee.clone_in(allocator);
            let mut new_args = ArenaVec::new_in(ast);

            for arg in &call.arguments {
                match arg {
                    Argument::SpreadElement(spread) => {
                        new_args.push(Argument::SpreadElement(spread.clone_in(allocator)));
                    }
                    _ => {
                        if let Some(arg_expr) = arg.as_expression() {
                            let lowered_arg = lower_heritage_expression(
                                arg_expr,
                                ast,
                                allocator,
                                base_class_mapping,
                                symbol_ctx,
                            );
                            new_args.push(Argument::from(lowered_arg));
                        } else {
                            new_args.push(arg.clone_in(allocator));
                        }
                    }
                }
            }

            Expression::new_call_expression(SPAN, new_callee, None, new_args, false, ast)
        }
        _ => expr.clone_in(allocator),
    }
}

/// Builds ComponentNameHost extends MorphHost class declaration.
pub fn build_host_class<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    component: &LitComponentInfo,
    queries: &[QueryLoweringInfo],
    original_class: Option<&Class<'a>>,
    emitter: &mut JsxEmitter<'a, '_>,
) -> Statement<'a> {
    let host_class_name = allocator.alloc_str(&format!("{}Host", component.component_name));
    let class_id = Some(BindingIdentifier::new(SPAN, host_class_name, ast));

    let host_base_name = component.super_class.as_ref().map(|base| {
        if base == "LitElement" || base == "ReactiveElement" {
            "MorphHost".to_string()
        } else {
            format!("{}Host", base)
        }
    });

    let base_mapping = match (&component.super_class, &host_base_name) {
        (Some(orig), Some(host)) if orig != "LitElement" && orig != "ReactiveElement" => {
            Some((orig.as_str(), host.as_str()))
        }
        _ => None,
    };

    let super_class = if let Some(orig) = original_class {
        if let Some(h) = &orig.heritage {
            Some(lower_heritage_expression(
                &h.expression,
                ast,
                allocator,
                base_mapping,
                emitter.symbol_ctx,
            ))
        } else if let Some(ref host) = host_base_name {
            Some(Expression::new_identifier(
                SPAN,
                allocator.alloc_str(host),
                ast,
            ))
        } else {
            Some(Expression::new_identifier(
                SPAN,
                allocator.alloc_str("MorphHost"),
                ast,
            ))
        }
    } else if let Some(ref host) = host_base_name {
        Some(Expression::new_identifier(
            SPAN,
            allocator.alloc_str(host),
            ast,
        ))
    } else {
        Some(Expression::new_identifier(
            SPAN,
            allocator.alloc_str("MorphHost"),
            ast,
        ))
    };

    let is_subclass = component
        .super_class
        .as_deref()
        .is_some_and(|s| s != "LitElement" && s != "ReactiveElement")
        || !component.mixins.is_empty();

    let mut class_elements = ArenaVec::new_in(ast);

    // 1. Property definitions from Lit property model
    let mut default_props_obj = ArenaVec::new_in(ast);

    if is_subclass {
        let super_expr = Expression::new_super(SPAN, ast);
        let super_prop = Expression::new_static_member_expression(
            SPAN,
            super_expr,
            IdentifierName::new(SPAN, allocator.alloc_str("_propertyDefaults"), ast),
            false,
            ast,
        );
        let spread = SpreadElement::boxed(SPAN, super_prop, ast);
        default_props_obj.push(ObjectPropertyKind::SpreadProperty(spread));
    }
    for prop in &component.properties {
        let prop_name = allocator.alloc_str(&prop.name);
        let key = PropertyKey::new_static_identifier(SPAN, prop_name, ast);

        let init_expr = if let Some(init_str) = &prop.default_value {
            parse_literal_or_fallback(init_str, prop.property_type, ast, allocator)
        } else {
            match prop.property_type {
                PropertyType::Boolean => Expression::new_boolean_literal(SPAN, false, ast),
                PropertyType::Number => {
                    Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast)
                }
                PropertyType::String => {
                    Expression::new_string_literal(SPAN, allocator.alloc_str(""), None, ast)
                }
                _ => Expression::new_null_literal(SPAN, ast),
            }
        };

        let prop_def = ClassElement::new_property_definition(
            SPAN,
            PropertyDefinitionType::PropertyDefinition,
            ArenaVec::new_in(ast),
            key,
            None,
            Some(init_expr.clone_in(allocator)),
            false,
            false, // static = false
            false,
            false,
            false,
            false,
            false,
            None,
            ast,
        );
        class_elements.push(prop_def);

        let obj_key = PropertyKey::new_static_identifier(SPAN, prop_name, ast);
        let obj_prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            obj_key,
            init_expr,
            false,
            false,
            false,
            ast,
        );
        default_props_obj.push(obj_prop);
    }

    // 2. static readonly _propertyDefaults = { ... }
    let defaults_key = PropertyKey::new_static_identifier(SPAN, "_propertyDefaults", ast);
    let defaults_val = Expression::new_object_expression(SPAN, default_props_obj, ast);
    let defaults_def = ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        defaults_key,
        None,
        Some(defaults_val),
        false,
        true, // static = true
        false,
        false,
        false, // optional = false
        false,
        false,
        None,
        ast,
    );
    class_elements.push(defaults_def);

    // 3. _queryRefs = {}
    let query_refs_key = PropertyKey::new_static_identifier(SPAN, "_queryRefs", ast);
    let query_refs_val = Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast);
    let query_refs_def = ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        query_refs_key,
        None,
        Some(query_refs_val),
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    );
    class_elements.push(query_refs_def);

    // 4. Query getters: get btn() { return this._queryRefs['btn']?.current ?? this.querySelector('...'); }
    for q in queries {
        let getter_elem = build_query_getter(q, ast, allocator);
        class_elements.push(getter_elem);
    }

    // 5. Carry over author methods and static properties from original class (excluding render())
    if let Some(orig) = original_class {
        for elem in &orig.body.body {
            match elem {
                ClassElement::PropertyDefinition(prop) => {
                    if prop.r#static {
                        if prop.key.is_specific_static_name("formAssociated") {
                            let mut cloned = elem.clone_in(allocator);
                            if let ClassElement::PropertyDefinition(ref mut p) = cloned {
                                p.decorators.clear();
                            }
                            class_elements.push(cloned);
                        }
                    } else {
                        let is_lit_prop = component
                            .properties
                            .iter()
                            .any(|p| prop.key.is_specific_static_name(&p.name));
                        if !is_lit_prop {
                            let mut cloned = elem.clone_in(allocator);
                            if let ClassElement::PropertyDefinition(ref mut p) = cloned {
                                p.decorators.clear();
                                if let Some(ref mut val) = p.value {
                                    lower_expression_lit_templates(
                                        val,
                                        ast,
                                        allocator,
                                        emitter,
                                        TemplateLoweringScope::HostClassMethod,
                                    );
                                }
                            }
                            class_elements.push(cloned);
                        }
                    }
                }
                ClassElement::MethodDefinition(method) => {
                    if !method.r#static && method.key.is_specific_static_name("render") {
                        continue; // render() is lowered into React component function
                    }
                    let mut cloned = elem.clone_in(allocator);
                    if let ClassElement::MethodDefinition(ref mut m) = cloned {
                        m.decorators.clear();
                        if let Some(ref mut body) = m.value.body {
                            for s in &mut body.statements {
                                lower_statement_lit_templates(
                                    s,
                                    ast,
                                    allocator,
                                    emitter,
                                    TemplateLoweringScope::HostClassMethod,
                                );
                            }
                        }
                    }
                    class_elements.push(cloned);
                }
                _ => {}
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
        false,
        false,
        ast,
    );

    Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::ClassDeclaration(class_decl),
        ast,
    ))
}

/// Builds the root custom element tag JSX element:
/// ```tsx
/// <custom-tag
///   ref={elementRef}
///   id={props.id}
///   className={props.className}
///   style={props.style}
///   ...reflected attributes...
/// Determines if a Lit component genuinely requires form proxy input emission.
pub fn is_component_form_associated<'a>(
    _component: &LitComponentInfo,
    class: Option<&Class<'a>>,
) -> bool {
    let Some(c) = class else {
        return false;
    };

    for element in &c.body.body {
        match element {
            // 1. Static property: static formAssociated = true;
            ClassElement::PropertyDefinition(prop) => {
                if prop.r#static && prop.key.is_specific_static_name("formAssociated") {
                    if let Some(val) = &prop.value {
                        if PropertyModelExtractor::evaluate_boolean(val).unwrap_or(false) {
                            return true;
                        }
                    }
                }
                // Check if property initializer calls attachInternals: internals = this.attachInternals();
                if let Some(val) = &prop.value {
                    if expr_calls_form_api(val) {
                        return true;
                    }
                }
            }
            // 2. Methods and static getters
            ClassElement::MethodDefinition(method) => {
                // Static getter: static get formAssociated() { return true; }
                if method.r#static
                    && method.kind == MethodDefinitionKind::Get
                    && method.key.is_specific_static_name("formAssociated")
                {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    if PropertyModelExtractor::evaluate_boolean(arg)
                                        .unwrap_or(false)
                                    {
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }

                // Standard form lifecycle callbacks
                if let Some(name) = method.key.static_name() {
                    if matches!(
                        name.as_ref(),
                        "formResetCallback"
                            | "formDisabledCallback"
                            | "formStateRestoreCallback"
                            | "formAssociatedCallback"
                    ) {
                        return true;
                    }
                }

                // Check method body (including constructor) for attachInternals() / setFormValue()
                if let Some(body) = &method.value.body {
                    for stmt in &body.statements {
                        if stmt_calls_form_api(stmt) {
                            return true;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    false
}

fn stmt_calls_form_api<'a>(stmt: &'a Statement<'a>) -> bool {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => expr_calls_form_api(&expr_stmt.expression),
        Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().any(|d| {
            d.init
                .as_ref()
                .is_some_and(|init| expr_calls_form_api(init))
        }),
        Statement::ReturnStatement(ret) => ret
            .argument
            .as_ref()
            .is_some_and(|arg| expr_calls_form_api(arg)),
        Statement::BlockStatement(block) => block.body.iter().any(|s| stmt_calls_form_api(s)),
        _ => false,
    }
}

fn expr_calls_form_api<'a>(expr: &'a Expression<'a>) -> bool {
    match expr {
        Expression::CallExpression(call) => {
            if let Expression::StaticMemberExpression(mem) = &call.callee {
                let name = mem.property.name.as_str();
                if matches!(name, "attachInternals" | "setFormValue" | "setValidity") {
                    return true;
                }
            }
            call.arguments
                .iter()
                .any(|arg| arg.as_expression().is_some_and(|e| expr_calls_form_api(e)))
        }
        Expression::AssignmentExpression(assign) => expr_calls_form_api(&assign.right),
        Expression::ParenthesizedExpression(p) => expr_calls_form_api(&p.expression),
        Expression::UnaryExpression(u) => expr_calls_form_api(&u.argument),
        Expression::LogicalExpression(l) => {
            expr_calls_form_api(&l.left) || expr_calls_form_api(&l.right)
        }
        Expression::ConditionalExpression(c) => {
            expr_calls_form_api(&c.consequent) || expr_calls_form_api(&c.alternate)
        }
        Expression::SequenceExpression(seq) => {
            seq.expressions.iter().any(|e| expr_calls_form_api(e))
        }
        _ => false,
    }
}

/// Constructs the visually hidden proxy <input> JSX element via AstBuilder:
/// ```jsx
/// <input
///   type="text"
///   ref={host._proxyInputRef}
///   name={props.name}
///   disabled={props.disabled}
///   tabIndex={-1}
///   aria-hidden="true"
///   style={_proxyInputStyle}
/// />
/// ```
pub fn build_proxy_input_jsx<'a>(ast: &AstBuilder<'a>, allocator: &'a Allocator) -> JSXElement<'a> {
    let mut attrs = ArenaVec::new_in(ast);

    // 1. type="text"
    let type_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("type"), ast));
    let type_val = Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
        SPAN,
        allocator.alloc_str("text"),
        None,
        ast,
    )));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, type_name, type_val, ast,
    )));

    // 2. ref={host._proxyInputRef}
    let ref_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("ref"), ast));
    let ref_expr = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, allocator.alloc_str("host"), ast),
        IdentifierName::new(SPAN, allocator.alloc_str("_proxyInputRef"), ast),
        false,
        ast,
    );
    let ref_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(ref_expr), ast),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, ref_name, ref_val, ast,
    )));

    // 3. name={props.name}
    let name_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("name"), ast));
    let name_expr = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, allocator.alloc_str("props"), ast),
        IdentifierName::new(SPAN, allocator.alloc_str("name"), ast),
        false,
        ast,
    );
    let name_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(name_expr), ast),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, name_name, name_val, ast,
    )));

    // 4. disabled={props.disabled}
    let dis_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("disabled"),
        ast,
    ));
    let dis_expr = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, allocator.alloc_str("props"), ast),
        IdentifierName::new(SPAN, allocator.alloc_str("disabled"), ast),
        false,
        ast,
    );
    let dis_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(dis_expr), ast),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, dis_name, dis_val, ast,
    )));

    // 5. tabIndex={-1}
    let tab_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("tabIndex"),
        ast,
    ));
    let tab_expr = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::UnaryNegation,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let tab_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(tab_expr), ast),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, tab_name, tab_val, ast,
    )));

    // 6. aria-hidden="true"
    let aria_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("aria-hidden"),
        ast,
    ));
    let aria_val = Some(JSXAttributeValue::StringLiteral(StringLiteral::boxed(
        SPAN,
        allocator.alloc_str("true"),
        None,
        ast,
    )));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, aria_name, aria_val, ast,
    )));

    // 7. style={_proxyInputStyle}
    let style_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("style"),
        ast,
    ));
    let style_expr = Expression::new_identifier(SPAN, allocator.alloc_str("_proxyInputStyle"), ast);
    let style_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(SPAN, JSXExpression::from(style_expr), ast),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, style_name, style_val, ast,
    )));

    let elem_name = JSXElementName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("input"),
        ast,
    ));
    let opening = JSXOpeningElement::boxed(SPAN, elem_name, None, attrs, ast);

    JSXElement::new(SPAN, opening, ArenaVec::new_in(ast), None, ast)
}

/// Builds the root custom element tag wrapping component styles and template children:
/// ```jsx
/// <custom-tag
///   ref={elementRef}
///   id={props.id}
///   className={props.className}
///   style={props.style}
///   ...reflectedProps
/// >
///   {styleElement}
///   {proxyInput}
///   {templateChildren}
/// </custom-tag>
/// ```
pub fn build_root_host_jsx<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    host_tag: &str,
    component: &LitComponentInfo,
    style_element: Option<JSXElement<'a>>,
    template_children: ArenaVec<'a, JSXChild<'a>>,
    proxy_input: Option<JSXElement<'a>>,
) -> ArenaBox<'a, JSXElement<'a>> {
    let tag = allocator.alloc_str(host_tag);

    let mut attrs = ArenaVec::new_in(ast);

    // 1. ref={elementRef}
    let ref_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("ref"), ast));
    let ref_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(Expression::new_identifier(
                SPAN,
                allocator.alloc_str("elementRef"),
                ast,
            )),
            ast,
        ),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, ref_name, ref_val, ast,
    )));

    // 2. id={props.id}
    let id_name =
        JSXAttributeName::Identifier(JSXIdentifier::boxed(SPAN, allocator.alloc_str("id"), ast));
    let id_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("props"), ast),
                IdentifierName::new(SPAN, allocator.alloc_str("id"), ast),
                false,
                ast,
            )),
            ast,
        ),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, id_name, id_val, ast,
    )));

    // 3. className={props.className}
    let class_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("className"),
        ast,
    ));
    let class_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("props"), ast),
                IdentifierName::new(SPAN, allocator.alloc_str("className"), ast),
                false,
                ast,
            )),
            ast,
        ),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, class_name, class_val, ast,
    )));

    // 4. style={props.style}
    let style_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
        SPAN,
        allocator.alloc_str("style"),
        ast,
    ));
    let style_val = Some(JSXAttributeValue::ExpressionContainer(
        JSXExpressionContainer::boxed(
            SPAN,
            JSXExpression::from(Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("props"), ast),
                IdentifierName::new(SPAN, allocator.alloc_str("style"), ast),
                false,
                ast,
            )),
            ast,
        ),
    ));
    attrs.push(JSXAttributeItem::Attribute(JSXAttribute::boxed(
        SPAN, style_name, style_val, ast,
    )));

    // 5. Reflected attributes from component properties
    for prop in &component.properties {
        if prop.reflect {
            let attr_str = prop
                .attribute
                .clone()
                .unwrap_or_else(|| PropertyModelExtractor::to_kebab_case(&prop.name));
            let attr_name = JSXAttributeName::Identifier(JSXIdentifier::boxed(
                SPAN,
                allocator.alloc_str(&attr_str),
                ast,
            ));

            let host_prop_access = Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("host"), ast),
                IdentifierName::new(SPAN, allocator.alloc_str(&prop.name), ast),
                false,
                ast,
            );

            let attr_val_expr = match prop.property_type {
                PropertyType::Boolean => {
                    // host.prop ? "" : undefined
                    Expression::new_conditional_expression(
                        SPAN,
                        host_prop_access,
                        Expression::new_string_literal(SPAN, allocator.alloc_str(""), None, ast),
                        Expression::new_identifier(SPAN, allocator.alloc_str("undefined"), ast),
                        ast,
                    )
                }
                _ => {
                    // host.prop || undefined
                    Expression::new_logical_expression(
                        SPAN,
                        host_prop_access,
                        LogicalOperator::Or,
                        Expression::new_identifier(SPAN, allocator.alloc_str("undefined"), ast),
                        ast,
                    )
                }
            };

            let attr_item = JSXAttributeItem::Attribute(JSXAttribute::boxed(
                SPAN,
                attr_name,
                Some(JSXAttributeValue::ExpressionContainer(
                    JSXExpressionContainer::boxed(SPAN, JSXExpression::from(attr_val_expr), ast),
                )),
                ast,
            ));
            attrs.push(attr_item);
        }
    }

    let opening = JSXOpeningElement::boxed(
        SPAN,
        JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag, ast)),
        None,
        attrs,
        ast,
    );
    let closing = Some(JSXClosingElement::boxed(
        SPAN,
        JSXElementName::Identifier(JSXIdentifier::boxed(SPAN, tag, ast)),
        ast,
    ));

    let mut children = ArenaVec::new_in(ast);
    if let Some(style) = style_element {
        children.push(JSXChild::Element(JSXElement::boxed(
            style.span,
            style.opening_element,
            style.children,
            style.closing_element,
            ast,
        )));
    }
    if let Some(proxy) = proxy_input {
        children.push(JSXChild::Element(JSXElement::boxed(
            proxy.span,
            proxy.opening_element,
            proxy.children,
            proxy.closing_element,
            ast,
        )));
    }
    for child in template_children {
        children.push(child);
    }

    JSXElement::boxed(SPAN, opening, children, closing, ast)
}

/// Emits a Tier 1 hosted component module.
#[allow(clippy::too_many_arguments)]
pub fn emit_tier1_component<'a>(
    allocator: &'a Allocator,
    component: &LitComponentInfo,
    scoped_css: Option<&str>,
    stylesheet_id: Option<&str>,
    emit_css_file: bool,
    expressions: &[Expression<'a>],
    preceding_statements: &[Statement<'a>],
    original_class: Option<&Class<'a>>,
    tag_name: &str,
    _options: &CompileOptionsDto,
    tag_registry: Option<ComponentTagRegistry>,
    symbol_ctx: Option<&lit_analysis::SymbolProofContext<'a>>,
) -> Result<Program<'a>, String> {
    let ast = AstBuilder::new(allocator);

    // 1. Scan query decorators (@query and @queryAll)
    let queries = scan_queries(original_class, component, symbol_ctx);

    // 2. Scan template for static IDs for React.useId() rewriting
    let static_ids = if let Some(tmpl) = &component.template {
        collect_static_ids(tmpl)
    } else {
        std::collections::HashSet::new()
    };
    let has_static_ids = !static_ids.is_empty();

    // 3. Lower template nodes into JSX children
    let style_element = if !emit_css_file {
        if let (Some(css), Some(id)) = (scoped_css, stylesheet_id) {
            if !css.is_empty() {
                Some(build_jsx_style_element(id, css, "default", &ast))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let has_slots = component
        .template
        .as_ref()
        .map(|t| t.has_slots)
        .unwrap_or(false)
        || !component.slots.is_empty();
    let has_named_slots = component.slots.iter().any(|s| s.name.is_some());
    let has_slot_fallbacks = component.slots.iter().any(|s| s.has_fallback);
    let has_inspected_slots = component.slots.iter().any(|s| s.inspected);
    let needs_slot_partitioning =
        has_slots && (has_named_slots || has_slot_fallbacks || has_inspected_slots);

    let is_form_associated = is_component_form_associated(component, original_class);

    let emitter_options = JsxEmitOptions {
        is_tier0: false,
        preserve_whitespace: true,
        custom_element_suffix: None,
        static_ids,
        queries: queries.clone(),
        constant_strings: collect_constant_strings(preceding_statements),
        tag_registry,
        has_slot_partitioning: needs_slot_partitioning,
        declared_properties: component
            .properties
            .iter()
            .map(|p| p.name.clone())
            .collect(),
        this_rewriting: ThisRewritingTarget::Host,
        is_host_method: false,
    };

    let mut emitter = JsxEmitter::new(
        &ast,
        allocator,
        expressions,
        emitter_options,
        None, // styles are attached to the root host tag directly
    );
    emitter.symbol_ctx = symbol_ctx;

    if needs_slot_partitioning {
        emitter
            .required_runtime_imports
            .borrow_mut()
            .insert("partitionSlots".to_string());
    }
    if is_form_associated {
        emitter
            .required_runtime_imports
            .borrow_mut()
            .insert("_proxyInputStyle".to_string());
    }

    let proxy_input = if is_form_associated {
        Some(build_proxy_input_jsx(&ast, allocator))
    } else {
        None
    };

    let template_children = if let Some(tmpl) = &component.template {
        let mut children = ArenaVec::new_in(&ast);
        for root in &tmpl.roots {
            emitter.lower_node_into(root, &mut children);
        }
        children
    } else {
        // Fallback: {props.children}
        let mut children = ArenaVec::new_in(&ast);
        let children_prop = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast),
            IdentifierName::new(SPAN, allocator.alloc_str("children"), &ast),
            false,
            &ast,
        );
        children.push(JSXChild::ExpressionContainer(
            JSXExpressionContainer::boxed(SPAN, JSXExpression::from(children_prop), &ast),
        ));
        children
    };

    // 4. Carry over preceding statements from render(), rewriting `this.` to `host.` and range
    let mut lowered_preceding = Vec::new();
    for stmt in preceding_statements {
        let mut cloned = stmt.clone_in(allocator);
        lower_statement_lit_templates(
            &mut cloned,
            &ast,
            allocator,
            &mut emitter,
            TemplateLoweringScope::ComponentFunction,
        );
        lower_range_in_statement(&mut cloned, &ast, Some(&emitter.required_runtime_imports));
        rewrite_statement_this_to_host(&mut cloned, &ast);
        lowered_preceding.push(cloned);
    }

    // 5. Build ComponentNameHost extends MorphHost class (lowers author methods & properties)
    let host_class_stmt = build_host_class(
        &ast,
        allocator,
        component,
        &queries,
        original_class,
        &mut emitter,
    );

    let needs_slot_partitioning =
        needs_slot_partitioning || !emitter.seen_slots.borrow().is_empty();

    if needs_slot_partitioning {
        emitter
            .required_runtime_imports
            .borrow_mut()
            .insert("partitionSlots".to_string());
    }

    // 6. Build imports with required runtime helpers
    let (react_import, runtime_import) =
        build_tier1_imports(&ast, allocator, &emitter.required_runtime_imports.borrow());

    // 7. Build root host custom element tag
    let root_jsx = build_root_host_jsx(
        &ast,
        allocator,
        tag_name,
        component,
        style_element,
        template_children,
        proxy_input,
    );

    // 8. Build forwardRef function component body
    let mut body_stmts = ArenaVec::new_in(&ast);

    // const { host, elementRef, shouldRender } = useMorphHost(ComponentNameHost, props, forwardedRef);
    let host_class_name = allocator.alloc_str(&format!("{}Host", component.component_name));
    let use_morph_call = {
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("useMorphHost"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        args.push(Argument::from(Expression::new_identifier(
            SPAN,
            host_class_name,
            &ast,
        )));
        args.push(Argument::from(Expression::new_identifier(
            SPAN,
            allocator.alloc_str("props"),
            &ast,
        )));
        args.push(Argument::from(Expression::new_identifier(
            SPAN,
            allocator.alloc_str("forwardedRef"),
            &ast,
        )));
        Expression::new_call_expression(SPAN, callee, None, args, false, &ast)
    };

    let hook_decl = {
        let mut props_pattern = ArenaVec::new_in(&ast);
        for name in &["host", "elementRef", "shouldRender"] {
            let key = PropertyKey::new_static_identifier(SPAN, allocator.alloc_str(name), &ast);
            let val = BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str(name), &ast);
            props_pattern.push(BindingProperty::new(SPAN, key, val, true, false, &ast));
        }
        let pat = BindingPattern::new_object_pattern(SPAN, props_pattern, None, &ast);
        let mut declarators = ArenaVec::new_in(&ast);
        declarators.push(VariableDeclarator::new(
            SPAN,
            pat,
            None,
            Some(use_morph_call),
            false,
            &ast,
        ));
        Statement::VariableDeclaration(VariableDeclaration::boxed(
            SPAN,
            VariableDeclarationKind::Const,
            declarators,
            false,
            &ast,
        ))
    };
    body_stmts.push(hook_decl);

    // Feature 45: Top-level ref for caching previous element
    // const prevElementRef = useRef(null);
    let prev_elem_ref_decl = {
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("useRef"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        args.push(Argument::from(Expression::new_null_literal(SPAN, &ast)));
        let init_expr = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
        let pat = BindingPattern::new_binding_identifier(
            SPAN,
            allocator.alloc_str("prevElementRef"),
            &ast,
        );
        let mut declarators = ArenaVec::new_in(&ast);
        declarators.push(VariableDeclarator::new(
            SPAN,
            pat,
            None,
            Some(init_expr),
            false,
            &ast,
        ));
        Statement::VariableDeclaration(VariableDeclaration::boxed(
            SPAN,
            VariableDeclarationKind::Const,
            declarators,
            false,
            &ast,
        ))
    };
    body_stmts.push(prev_elem_ref_decl);

    let needs_slot_partitioning =
        needs_slot_partitioning || !emitter.seen_slots.borrow().is_empty();

    if needs_slot_partitioning {
        emitter
            .required_runtime_imports
            .borrow_mut()
            .insert("partitionSlots".to_string());
        let callee = Expression::new_identifier(SPAN, allocator.alloc_str("partitionSlots"), &ast);
        let mut args = ArenaVec::new_in(&ast);
        let props_ident = Expression::new_identifier(SPAN, allocator.alloc_str("props"), &ast);
        let children_prop = Expression::new_static_member_expression(
            SPAN,
            props_ident,
            IdentifierName::new(SPAN, allocator.alloc_str("children"), &ast),
            false,
            &ast,
        );
        args.push(Argument::from(children_prop));
        let call_expr = Expression::new_call_expression(SPAN, callee, None, args, false, &ast);
        let pat = BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("_slots"), &ast);
        let mut decls = ArenaVec::new_in(&ast);
        decls.push(VariableDeclarator::new(
            SPAN,
            pat,
            None,
            Some(call_expr),
            false,
            &ast,
        ));
        let slots_decl = Statement::VariableDeclaration(VariableDeclaration::boxed(
            SPAN,
            VariableDeclarationKind::Const,
            decls,
            false,
            &ast,
        ));
        body_stmts.push(slots_decl);

        // host._slots = _slots;
        let host_expr = Expression::new_identifier(SPAN, allocator.alloc_str("host"), &ast);
        let member_expr = AssignmentTarget::new_static_member_expression(
            SPAN,
            host_expr,
            IdentifierName::new(SPAN, allocator.alloc_str("_slots"), &ast),
            false,
            &ast,
        );
        let right_val = Expression::new_identifier(SPAN, allocator.alloc_str("_slots"), &ast);
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            member_expr,
            right_val,
            &ast,
        );
        body_stmts.push(Statement::ExpressionStatement(ExpressionStatement::boxed(
            SPAN, assign, &ast,
        )));
    }

    // Query ref declarations (only for single @query):
    // const btnNodeRef = useRef(null);
    // host._queryRefs['btnNode'] = btnNodeRef;
    for q in &queries {
        if q.is_all {
            continue;
        }
        let ref_init = {
            let callee = Expression::new_identifier(SPAN, allocator.alloc_str("useRef"), &ast);
            let mut args = ArenaVec::new_in(&ast);
            args.push(Argument::from(Expression::new_null_literal(SPAN, &ast)));
            Expression::new_call_expression(SPAN, callee, None, args, false, &ast)
        };
        let ref_decl = {
            let pat = BindingPattern::new_binding_identifier(
                SPAN,
                allocator.alloc_str(&q.ref_var_name),
                &ast,
            );
            let mut declarators = ArenaVec::new_in(&ast);
            declarators.push(VariableDeclarator::new(
                SPAN,
                pat,
                None,
                Some(ref_init),
                false,
                &ast,
            ));
            Statement::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Const,
                declarators,
                false,
                &ast,
            ))
        };
        body_stmts.push(ref_decl);

        // host._queryRefs['prop'] = refVar;
        let assign_stmt = {
            let this_expr = Expression::new_identifier(SPAN, allocator.alloc_str("host"), &ast);
            let query_refs_member = Expression::new_static_member_expression(
                SPAN,
                this_expr,
                IdentifierName::new(SPAN, allocator.alloc_str("_queryRefs"), &ast),
                false,
                &ast,
            );
            let prop_key = Expression::new_string_literal(
                SPAN,
                allocator.alloc_str(&q.property_name),
                None,
                &ast,
            );
            let member_expr = AssignmentTarget::new_computed_member_expression(
                SPAN,
                query_refs_member,
                prop_key,
                false,
                &ast,
            );
            let right_val =
                Expression::new_identifier(SPAN, allocator.alloc_str(&q.ref_var_name), &ast);
            let assign = Expression::new_assignment_expression(
                SPAN,
                AssignmentOperator::Assign,
                member_expr,
                right_val,
                &ast,
            );
            Statement::ExpressionStatement(ExpressionStatement::boxed(SPAN, assign, &ast))
        };
        body_stmts.push(assign_stmt);
    }

    // Static ID rewriting: const _id = React.useId();
    if has_static_ids {
        let use_id_call = {
            let callee = Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, allocator.alloc_str("React"), &ast),
                IdentifierName::new(SPAN, allocator.alloc_str("useId"), &ast),
                false,
                &ast,
            );
            Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(&ast), false, &ast)
        };
        let id_decl = {
            let pat = BindingPattern::new_binding_identifier(SPAN, "_id", &ast);
            let mut declarators = ArenaVec::new_in(&ast);
            declarators.push(VariableDeclarator::new(
                SPAN,
                pat,
                None,
                Some(use_id_call),
                false,
                &ast,
            ));
            Statement::VariableDeclaration(VariableDeclaration::boxed(
                SPAN,
                VariableDeclarationKind::Const,
                declarators,
                false,
                &ast,
            ))
        };
        body_stmts.push(id_decl);
    }

    // Feature 45: if (!shouldRender && prevElementRef.current !== null) { return prevElementRef.current; }
    let bailout_stmt = {
        let not_should_render = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::LogicalNot,
            Expression::new_identifier(SPAN, allocator.alloc_str("shouldRender"), &ast),
            &ast,
        );
        let prev_current = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, allocator.alloc_str("prevElementRef"), &ast),
            IdentifierName::new(SPAN, allocator.alloc_str("current"), &ast),
            false,
            &ast,
        );
        let prev_current_not_null = Expression::new_binary_expression(
            SPAN,
            prev_current.clone_in(allocator),
            BinaryOperator::StrictInequality,
            Expression::new_null_literal(SPAN, &ast),
            &ast,
        );
        let test_expr = Expression::new_logical_expression(
            SPAN,
            not_should_render,
            LogicalOperator::And,
            prev_current_not_null,
            &ast,
        );
        let ret_prev = Statement::new_return_statement(SPAN, Some(prev_current), &ast);
        Statement::new_if_statement(SPAN, test_expr, ret_prev, None, &ast)
    };
    body_stmts.push(bailout_stmt);

    // Carry over preceding statements from render()
    for stmt in lowered_preceding {
        body_stmts.push(stmt);
    }

    // Feature 45: return (prevElementRef.current = (<custom-tag ...>...</custom-tag>));
    let assign_target = AssignmentTarget::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, allocator.alloc_str("prevElementRef"), &ast),
        IdentifierName::new(SPAN, allocator.alloc_str("current"), &ast),
        false,
        &ast,
    );
    let assign_expr = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        assign_target,
        Expression::JSXElement(root_jsx),
        &ast,
    );
    let ret_stmt = Statement::new_return_statement(SPAN, Some(assign_expr), &ast);
    body_stmts.push(ret_stmt);

    // Inner function: function ComponentName(props, forwardedRef) { ... }
    let func_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(&ast), body_stmts, &ast);
    let mut params_vec = ArenaVec::new_in(&ast);
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("props"), &ast),
        &ast,
    ));
    params_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str("forwardedRef"), &ast),
        &ast,
    ));
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        &ast,
    );

    let inner_fn = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        Some(BindingIdentifier::new(
            SPAN,
            allocator.alloc_str(&component.component_name),
            &ast,
        )),
        false,
        false,
        false,
        None,
        None,
        formal_params,
        None,
        Some(func_body),
        &ast,
    );

    // forwardRef(function ComponentName(...) { ... })
    let forward_ref_callee =
        Expression::new_identifier(SPAN, allocator.alloc_str("forwardRef"), &ast);
    let mut fwd_args = ArenaVec::new_in(&ast);
    fwd_args.push(Argument::from(Expression::FunctionExpression(inner_fn)));
    let forward_ref_call =
        Expression::new_call_expression(SPAN, forward_ref_callee, None, fwd_args, false, &ast);

    // export const ComponentName = forwardRef(...);
    let comp_id = BindingPattern::new_binding_identifier(
        SPAN,
        allocator.alloc_str(&component.component_name),
        &ast,
    );
    let mut comp_decls = ArenaVec::new_in(&ast);
    comp_decls.push(VariableDeclarator::new(
        SPAN,
        comp_id,
        None,
        Some(forward_ref_call),
        false,
        &ast,
    ));
    let var_decl = VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        comp_decls,
        false,
        &ast,
    );
    let export_decl = Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        &ast,
    ));

    // Combine program statements
    let mut prog_stmts = ArenaVec::new_in(&ast);
    prog_stmts.push(react_import);
    prog_stmts.push(runtime_import);
    for (comp_name, import_path) in emitter.required_component_imports.borrow().iter() {
        let mut specs = ArenaVec::new_in(&ast);
        let imported =
            ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(comp_name), &ast);
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(comp_name), &ast);
        specs.push(ImportDeclarationSpecifier::new_import_specifier(
            SPAN,
            imported,
            local,
            ImportOrExportKind::Value,
            &ast,
        ));
        let source = StringLiteral::new(SPAN, allocator.alloc_str(import_path), None, &ast);
        let comp_import = Statement::new_import_declaration(
            SPAN,
            Some(specs),
            source,
            None,
            None,
            ImportOrExportKind::Value,
            &ast,
        );
        prog_stmts.push(comp_import);
    }
    prog_stmts.push(host_class_stmt);
    prog_stmts.push(export_decl);

    let program = Program::new(
        SPAN,
        SourceType::jsx(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        prog_stmts,
        &ast,
    );

    Ok(program)
}
