use lit_analysis::symbol::{CanonicalHelperSymbol, CanonicalLitSymbol, SymbolProofContext};
use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};

use crate::clean_imports::clean_lit_import;
use crate::constructor::{can_safely_lower_constructor, inject_constructor_statements};
use crate::dead_helpers::{
    is_identifier_referenced_semantically, strip_dead_decorator_helpers_flags,
};
use crate::decorate_call::try_transform_expression_statement;
use crate::decorators::custom_element::transform_custom_element;
use crate::decorators::event_options::try_transform_event_options;
use crate::decorators::localized::transform_localized;
use crate::decorators::property::try_transform_property;
use crate::decorators::query::try_transform_query;
use crate::decorators::query_all::try_transform_query_all;
use crate::decorators::query_assigned::try_transform_query_assigned;
use crate::decorators::query_async::try_transform_query_async;
use crate::decorators::state::try_transform_state;
use crate::static_properties::{
    ReactiveProp, can_merge_static_properties, class_has_reactive_properties, create_property_key,
    inject_or_merge_static_properties,
};

#[napi(object)]
#[derive(Default, Clone, Debug)]
pub struct TransformOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct TransformResult {
    pub code: String,
    pub map: Option<String>,
}

#[inline]
fn is_canonical_helper_name(name: &str) -> bool {
    matches!(name, "__decorate" | "__decorateClass" | "_ts_decorate")
}

pub fn transform_code(source: &str, options: TransformOptions) -> TransformResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();

    if !parsed.diagnostics.is_empty() {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }

    let mut program = parsed.program;

    // 1. Scan for Lit decorator imports and decorator helpers semantically
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();
    let mut symbol_ctx = SymbolProofContext::scan(&program, &scoping, source);

    let mut helper_bindings = std::collections::HashSet::new();
    let mut metadata_bindings = std::collections::HashSet::new();
    for (&sym_id, sym) in &symbol_ctx.helper_symbols {
        let name = scoping.symbol_name(sym_id).to_string();
        match sym {
            CanonicalHelperSymbol::Decorate | CanonicalHelperSymbol::DecorateClass
                if !is_canonical_helper_name(&name) =>
            {
                helper_bindings.insert(name);
            }
            CanonicalHelperSymbol::Metadata if name != "__metadata" => {
                metadata_bindings.insert(name);
            }
            _ => {}
        }
    }

    // Also scan local variable declarations that alias helpers (e.g. `var dec = __decorate;` or `var __decorate = ...`)
    for stmt in &program.body {
        if let Statement::VariableDeclaration(var_decl) = stmt {
            for decl in &var_decl.declarations {
                if let BindingPattern::BindingIdentifier(id) = &decl.id {
                    let name = id.name.as_str();
                    if let Some(helper_kind) = SymbolProofContext::map_helper_named_import(name) {
                        match helper_kind {
                            CanonicalHelperSymbol::Decorate
                            | CanonicalHelperSymbol::DecorateClass => {
                                if !is_canonical_helper_name(name) {
                                    helper_bindings.insert(name.to_string());
                                }
                                if let Some(sym_id) = id.symbol_id.get().or_else(|| {
                                    scoping.get_binding(scoping.root_scope_id(), name.into())
                                }) {
                                    symbol_ctx.helper_symbols.insert(sym_id, helper_kind);
                                }
                            }
                            CanonicalHelperSymbol::Metadata => {
                                if name != "__metadata" {
                                    metadata_bindings.insert(name.to_string());
                                }
                                if let Some(sym_id) = id.symbol_id.get().or_else(|| {
                                    scoping.get_binding(scoping.root_scope_id(), name.into())
                                }) {
                                    symbol_ctx.helper_symbols.insert(sym_id, helper_kind);
                                }
                            }
                            _ => {}
                        }
                    }
                    if let Some(Expression::Identifier(init_id)) = &decl.init {
                        let init_name = init_id.name.as_str();
                        if helper_bindings.contains(init_name)
                            || is_canonical_helper_name(init_name)
                        {
                            if !is_canonical_helper_name(name) {
                                helper_bindings.insert(name.to_string());
                            }
                            if let Some(sym_id) = id.symbol_id.get().or_else(|| {
                                scoping.get_binding(scoping.root_scope_id(), name.into())
                            }) {
                                symbol_ctx
                                    .helper_symbols
                                    .insert(sym_id, CanonicalHelperSymbol::Decorate);
                            }
                        } else if metadata_bindings.contains(init_name) || init_name == "__metadata"
                        {
                            if name != "__metadata" {
                                metadata_bindings.insert(name.to_string());
                            }
                            if let Some(sym_id) = id.symbol_id.get().or_else(|| {
                                scoping.get_binding(scoping.root_scope_id(), name.into())
                            }) {
                                symbol_ctx
                                    .helper_symbols
                                    .insert(sym_id, CanonicalHelperSymbol::Metadata);
                            }
                        }
                    }
                }
            }
        }
    }

    let has_any_decorators = symbol_ctx.lit_symbols.values().any(|s| {
        matches!(
            s,
            CanonicalLitSymbol::PropertyDecorator
                | CanonicalLitSymbol::StateDecorator
                | CanonicalLitSymbol::CustomElementDecorator
                | CanonicalLitSymbol::QueryDecorator
                | CanonicalLitSymbol::QueryAllDecorator
                | CanonicalLitSymbol::QueryAsyncDecorator
                | CanonicalLitSymbol::QueryAssignedElementsDecorator
                | CanonicalLitSymbol::QueryAssignedNodesDecorator
                | CanonicalLitSymbol::EventOptionsDecorator
                | CanonicalLitSymbol::LocalizedDecorator
                | CanonicalLitSymbol::LitNamespace
        )
    }) || !symbol_ctx.helper_symbols.is_empty();

    if !has_any_decorators {
        return TransformResult {
            code: source.to_string(),
            map: None,
        };
    }

    let ast = AstBuilder::new(&allocator);

    // 2. Walk top-level statements and transform classes & decorate calls
    let old_statements = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut intermediate_statements = ArenaVec::new_in(&ast);

    for mut stmt in old_statements {
        match &mut stmt {
            Statement::ClassDeclaration(class) => {
                let post_stmts = transform_class(class, &symbol_ctx, &ast);
                intermediate_statements.push(stmt);
                for s in post_stmts {
                    intermediate_statements.push(s);
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    let post_stmts = transform_class(class, &symbol_ctx, &ast);
                    intermediate_statements.push(stmt);
                    for s in post_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    let post_stmts = transform_class(class, &symbol_ctx, &ast);
                    intermediate_statements.push(stmt);
                    for s in post_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                if let Some(lowered_stmts) =
                    try_transform_expression_statement(expr_stmt, &symbol_ctx, &ast)
                {
                    for s in lowered_stmts {
                        intermediate_statements.push(s);
                    }
                } else {
                    intermediate_statements.push(stmt);
                }
            }
            _ => {
                intermediate_statements.push(stmt);
            }
        }
    }

    fold_lowered_decorators_into_local_classes(&mut intermediate_statements, &ast);

    program.body = intermediate_statements;
    let (
        referenced_names,
        decorator_local_names,
        decorate_used,
        metadata_used,
        helper_bindings,
        metadata_bindings,
    ) = {
        let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&program);
        let semantic = &semantic_ret.semantic;

        let mut referenced = std::collections::HashSet::new();
        let mut dec_locals = std::collections::HashSet::new();
        for (&sym_id, sym) in &symbol_ctx.lit_symbols {
            if matches!(
                sym,
                CanonicalLitSymbol::PropertyDecorator
                    | CanonicalLitSymbol::StateDecorator
                    | CanonicalLitSymbol::CustomElementDecorator
                    | CanonicalLitSymbol::QueryDecorator
                    | CanonicalLitSymbol::QueryAllDecorator
                    | CanonicalLitSymbol::QueryAsyncDecorator
                    | CanonicalLitSymbol::QueryAssignedElementsDecorator
                    | CanonicalLitSymbol::QueryAssignedNodesDecorator
                    | CanonicalLitSymbol::EventOptionsDecorator
                    | CanonicalLitSymbol::LocalizedDecorator
            ) {
                let name = scoping.symbol_name(sym_id);
                dec_locals.insert(name.to_string());
                if is_identifier_referenced_semantically(semantic, name) {
                    referenced.insert(name.to_string());
                }
            }
        }

        // Check which helper aliases are unused
        let mut unused_helper_aliases = std::collections::HashSet::new();
        for helper_name in &helper_bindings {
            if !is_identifier_referenced_semantically(semantic, helper_name) {
                unused_helper_aliases.insert(helper_name.as_str());
            }
        }

        let is_canonical_used = |canonical_name: &str| -> bool {
            let scoping = semantic.scoping();
            let root = scoping.root_scope_id();
            if let Some(sym) = scoping.get_binding(root, canonical_name.into()) {
                let total_refs = scoping.get_resolved_references(sym).count();
                if total_refs == 0 {
                    return false;
                }
                let mut alias_refs = 0;
                for stmt in &program.body {
                    if let Statement::VariableDeclaration(var_decl) = stmt {
                        for decl in &var_decl.declarations {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id
                                && unused_helper_aliases.contains(id.name.as_str())
                                && let Some(Expression::Identifier(init_id)) = &decl.init
                                && init_id.name == canonical_name
                            {
                                alias_refs += 1;
                            }
                        }
                    }
                }
                total_refs > alias_refs
            } else {
                scoping
                    .root_unresolved_references()
                    .contains_key(canonical_name)
            }
        };

        let mut dec_used = is_canonical_used("__decorate")
            || is_canonical_used("__decorateClass")
            || is_canonical_used("_ts_decorate");
        if !dec_used {
            for helper_name in &helper_bindings {
                if !unused_helper_aliases.contains(helper_name.as_str()) {
                    dec_used = true;
                    break;
                }
            }
        }
        let mut meta_used = is_identifier_referenced_semantically(semantic, "__metadata");
        for meta_name in &metadata_bindings {
            if is_identifier_referenced_semantically(semantic, meta_name) {
                meta_used = true;
                break;
            }
        }

        (
            referenced,
            dec_locals,
            dec_used,
            meta_used,
            helper_bindings,
            metadata_bindings,
        )
    };

    let intermediate = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut new_statements = ArenaVec::new_in(&ast);
    for mut stmt in intermediate {
        if let Statement::ImportDeclaration(import_decl) = &mut stmt {
            if clean_lit_import(import_decl, &referenced_names, &decorator_local_names, &ast) {
                new_statements.push(stmt);
            }
        } else {
            new_statements.push(stmt);
        }
    }

    // 3.5. Strip dead __decorate and __metadata boilerplate if no __decorate calls remain
    strip_dead_decorator_helpers_flags(
        &mut new_statements,
        decorate_used,
        metadata_used,
        &helper_bindings,
        &metadata_bindings,
    );

    program.body = new_statements;

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false)
        && let Some(ref filename) = options.filename
    {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    let map_json = codegen_result.map.map(|m| m.to_json_string());

    TransformResult {
        code: codegen_result.code,
        map: map_json,
    }
}

pub fn transform_class<'a>(
    class: &mut Class<'a>,
    symbol_ctx: &SymbolProofContext<'_>,
    ast: &AstBuilder<'a>,
) -> Vec<Statement<'a>> {
    // 0. All-or-nothing bailout:
    // a. Verify static properties are mergeable BEFORE stripping decorators
    if class_has_reactive_properties(class, symbol_ctx) && !can_merge_static_properties(class) {
        return Vec::new();
    }
    // b. In derived classes, verify that constructor can safely accept injected statements
    if class.heritage.is_some() && !can_safely_lower_constructor(class) {
        return Vec::new();
    }

    let mut post_class_statements = Vec::new();
    let mut constructor_statements = Vec::new();
    let mut reactive_props = Vec::new();

    // 1. Transform class decorators
    if let Some(custom_elem_stmt) = transform_custom_element(class, symbol_ctx, ast) {
        post_class_statements.push(custom_elem_stmt);
    }

    if let Some(localized_stmt) = transform_localized(class, symbol_ctx, ast) {
        constructor_statements.push(localized_stmt);
    }

    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .unwrap_or_default();

    // Collect existing class member names to prevent collision on synthesized properties
    let mut existing_members: std::collections::HashSet<String> = class
        .body
        .body
        .iter()
        .filter_map(|element| match element {
            ClassElement::PropertyDefinition(prop) => prop.key.static_name().map(|s| s.to_string()),
            ClassElement::MethodDefinition(method) => {
                method.key.static_name().map(|s| s.to_string())
            }
            ClassElement::AccessorProperty(acc) => acc.key.static_name().map(|s| s.to_string()),
            _ => None,
        })
        .collect();

    // 2. Transform members
    let old_elements = std::mem::replace(&mut class.body.body, ArenaVec::new_in(ast));
    let mut new_elements = ArenaVec::new_in(ast);

    for mut element in old_elements {
        // @property
        if let Some(res) = try_transform_property(&mut element, symbol_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @state
        if let Some(res) = try_transform_state(&mut element, symbol_ctx, ast) {
            reactive_props.push(res.reactive_prop);
            if let Some(init_stmt) = res.constructor_init {
                constructor_statements.push(init_stmt);
            }
            if !res.remove_member {
                new_elements.push(element);
            }
            continue;
        }

        // @query
        if let Some(getter) =
            try_transform_query(&mut element, symbol_ctx, &mut existing_members, ast)
        {
            new_elements.push(getter);
            continue;
        }

        // @queryAll
        if let Some(getter) = try_transform_query_all(&mut element, symbol_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAsync
        if let Some(getter) = try_transform_query_async(&mut element, symbol_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @queryAssignedElements / @queryAssignedNodes
        if let Some(getter) = try_transform_query_assigned(&mut element, symbol_ctx, ast) {
            new_elements.push(getter);
            continue;
        }

        // @eventOptions
        if let Some(event_opt_stmt) =
            try_transform_event_options(&mut element, &class_name, symbol_ctx, ast)
        {
            post_class_statements.push(event_opt_stmt);
            new_elements.push(element);
            continue;
        }

        new_elements.push(element);
    }

    class.body.body = new_elements;

    // 3. Inject or merge static properties
    if !reactive_props.is_empty() {
        inject_or_merge_static_properties(class, reactive_props, ast);
    }

    // 4. Inject constructor statements
    if !constructor_statements.is_empty() {
        inject_constructor_statements(class, constructor_statements, ast);
    }

    post_class_statements
}

fn get_local_class_ref<'a, 'b>(stmt: &'b Statement<'a>) -> Option<(&'b str, &'b Class<'a>)> {
    match stmt {
        Statement::ClassDeclaration(cls) => {
            cls.id.as_ref().map(|i| (i.name.as_str(), cls.as_ref()))
        }
        Statement::VariableDeclaration(var_decl) => {
            if var_decl.declarations.len() == 1 {
                let d = &var_decl.declarations[0];
                if let BindingPattern::BindingIdentifier(id) = &d.id
                    && let Some(Expression::ClassExpression(cls)) =
                        d.init.as_ref().map(|e| e.without_parentheses())
                {
                    return Some((id.name.as_str(), cls.as_ref()));
                }
            }
            None
        }
        Statement::ExportDeclaration(exp) => match &exp.declaration {
            Declaration::ClassDeclaration(cls) => {
                cls.id.as_ref().map(|i| (i.name.as_str(), cls.as_ref()))
            }
            Declaration::VariableDeclaration(var_decl) => {
                if var_decl.declarations.len() == 1 {
                    let d = &var_decl.declarations[0];
                    if let BindingPattern::BindingIdentifier(id) = &d.id
                        && let Some(Expression::ClassExpression(cls)) =
                            d.init.as_ref().map(|e| e.without_parentheses())
                    {
                        return Some((id.name.as_str(), cls.as_ref()));
                    }
                }
                None
            }
            _ => None,
        },
        Statement::ExportDefaultDeclaration(exp) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &exp.declaration {
                cls.id.as_ref().map(|i| (i.name.as_str(), cls.as_ref()))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn get_local_class_mut<'a, 'b>(stmt: &'b mut Statement<'a>) -> Option<&'b mut Class<'a>> {
    match stmt {
        Statement::ClassDeclaration(cls) => Some(cls.as_mut()),
        Statement::VariableDeclaration(var_decl) => {
            if var_decl.declarations.len() == 1
                && let Some(Expression::ClassExpression(cls)) = &mut var_decl.declarations[0].init
            {
                return Some(cls.as_mut());
            }
            None
        }
        Statement::ExportDeclaration(exp) => match &mut exp.declaration {
            Declaration::ClassDeclaration(cls) => Some(cls.as_mut()),
            Declaration::VariableDeclaration(var_decl) => {
                if var_decl.declarations.len() == 1
                    && let Some(Expression::ClassExpression(cls)) =
                        &mut var_decl.declarations[0].init
                {
                    return Some(cls.as_mut());
                }
                None
            }
            _ => None,
        },
        Statement::ExportDefaultDeclaration(exp) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &mut exp.declaration {
                Some(cls.as_mut())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn extract_create_property_call<'a>(
    stmt: &Statement<'a>,
    ast: &AstBuilder<'a>,
) -> Option<(String, ReactiveProp<'a>)> {
    let Statement::ExpressionStatement(expr_stmt) = stmt else {
        return None;
    };
    let Expression::CallExpression(call) = &expr_stmt.expression else {
        return None;
    };
    let Expression::StaticMemberExpression(mem) = &call.callee else {
        return None;
    };
    if mem.property.name != "createProperty" {
        return None;
    }
    let Expression::Identifier(cls_id) = mem.object.without_parentheses() else {
        return None;
    };
    let Expression::StringLiteral(prop_lit) = call.arguments.first()?.as_expression()? else {
        return None;
    };
    let opt = call
        .arguments
        .get(1)
        .and_then(|a| a.as_expression())
        .map(|e| e.clone_in(ast.allocator()));

    Some((
        cls_id.name.as_str().to_string(),
        ReactiveProp {
            name: prop_lit.value.as_str().to_string(),
            options: opt,
        },
    ))
}

fn extract_define_getter_call<'a>(
    stmt: &Statement<'a>,
    ast: &AstBuilder<'a>,
) -> Option<(String, String, oxc_allocator::Box<'a, Function<'a>>)> {
    let Statement::ExpressionStatement(expr_stmt) = stmt else {
        return None;
    };
    let Expression::CallExpression(call) = &expr_stmt.expression else {
        return None;
    };
    let Expression::StaticMemberExpression(mem) = &call.callee else {
        return None;
    };
    if mem.property.name != "defineProperty" {
        return None;
    }
    let Expression::Identifier(obj_id) = mem.object.without_parentheses() else {
        return None;
    };
    if obj_id.name != "Object" {
        return None;
    }
    let Expression::StaticMemberExpression(target_mem) = call.arguments.first()?.as_expression()?
    else {
        return None;
    };
    if target_mem.property.name != "prototype" {
        return None;
    }
    let Expression::Identifier(cls_id) = target_mem.object.without_parentheses() else {
        return None;
    };
    let Expression::StringLiteral(prop_lit) = call.arguments.get(1)?.as_expression()? else {
        return None;
    };
    let Expression::ObjectExpression(desc_obj) = call.arguments.get(2)?.as_expression()? else {
        return None;
    };
    for prop in &desc_obj.properties {
        if let ObjectPropertyKind::ObjectProperty(p) = prop
            && p.key.is_specific_static_name("get")
            && let Expression::FunctionExpression(func) = &p.value
        {
            return Some((
                cls_id.name.as_str().to_string(),
                prop_lit.value.as_str().to_string(),
                func.clone_in(ast.allocator()),
            ));
        }
    }
    None
}

fn fold_lowered_decorators_into_local_classes<'a>(
    stmts: &mut ArenaVec<'a, Statement<'a>>,
    ast: &AstBuilder<'a>,
) {
    let mut local_class_indices = std::collections::HashMap::new();
    for (idx, stmt) in stmts.iter().enumerate() {
        if let Some((name, cls)) = get_local_class_ref(stmt)
            && cls.decorators.is_empty()
            && can_merge_static_properties(cls)
        {
            local_class_indices.insert(name.to_string(), idx);
        }
    }
    if local_class_indices.is_empty() {
        return;
    }

    let mut class_props: std::collections::HashMap<String, Vec<(usize, ReactiveProp<'a>)>> =
        std::collections::HashMap::new();
    let mut class_getters: std::collections::HashMap<
        String,
        Vec<(usize, String, oxc_allocator::Box<'a, Function<'a>>)>,
    > = std::collections::HashMap::new();

    for (idx, stmt) in stmts.iter().enumerate() {
        if let Some((cls_name, prop)) = extract_create_property_call(stmt, ast) {
            if local_class_indices.contains_key(&cls_name) {
                class_props.entry(cls_name).or_default().push((idx, prop));
            }
        } else if let Some((cls_name, prop_name, func)) = extract_define_getter_call(stmt, ast)
            && local_class_indices.contains_key(&cls_name)
        {
            class_getters
                .entry(cls_name)
                .or_default()
                .push((idx, prop_name, func));
        }
    }

    let mut stmts_to_remove = std::collections::HashSet::new();

    for (cls_name, &cls_stmt_idx) in &local_class_indices {
        let props_count = class_props.get(cls_name).map(|v| v.len()).unwrap_or(0);
        let getters_count = class_getters.get(cls_name).map(|v| v.len()).unwrap_or(0);
        if props_count + getters_count < 2 {
            continue;
        }

        if let Some(cls) = stmts.get_mut(cls_stmt_idx).and_then(get_local_class_mut) {
            if let Some(props_list) = class_props.remove(cls_name) {
                let mut reactive_props = Vec::with_capacity(props_list.len());
                for (stmt_idx, prop) in props_list {
                    stmts_to_remove.insert(stmt_idx);
                    reactive_props.push(prop);
                }
                inject_or_merge_static_properties(cls, reactive_props, ast);
            }

            if let Some(getters_list) = class_getters.remove(cls_name) {
                for (stmt_idx, prop_name, func) in getters_list {
                    let has_conflicting_member = cls.body.body.iter().any(|elem| match elem {
                        ClassElement::MethodDefinition(m) => {
                            !m.r#static && m.key.is_specific_static_name(&prop_name)
                        }
                        ClassElement::PropertyDefinition(p) => {
                            !p.r#static
                                && p.key.is_specific_static_name(&prop_name)
                                && p.value.is_some()
                        }
                        _ => false,
                    });
                    if !has_conflicting_member {
                        cls.body.body.retain(|elem| {
                            if let ClassElement::PropertyDefinition(p) = elem
                                && !p.r#static
                                && p.key.is_specific_static_name(&prop_name)
                                && p.value.is_none()
                            {
                                return false;
                            }
                            true
                        });
                        let key = create_property_key(&prop_name, ast);
                        let getter_elem = ClassElement::new_method_definition(
                            SPAN,
                            MethodDefinitionType::MethodDefinition,
                            ArenaVec::new_in(ast),
                            key,
                            func,
                            MethodDefinitionKind::Get,
                            false,
                            false,
                            false,
                            false,
                            None,
                            ast,
                        );
                        cls.body.body.push(getter_elem);
                        stmts_to_remove.insert(stmt_idx);
                    }
                }
            }
        }
    }

    if !stmts_to_remove.is_empty() {
        let old = std::mem::replace(stmts, ArenaVec::new_in(ast));
        for (idx, stmt) in old.into_iter().enumerate() {
            if !stmts_to_remove.contains(&idx) {
                stmts.push(stmt);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_custom_element_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {customElement} from 'lit/decorators.js';

      @customElement('my-element')
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@customElement"));
        assert!(
            res.code
                .contains("customElements.define(\"my-element\", MyElement)")
                || res
                    .code
                    .contains("customElements.define('my-element', MyElement)")
        );
        assert!(!res.code.contains("decorators.js"));
    }

    #[test]
    fn test_property_and_constructor_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @property({type: String})
        foo = 'bar';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("static properties"));
        assert!(
            res.code.contains("foo: { type: String }")
                || res.code.contains("foo:{type:String}")
                || res.code.contains("type: String")
        );
        assert!(res.code.contains("constructor"));
        assert!(res.code.contains("super()"));
        assert!(res.code.contains("this.foo = 'bar'") || res.code.contains("this.foo = \"bar\""));
    }

    #[test]
    fn test_state_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {state} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @state()
        count = 0;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@state"));
        assert!(res.code.contains("state: true") || res.code.contains("state:true"));
    }

    #[test]
    fn test_query_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {query} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @query('#myDiv')
        div: HTMLDivElement;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@query"));
        assert!(res.code.contains("get div()"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_all_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAll} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAll('.items')
        items: NodeList;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAll"));
        assert!(res.code.contains("get items()"));
        assert!(res.code.contains("querySelectorAll"));
    }

    #[test]
    fn test_query_async_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAsync} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAsync('#btn')
        btn: Promise<HTMLElement>;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAsync"));
        assert!(res.code.contains("get btn()"));
        assert!(res.code.contains("this.updateComplete.then"));
        assert!(res.code.contains("querySelector"));
    }

    #[test]
    fn test_query_assigned_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {queryAssignedElements, queryAssignedNodes} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @queryAssignedElements({slot: 'header'})
        headers: HTMLElement[];

        @queryAssignedNodes()
        nodes: Node[];
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@queryAssignedElements"));
        assert!(!res.code.contains("@queryAssignedNodes"));
        assert!(res.code.contains("get headers()"));
        assert!(res.code.contains("assignedElements"));
        assert!(res.code.contains("slot[name=header]"));
        assert!(res.code.contains("get nodes()"));
        assert!(res.code.contains("assignedNodes"));
        assert!(res.code.contains("slot:not([name])"));
    }

    #[test]
    fn test_event_options_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {eventOptions} from 'lit/decorators.js';

      class MyElement extends LitElement {
        @eventOptions({passive: true})
        handleClick(e) {
          console.log(e);
        }
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@eventOptions"));
        assert!(
            res.code
                .contains("Object.assign(MyElement.prototype.handleClick, { passive: true })")
                || res.code.contains("passive: true")
        );
    }

    #[test]
    fn test_localized_transform() {
        let input = r#"
      import {LitElement} from 'lit';
      import {localized} from '@lit/localize';

      @localized()
      class MyElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@localized"));
        assert!(
            res.code
                .contains("import { updateWhenLocaleChanges } from \"@lit/localize\"")
                || res.code.contains("updateWhenLocaleChanges")
        );
        assert!(res.code.contains("updateWhenLocaleChanges(this)"));
    }

    #[test]
    fn test_existing_static_properties_merge() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        static properties = {
          existing: {type: Number},
        };

        @property({type: String})
        name = 'hello';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(res.code.contains("existing: { type: Number }") || res.code.contains("existing"));
        assert!(res.code.contains("name: { type: String }") || res.code.contains("name"));
        assert!(
            res.code.contains("this.name = 'hello'") || res.code.contains("this.name = \"hello\"")
        );
    }

    #[test]
    fn test_existing_constructor_append() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        constructor() {
          super();
          console.log('init');
        }

        @property()
        msg = 'hi';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@property"));
        assert!(
            res.code.contains("console.log(\"init\")") || res.code.contains("console.log('init')")
        );
        assert!(res.code.contains("this.msg = \"hi\"") || res.code.contains("this.msg = 'hi'"));
    }

    #[test]
    fn test_derived_class_constructor_missing_super_bailout() {
        let input = r#"
      import {LitElement} from 'lit';
      import {property} from 'lit/decorators.js';

      class MyElement extends LitElement {
        constructor() {
          // No top-level super() call!
          console.log('no super');
        }

        @property()
        msg = 'hi';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        // Must bail out completely: class and decorators remain untouched!
        assert!(!res.code.contains("this.msg"));
        assert!(!res.code.contains("static properties"));
        assert!(res.code.contains("@property"));
        assert!(res.code.contains("msg = \"hi\"") || res.code.contains("msg = 'hi'"));
    }

    #[test]
    fn test_compiled_decorate_property() {
        let input = r#"
      import {property} from 'lit/decorators.js';
      class MyElement {}
      __decorate([
        property({type: String})
      ], MyElement.prototype, "label", void 0);
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("__decorate"));
        assert!(
            res.code
                .contains("MyElement.createProperty(\"label\", { type: String })")
        );
        assert!(!res.code.contains("lit/decorators.js"));
    }

    #[test]
    fn test_compiled_decorate_custom_element() {
        let input = r#"
      import {customElement} from 'lit/decorators.js';
      let MyElement = class MyElement {};
      MyElement = __decorate([
        customElement('my-element')
      ], MyElement);
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("__decorate"));
        assert!(
            res.code
                .contains("customElements.define(\"my-element\", MyElement)")
        );
        assert!(!res.code.contains("lit/decorators.js"));
    }

    #[test]
    fn test_aliased_decorate_helper_lowering() {
        let input = r#"
      import {property} from 'lit/decorators.js';
      import {__decorate as dec} from 'tslib';
      class MyElement {}
      dec([
        property({type: String})
      ], MyElement.prototype, "title", void 0);
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("dec(["));
        assert!(
            res.code
                .contains("MyElement.createProperty(\"title\", { type: String })")
        );
        assert!(!res.code.contains("tslib"));
        assert!(!res.code.contains("lit/decorators.js"));
    }

    #[test]
    fn test_constructor_without_superclass_no_super() {
        let input = r#"
      import {property} from 'lit/decorators.js';
      class Standalone {
        @property({type: String}) name = 'test';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("super()"));
        assert!(
            res.code.contains("this.name = 'test'") || res.code.contains("this.name = \"test\"")
        );
    }

    #[test]
    fn test_unmergeable_static_properties_bailout() {
        let input = r#"
      import {property} from 'lit/decorators.js';
      class DynamicElement extends LitElement {
        static properties = getProps();
        @property({type: String}) label = 'val';
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        // Clean bailout: class is untouched, decorators preserved
        assert!(res.code.contains("@property"));
        assert!(res.code.contains("static properties = getProps()"));
    }

    #[test]
    fn test_cached_query_collision_avoidance() {
        let input = r#"
      import {query} from 'lit/decorators.js';
      class QueryElement extends LitElement {
        __header = "already exists";
        @query('#hdr', true) header;
      }
    "#;

        let res = transform_code(input, TransformOptions::default());
        // Since __header exists on the class, the cached query property must use ___header
        assert!(res.code.contains("this.___header ??="));
        assert!(
            res.code.contains("__header = \"already exists\"")
                || res.code.contains("__header = 'already exists'")
        );
    }

    #[test]
    fn test_localized_namespace_import() {
        let input = r#"
      import * as loc from '@lit/localize';
      @loc.localized()
      class LocalizedElement extends LitElement {}
    "#;

        let res = transform_code(input, TransformOptions::default());
        assert!(!res.code.contains("@loc.localized"));
        assert!(res.code.contains("loc.updateWhenLocaleChanges(this)"));
        assert!(
            res.code.contains("import * as loc from \"@lit/localize\"")
                || res.code.contains("import * as loc from '@lit/localize'")
        );
    }
}
