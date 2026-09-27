pub mod ast_helpers;
pub mod classifier;
pub mod directive_lower;
pub mod import_scanner;
pub mod micro;
pub mod models;
pub mod template_parser;
pub mod vanilla;

use crate::import_scanner::{is_lit_directive_source, is_lit_import_source, ImportContext};
use crate::models::{
    ClassificationResult, ClassifyOptions, TransformOptions, TransformResult,
};
use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::SourceType;

#[napi]
pub fn classify(source: String, options: Option<ClassifyOptions>) -> Vec<ClassificationResult> {
    classifier::classify_code(&source, options.unwrap_or_default())
}

#[napi]
pub fn transform_native(source: String, options: Option<TransformOptions>) -> TransformResult {
    let opts = options.unwrap_or_default();
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(opts.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, &source, source_type).parse();
    if parsed.program.body.is_empty() {
        return TransformResult {
            code: source,
            map: None,
            vanilla_count: 0,
            micro_count: 0,
            classifications: Vec::new(),
        };
    }

    let mut program = parsed.program;
    let import_ctx = ImportContext::scan(&program);
    let ast = AstBuilder::new(&allocator);
    let forced_mode = opts.mode.as_deref().unwrap_or("auto");

    let mut classifications = Vec::new();
    let mut vanilla_count = 0u32;
    let mut micro_count = 0u32;

    let old_statements = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut new_statements = ArenaVec::new_in(&ast);

    for mut stmt in old_statements {
        match &mut stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(target) =
                    classifier::classify_class(class, forced_mode, &source, &import_ctx, None)
                {
                    classifications.push(target.clone());
                    match target.mode.as_str() {
                        "vanilla" => {
                            let mut pre_stmts = Vec::new();
                            let mut post_stmts = Vec::new();
                            vanilla::transform_vanilla_class(
                                class,
                                &source,
                                &target,
                                &ast,
                                &allocator,
                                &mut pre_stmts,
                                &mut post_stmts,
                            );
                            for s in pre_stmts {
                                new_statements.push(s);
                            }
                            new_statements.push(stmt);
                            for s in post_stmts {
                                new_statements.push(s);
                            }
                            vanilla_count += 1;
                            continue;
                        }
                        "micro" => {
                            micro::transform_micro_class(class, &source, &target, &ast, &import_ctx);
                            new_statements.push(stmt);
                            micro_count += 1;
                            continue;
                        }
                        _ => {}
                    }
                }
                new_statements.push(stmt);
            }
            Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(target) =
                        classifier::classify_class(class, forced_mode, &source, &import_ctx, None)
                    {
                        classifications.push(target.clone());
                        match target.mode.as_str() {
                            "vanilla" => {
                                let mut pre_stmts = Vec::new();
                                let mut post_stmts = Vec::new();
                                vanilla::transform_vanilla_class(
                                    class,
                                    &source,
                                    &target,
                                    &ast,
                                    &allocator,
                                    &mut pre_stmts,
                                    &mut post_stmts,
                                );
                                for s in pre_stmts {
                                    new_statements.push(s);
                                }
                                new_statements.push(stmt);
                                for s in post_stmts {
                                    new_statements.push(s);
                                }
                                vanilla_count += 1;
                                continue;
                            }
                            "micro" => {
                                micro::transform_micro_class(
                                    class,
                                    &source,
                                    &target,
                                    &ast,
                                    &import_ctx,
                                );
                                new_statements.push(stmt);
                                micro_count += 1;
                                continue;
                            }
                            _ => {}
                        }
                    }
                    new_statements.push(stmt);
                }
                _ => {
                    new_statements.push(stmt);
                }
            },
            Statement::ExportDefaultDeclaration(export_decl) => match &mut export_decl.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    if let Some(target) =
                        classifier::classify_class(class, forced_mode, &source, &import_ctx, None)
                    {
                        classifications.push(target.clone());
                        match target.mode.as_str() {
                            "vanilla" => {
                                let mut pre_stmts = Vec::new();
                                let mut post_stmts = Vec::new();
                                vanilla::transform_vanilla_class(
                                    class,
                                    &source,
                                    &target,
                                    &ast,
                                    &allocator,
                                    &mut pre_stmts,
                                    &mut post_stmts,
                                );
                                for s in pre_stmts {
                                    new_statements.push(s);
                                }
                                new_statements.push(stmt);
                                for s in post_stmts {
                                    new_statements.push(s);
                                }
                                vanilla_count += 1;
                                continue;
                            }
                            "micro" => {
                                micro::transform_micro_class(
                                    class,
                                    &source,
                                    &target,
                                    &ast,
                                    &import_ctx,
                                );
                                new_statements.push(stmt);
                                micro_count += 1;
                                continue;
                            }
                            _ => {}
                        }
                    }
                    new_statements.push(stmt);
                }
                _ => {
                    new_statements.push(stmt);
                }
            },
            _ => {
                new_statements.push(stmt);
            }
        }
    }

    program.body = new_statements;

    // Dead import elimination:
    // If all components were converted to vanilla, strip unused Lit base imports
    if vanilla_count > 0 && micro_count == 0 {
        strip_lit_imports_from_program(&mut program, &ast);
    } else if micro_count > 0 {
        // Strip unused directive imports that were lowered
        strip_lowered_directive_imports(&mut program, &ast);
    }

    let mut codegen_options = CodegenOptions::default();
    if opts.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = opts.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);
    let map = codegen_result.map.map(|m| m.to_json_string());

    TransformResult {
        code: codegen_result.code,
        map,
        vanilla_count,
        micro_count,
        classifications,
    }
}

fn strip_lit_imports_from_program<'a>(program: &mut Program<'a>, ast: &AstBuilder<'a>) {
    let mut retained = ArenaVec::new_in(ast);
    for mut stmt in program.body.drain(..) {
        if let Statement::ImportDeclaration(ref mut import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if is_lit_import_source(src) || is_lit_directive_source(src) {
                if let Some(ref mut specifiers) = import_decl.specifiers {
                    specifiers.retain(|spec| {
                        let name = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(n) => n.imported.name().as_str(),
                            _ => "",
                        };
                        name != "LitElement"
                            && name != "ReactiveElement"
                            && name != "html"
                            && name != "css"
                            && name != "customElement"
                            && name != "property"
                            && name != "state"
                    });
                    if specifiers.is_empty() {
                        continue;
                    }
                }
            }
        }
        retained.push(stmt);
    }
    program.body = retained;
}

fn strip_lowered_directive_imports<'a>(program: &mut Program<'a>, ast: &AstBuilder<'a>) {
    let mut retained = ArenaVec::new_in(ast);
    for mut stmt in program.body.drain(..) {
        if let Statement::ImportDeclaration(ref mut import_decl) = stmt {
            let src = import_decl.source.value.as_str();
            if is_lit_directive_source(src) {
                if src.contains("class-map") || src.contains("if-defined") || src.contains("guard") {
                    continue;
                }
            }
        }
        retained.push(stmt);
    }
    program.body = retained;
}
