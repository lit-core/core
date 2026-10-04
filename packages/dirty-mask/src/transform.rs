use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, SPAN};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub use crate::analyzer::{
    analyze_expr_dependencies, collect_classes_mut, collect_reactive_properties, compute_part_mask,
    get_root_this_prop, is_lit_html_tag, is_reactive_decorator,
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

pub fn transform_code(source: &str, options: DirtyMaskOptions) -> DirtyMaskResult {
    if !source.contains("html") && !source.contains("svg") {
        return DirtyMaskResult {
            code: source.to_string(),
            map: None,
            components_count: 0,
            masked_parts_count: 0,
            properties_count: 0,
        };
    }

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

    let mut external_props: HashMap<String, Vec<String>> = HashMap::new();
    for stmt in &parsed.program.body {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            match &expr_stmt.expression {
                Expression::CallExpression(call) => {
                    if let Expression::StaticMemberExpression(mem) = &call.callee {
                        if mem.property.name == "createProperty" {
                            if let Expression::Identifier(obj_id) = &mem.object {
                                if let Some(first_arg) = call.arguments.first() {
                                    if let Some(Expression::StringLiteral(s)) =
                                        first_arg.as_expression()
                                    {
                                        external_props
                                            .entry(obj_id.name.as_str().to_string())
                                            .or_default()
                                            .push(s.value.as_str().to_string());
                                    }
                                }
                            }
                        }
                    }
                    let callee_name = match &call.callee {
                        Expression::Identifier(id) => Some(id.name.as_str()),
                        _ => None,
                    };
                    if (callee_name == Some("__decorate")
                        || callee_name == Some("__decorateClass")
                        || callee_name == Some("_ts_decorate"))
                        && call.arguments.len() >= 3
                    {
                        if let Some(Expression::StaticMemberExpression(mem)) =
                            call.arguments[1].as_expression()
                        {
                            if mem.property.name == "prototype" {
                                if let Expression::Identifier(id) = &mem.object {
                                    let class_name = id.name.as_str().to_string();
                                    let has_reactive = match call.arguments[0].as_expression() {
                                        Some(Expression::ArrayExpression(arr)) => {
                                            arr.elements.iter().any(|elem| {
                                                elem.as_expression()
                                                    .is_some_and(is_reactive_decorator)
                                            })
                                        }
                                        _ => false,
                                    };
                                    if has_reactive {
                                        if let Some(Expression::StringLiteral(s)) =
                                            call.arguments[2].as_expression()
                                        {
                                            external_props
                                                .entry(class_name)
                                                .or_default()
                                                .push(s.value.as_str().to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Expression::AssignmentExpression(assign) => {
                    if let Some(SimpleAssignmentTarget::StaticMemberExpression(mem)) =
                        assign.left.as_simple_assignment_target()
                    {
                        if mem.property.name == "properties" {
                            if let Expression::Identifier(obj_id) = &mem.object {
                                if let Expression::ObjectExpression(obj) = &assign.right {
                                    for prop in &obj.properties {
                                        if let ObjectPropertyKind::ObjectProperty(p) = prop {
                                            if let Some(name) = p.key.static_name() {
                                                external_props
                                                    .entry(obj_id.name.as_str().to_string())
                                                    .or_default()
                                                    .push(name.to_string());
                                            }
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

    for class in classes {
        let (mut reactive_props, mut sorted_props) = collect_reactive_properties(class);
        if let Some(id) = &class.id {
            if let Some(extra) = external_props.get(id.name.as_str()) {
                for prop_name in extra {
                    if !reactive_props.contains_key(prop_name) {
                        let idx = sorted_props.len();
                        reactive_props.insert(prop_name.clone(), idx);
                        sorted_props.push((prop_name.clone(), idx));
                    }
                }
            }
        }
        if reactive_props.is_empty() {
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
            if let ClassElement::MethodDefinition(ref mut method) = &mut class.body.body[idx] {
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
                    let already_has = body.statements.iter().any(|s| {
                        let start = s.span().start as usize;
                        let end = s.span().end as usize;
                        if start < end && end <= source.len() {
                            source[start..end].contains("this.__litDirtyMask")
                        } else {
                            false
                        }
                    });
                    if !already_has {
                        let mut insert_stmts = Vec::new();
                        if let Some(alias_stmt) =
                            build_alias_statement(existing_param.as_deref().or(Some("")), &ast)
                        {
                            insert_stmts.push(alias_stmt);
                        }
                        for stmt in build_mask_calc_statements(&sorted_props, &ast) {
                            insert_stmts.push(stmt);
                        }
                        for (i, stmt) in insert_stmts.into_iter().enumerate() {
                            body.statements.insert(i, stmt);
                        }
                    }
                }
            }
        } else {
            let update_elem = build_update_method(&sorted_props, &ast);
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

    // Ensure import { noChange } from 'lit'; is imported
    let mut has_no_change = false;
    let mut lit_import_idx = None;

    for (idx, stmt) in parsed.program.body.iter().enumerate() {
        if let Statement::ImportDeclaration(import_decl) = stmt {
            let specifier = import_decl.source.value.as_str();
            if specifier == "lit" || specifier == "lit-html" {
                lit_import_idx = Some(idx);
                if let Some(specifiers) = &import_decl.specifiers {
                    for spec in specifiers {
                        if let ImportDeclarationSpecifier::ImportSpecifier(named) = spec {
                            if named.imported.name() == "noChange" {
                                has_no_change = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if !has_no_change {
        let ast = AstBuilder::new(&allocator);
        let imported =
            ModuleExportName::IdentifierName(IdentifierName::new(SPAN, "noChange", &ast));
        let local = BindingIdentifier::new(SPAN, "noChange", &ast);
        let spec = ImportSpecifier::boxed(SPAN, imported, local, ImportOrExportKind::Value, &ast);

        if let Some(idx) = lit_import_idx {
            if let Statement::ImportDeclaration(ref mut import_decl) = &mut parsed.program.body[idx]
            {
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
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
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
