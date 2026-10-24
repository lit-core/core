use crate::models::{ClusterGroup, FusedSheetInfo};
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_span::{SPAN, SourceType};
use std::collections::BTreeMap;

pub fn generate_fused_sheet(cluster: &ClusterGroup) -> FusedSheetInfo {
    let mut grouped: BTreeMap<(Option<String>, String), Vec<String>> = BTreeMap::new();
    for rule in &cluster.rules {
        let key = (rule.at_rule.clone(), rule.selector.clone());
        let decls = grouped.entry(key).or_default();
        for d in &rule.declarations {
            if !decls.contains(d) {
                decls.push(d.clone());
            }
        }
    }

    let mut css_rules = String::new();
    for ((at_rule, selector), decls) in grouped {
        let body = decls.join(";");
        if let Some(at) = at_rule {
            css_rules.push_str(&format!("{}{{{}{{{}}}}}", at, selector, body));
        } else {
            css_rules.push_str(&format!("{}{{{}}}", selector, body));
        }
    }

    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);

    // 1. import { css } from 'lit';
    let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str("css"), &ast);
    let local = BindingIdentifier::new(SPAN, allocator.alloc_str("css"), &ast);
    let specifier = ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
        ImportSpecifier::new(SPAN, imported, local, ImportOrExportKind::Value, &ast),
        &ast,
    ));
    let mut specifiers = ArenaVec::new_in(&ast);
    specifiers.push(specifier);
    let source_lit = StringLiteral::new(SPAN, allocator.alloc_str("lit"), None, &ast);
    let import_stmt = Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        source_lit,
        None,
        None,
        ImportOrExportKind::Value,
        &ast,
    );

    // 2. export const <cluster_id> = css`<css_rules>`;
    let tag_ident = Expression::new_identifier(SPAN, allocator.alloc_str("css"), &ast);
    let mut quasis = ArenaVec::new_in(&ast);
    let raw_css = allocator.alloc_str(&css_rules);
    let val = TemplateElementValue {
        raw: raw_css.into(),
        cooked: Some(raw_css.into()),
    };
    quasis.push(TemplateElement::new(SPAN, val, true, &ast));
    let tmpl_lit = TemplateLiteral::new(SPAN, quasis, ArenaVec::new_in(&ast), &ast);
    let init_expr =
        Expression::new_tagged_template_expression(SPAN, tag_ident, None, tmpl_lit, &ast);

    let id_pat =
        BindingPattern::new_binding_identifier(SPAN, allocator.alloc_str(&cluster.id), &ast);
    let mut decls = ArenaVec::new_in(&ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        id_pat,
        None,
        Some(init_expr),
        false,
        &ast,
    ));
    let var_decl =
        VariableDeclaration::boxed(SPAN, VariableDeclarationKind::Const, decls, false, &ast);
    let export_stmt = Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        &ast,
    ));

    let mut body = ArenaVec::new_in(&ast);
    body.push(import_stmt);
    body.push(export_stmt);

    let program = Program::new(
        SPAN,
        SourceType::mjs(),
        "",
        ArenaVec::new_in(&ast),
        None,
        ArenaVec::new_in(&ast),
        body,
        &ast,
    );

    let codegen_options = CodegenOptions {
        single_quote: true,
        ..CodegenOptions::default()
    };
    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    FusedSheetInfo {
        id: cluster.id.clone(),
        file_name: cluster.fused_sheet_name.clone(),
        code: codegen_result.code,
        rules_count: cluster.rules.len() as u32,
        shared_by: cluster.shared_by_files.clone(),
    }
}
