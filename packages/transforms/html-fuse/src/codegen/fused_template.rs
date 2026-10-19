use crate::models::{FusedTemplateInfo, HtmlClusterGroup};
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_span::{SourceType, SPAN};

pub fn generate_fused_template(cluster: &HtmlClusterGroup) -> FusedTemplateInfo {
    let tag = if cluster.is_svg { "svg" } else { "html" };

    let allocator = Allocator::default();
    let ast = AstBuilder::new(&allocator);

    // 1. import { <tag> } from 'lit';
    let imported = ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(tag), &ast);
    let local = BindingIdentifier::new(SPAN, allocator.alloc_str(tag), &ast);
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

    // 2. export const <cluster.id> = <tag>`<cluster.canonical_text>`;
    let tag_ident = Expression::new_identifier(SPAN, allocator.alloc_str(tag), &ast);
    let mut quasis = ArenaVec::new_in(&ast);
    let raw_text = allocator.alloc_str(&cluster.canonical_text);
    let val = TemplateElementValue {
        raw: raw_text.into(),
        cooked: Some(raw_text.into()),
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
    let export_named_stmt = Statement::ExportDeclaration(ExportDeclaration::boxed(
        SPAN,
        Declaration::VariableDeclaration(var_decl),
        &ast,
    ));

    // 3. export default <cluster.id>;
    let default_export_expr =
        Expression::new_identifier(SPAN, allocator.alloc_str(&cluster.id), &ast);
    let export_default_stmt = Statement::new_export_default_declaration(
        SPAN,
        ExportDefaultDeclarationKind::from(default_export_expr),
        &ast,
    );

    let mut body = ArenaVec::new_in(&ast);
    body.push(import_stmt);
    body.push(export_named_stmt);
    body.push(export_default_stmt);

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

    FusedTemplateInfo {
        id: cluster.id.clone(),
        file_name: cluster.file_name.clone(),
        code: codegen_result.code,
        kind: tag.to_string(),
        raw_template: cluster.canonical_text.clone(),
        shared_by: cluster.shared_by_files.clone(),
        occurrences_count: cluster.occurrences_count as u32,
    }
}
