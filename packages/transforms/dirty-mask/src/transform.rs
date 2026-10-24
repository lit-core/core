use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};
use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SPAN, SourceType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use crate::analyzer::{
    ReactiveProps, analyze_expr_dependencies, collect_classes_mut, collect_named_classes,
    collect_reactive_properties, collect_reactive_properties_with_inheritance,
    collect_reactive_properties_with_inheritance_named, compute_part_mask, get_class_name,
    get_root_this_prop, get_super_class_name,
};
pub use crate::builder::{
    build_alias_statement, build_mask_calc_statements, build_super_update_statement,
    build_update_method,
};
pub use crate::masker::{
    mask_expressions_in_body, mask_expressions_in_expr, mask_expressions_in_stmt,
};

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyMaskOptions {
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyMaskResult {
    pub code: String,
    pub map: Option<String>,
    pub components_count: u32,
    pub masked_parts_count: u32,
    pub properties_count: u32,
}

fn statement_contains_dirty_mask(stmt: &Statement) -> bool {
    struct Detector {
        found: bool,
    }
    impl<'a> Visit<'a> for Detector {
        fn visit_static_member_expression(&mut self, mem: &StaticMemberExpression<'a>) {
            if mem.property.name == "__litDirtyMask"
                && matches!(&mem.object, Expression::ThisExpression(_))
            {
                self.found = true;
                return;
            }
            if !self.found {
                oxc_ast_visit::walk::walk_static_member_expression(self, mem);
            }
        }
    }
    let mut detector = Detector { found: false };
    detector.visit_statement(stmt);
    detector.found
}

fn compute_props_with_cache(
    class: &Class,
    inherited_cache: &HashMap<String, Vec<(String, usize)>>,
    external_props: Option<&HashMap<String, Vec<String>>>,
    ctx: Option<&SymbolProofContext>,
    class_name: Option<&str>,
) -> ReactiveProps {
    let mut prop_indices: HashMap<String, usize> = HashMap::new();
    let mut sorted_props: Vec<(String, usize)> = Vec::new();

    let mut add_prop = |name: String| {
        if !prop_indices.contains_key(&name) {
            let idx = sorted_props.len();
            prop_indices.insert(name.clone(), idx);
            sorted_props.push((name, idx));
        }
    };

    if let Some(super_name) = get_super_class_name(class)
        && let Some(anc_props) = inherited_cache.get(super_name)
    {
        for (prop_name, _) in anc_props {
            add_prop(prop_name.clone());
        }
    }

    let (_, own_sorted) = collect_reactive_properties(class, ctx);
    for (prop_name, _) in own_sorted {
        add_prop(prop_name);
    }

    if let Some(ext) = external_props {
        let effective_name = class_name.or_else(|| get_class_name(class));
        if let Some(name) = effective_name
            && let Some(extra) = ext.get(name)
        {
            for prop_name in extra {
                add_prop(prop_name.clone());
            }
        }
    }

    (prop_indices, sorted_props)
}

pub fn transform_code(source: &str, options: DirtyMaskOptions) -> DirtyMaskResult {
    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let scoping = oxc_semantic::SemanticBuilder::new()
        .build(&parsed.program)
        .semantic
        .into_scoping();
    let symbol_ctx = SymbolProofContext::scan(&parsed.program, &scoping, source);
    let root_scope = scoping.root_scope_id();

    let existing_no_change = symbol_ctx.lit_symbols.iter().find_map(|(&sym_id, sym)| {
        if *sym == CanonicalLitSymbol::NoChange {
            Some(scoping.symbol_name(sym_id).to_string())
        } else {
            None
        }
    });

    let (no_change_ident, needs_no_change_import) = match existing_no_change {
        Some(name) => (name, false),
        None => {
            if scoping.get_binding(root_scope, "noChange".into()).is_some() {
                let mut alias = "_litNoChange".to_string();
                let mut counter: usize = 1;
                while scoping
                    .get_binding(root_scope, alias.as_str().into())
                    .is_some()
                {
                    alias.clear();
                    alias.push_str("_litNoChange_");
                    let mut num = counter;
                    let mut digits = Vec::new();
                    while num > 0 {
                        digits.push((b'0' + (num % 10) as u8) as char);
                        num /= 10;
                    }
                    for d in digits.into_iter().rev() {
                        alias.push(d);
                    }
                    counter += 1;
                }
                (alias, true)
            } else {
                ("noChange".to_string(), true)
            }
        }
    };

    let mut external_props: HashMap<String, Vec<String>> = HashMap::new();
    for stmt in &parsed.program.body {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            match &expr_stmt.expression {
                Expression::CallExpression(call) => {
                    if let Expression::StaticMemberExpression(mem) = &call.callee
                        && mem.property.name == "createProperty"
                        && let Expression::Identifier(obj_id) = &mem.object
                        && let Some(first_arg) = call.arguments.first()
                        && let Some(Expression::StringLiteral(s)) = first_arg.as_expression()
                    {
                        external_props
                            .entry(obj_id.name.as_str().to_string())
                            .or_default()
                            .push(s.value.as_str().to_string());
                    }
                    let is_decorate_helper = match &call.callee {
                        Expression::Identifier(id) => {
                            symbol_ctx.resolve_helper_symbol(id).is_some()
                        }
                        _ => false,
                    };
                    if is_decorate_helper
                        && call.arguments.len() >= 3
                        && let Some(Expression::StaticMemberExpression(mem)) =
                            call.arguments[1].as_expression()
                        && mem.property.name == "prototype"
                        && let Expression::Identifier(id) = &mem.object
                    {
                        let class_name = id.name.as_str().to_string();
                        let has_reactive = match call.arguments[0].as_expression() {
                            Some(Expression::ArrayExpression(arr)) => {
                                arr.elements.iter().any(|elem| {
                                    elem.as_expression().is_some_and(|e| {
                                        symbol_ctx.is_proven_decorator(e).is_some_and(|sym| {
                                            matches!(
                                                sym,
                                                CanonicalLitSymbol::PropertyDecorator
                                                    | CanonicalLitSymbol::StateDecorator
                                            )
                                        })
                                    })
                                })
                            }
                            _ => false,
                        };
                        if has_reactive
                            && let Some(Expression::StringLiteral(s)) =
                                call.arguments[2].as_expression()
                        {
                            external_props
                                .entry(class_name)
                                .or_default()
                                .push(s.value.as_str().to_string());
                        }
                    }
                }
                Expression::AssignmentExpression(assign) => {
                    if let Some(SimpleAssignmentTarget::StaticMemberExpression(mem)) =
                        assign.left.as_simple_assignment_target()
                        && mem.property.name == "properties"
                        && let Expression::Identifier(obj_id) = &mem.object
                        && let Expression::ObjectExpression(obj) = &assign.right
                    {
                        for prop in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(p) = prop
                                && let Some(name) = p.key.static_name()
                            {
                                external_props
                                    .entry(obj_id.name.as_str().to_string())
                                    .or_default()
                                    .push(name.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut class_props_map: HashMap<String, ReactiveProps> = HashMap::new();
    let mut inherited_props_cache: HashMap<String, Vec<(String, usize)>> = HashMap::new();
    {
        let named_classes = collect_named_classes(&parsed.program.body);
        let classes_by_name: HashMap<&str, &Class> =
            named_classes.iter().map(|(n, c)| (*n, *c)).collect();
        for (name, class) in &named_classes {
            let props = collect_reactive_properties_with_inheritance_named(
                class,
                &classes_by_name,
                Some(&external_props),
                Some(&symbol_ctx),
                Some(name),
            );
            inherited_props_cache.insert((*name).to_string(), props.1.clone());
            class_props_map.insert((*name).to_string(), props);
        }
    }

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    let mut total_components_count: u32 = 0;
    let mut total_masked_parts_count: u32 = 0;
    let mut total_properties_count: u32 = 0;

    for (class_name_from_decl, class) in classes {
        let qualifies = symbol_ctx.prove_heritage(class).is_reactive();
        if !qualifies {
            continue;
        }
        let has_reactive_super = class.heritage.is_some();

        let resolved_class_name = get_class_name(class).or(class_name_from_decl);

        let (reactive_props, sorted_props) = if let Some(name) = resolved_class_name {
            if let Some(props) = class_props_map.remove(name) {
                props
            } else {
                compute_props_with_cache(
                    class,
                    &inherited_props_cache,
                    Some(&external_props),
                    Some(&symbol_ctx),
                    resolved_class_name,
                )
            }
        } else {
            compute_props_with_cache(
                class,
                &inherited_props_cache,
                Some(&external_props),
                Some(&symbol_ctx),
                None,
            )
        };

        if reactive_props.is_empty() || reactive_props.len() >= 32 {
            continue;
        }

        let mut class_masked_count = 0u32;
        let mut existing_update_idx = None;

        for (idx, elem) in class.body.body.iter_mut().enumerate() {
            if let ClassElement::MethodDefinition(method) = elem {
                let name = method.key.static_name();
                if !method.r#static {
                    if name.as_deref() == Some("render") {
                        if let Some(ref mut body) = method.value.body {
                            mask_expressions_in_body(
                                body,
                                &reactive_props,
                                &allocator,
                                &mut class_masked_count,
                                Some(&symbol_ctx),
                                &no_change_ident,
                            );
                        }
                    } else if name.as_deref() == Some("update") {
                        existing_update_idx = Some(idx);
                    }
                }
            }
        }

        if class_masked_count == 0 {
            continue;
        }

        total_components_count += 1;
        total_masked_parts_count += class_masked_count;
        total_properties_count += reactive_props.len() as u32;

        let ast = AstBuilder::new(&allocator);

        if let Some(idx) = existing_update_idx {
            if let ClassElement::MethodDefinition(method) = &mut class.body.body[idx] {
                let existing_param =
                    method
                        .value
                        .params
                        .items
                        .first()
                        .and_then(|p| match &p.pattern {
                            BindingPattern::BindingIdentifier(id) => {
                                Some(id.name.as_str().to_string())
                            }
                            _ => None,
                        });
                if let Some(ref mut body) = method.value.body {
                    let already_has = body.statements.iter().any(statement_contains_dirty_mask);
                    if !already_has {
                        let mut insert_stmts = Vec::new();
                        if let Some(alias_stmt) =
                            build_alias_statement(existing_param.as_deref().or(Some("")), &ast)
                        {
                            insert_stmts.push(alias_stmt);
                        }
                        for stmt in
                            build_mask_calc_statements(&sorted_props, resolved_class_name, &ast)
                        {
                            insert_stmts.push(stmt);
                        }
                        for (i, stmt) in insert_stmts.into_iter().enumerate() {
                            body.statements.insert(i, stmt);
                        }
                    }
                }
            }
        } else {
            let update_elem =
                build_update_method(&sorted_props, has_reactive_super, resolved_class_name, &ast);
            class.body.body.push(update_elem);
        }
    }

    if total_components_count == 0 || total_masked_parts_count == 0 {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

    if needs_no_change_import {
        let ast = AstBuilder::new(&allocator);
        let imported =
            ModuleExportName::IdentifierName(IdentifierName::new(SPAN, "noChange", &ast));
        let local = BindingIdentifier::new(SPAN, allocator.alloc_str(&no_change_ident), &ast);
        let spec = ImportSpecifier::boxed(SPAN, imported, local, ImportOrExportKind::Value, &ast);

        let mut lit_import_idx = None;
        for (idx, stmt) in parsed.program.body.iter().enumerate() {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                let specifier = import_decl.source.value.as_str();
                if specifier == "lit" || specifier == "lit-html" {
                    let has_namespace = import_decl
                        .specifiers
                        .as_ref()
                        .map(|specs| {
                            specs.iter().any(|s| {
                                matches!(s, ImportDeclarationSpecifier::ImportNamespaceSpecifier(_))
                            })
                        })
                        .unwrap_or(false);
                    if !has_namespace {
                        if specifier == "lit" {
                            lit_import_idx = Some(idx);
                            break;
                        } else if lit_import_idx.is_none() {
                            lit_import_idx = Some(idx);
                        }
                    }
                }
            }
        }

        if let Some(idx) = lit_import_idx {
            if let Statement::ImportDeclaration(import_decl) = &mut parsed.program.body[idx] {
                if let Some(ref mut current_specs) = import_decl.specifiers {
                    current_specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                } else {
                    let mut specs = ArenaVec::new_in(&ast);
                    specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
                    import_decl.specifiers = Some(specs);
                }
            }
        } else {
            let mut specs = ArenaVec::new_in(&ast);
            specs.push(ImportDeclarationSpecifier::ImportSpecifier(spec));
            let source_lit = StringLiteral::new(SPAN, "lit", None, &ast);
            let import_decl = ImportDeclaration::boxed(
                SPAN,
                Some(specs),
                source_lit,
                None,
                None,
                ImportOrExportKind::Value,
                &ast,
            );
            parsed
                .program
                .body
                .insert(0, Statement::ImportDeclaration(import_decl));
        }
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false)
        && let Some(ref filename) = options.filename
    {
        codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
    }

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    DirtyMaskResult {
        code: codegen_result.code,
        map: map_json,
        components_count: total_components_count,
        masked_parts_count: total_masked_parts_count,
        properties_count: total_properties_count,
    }
}
