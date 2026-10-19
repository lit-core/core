pub mod ast_helpers;
pub mod classifier;
pub mod directive_lower;
pub mod import_scanner;
pub mod micro;
pub mod models;
pub mod template_parser;
pub mod vanilla;
pub mod vanilla_ast;

use crate::import_scanner::ImportContext;
use crate::models::{ClassificationResult, ClassifyOptions, TransformOptions, TransformResult};
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
    let semantic_ret = oxc_semantic::SemanticBuilder::new().build(&program);
    let scoping = semantic_ret.semantic.into_scoping();
    let import_ctx = ImportContext::scan(&program, &scoping);
    let ast = AstBuilder::new(&allocator);
    let forced_mode = opts.mode.as_deref().unwrap_or("auto");
    let define_calls = classifier::scan_define_calls(&program);
    let trailing_decorators = classifier::scan_trailing_decorators(&program);

    let mut classifications = Vec::new();
    let mut vanilla_count = 0u32;
    let mut micro_count = 0u32;

    let old_statements = std::mem::replace(&mut program.body, ArenaVec::new_in(&ast));
    let mut new_statements = ArenaVec::new_in(&ast);

    for mut stmt in old_statements {
        match &mut stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(target) = classifier::classify_class(
                    class,
                    forced_mode,
                    &define_calls,
                    &trailing_decorators,
                    &import_ctx,
                    &scoping,
                    None,
                ) {
                    classifications.push(target.clone());
                    match target.mode.as_str() {
                        "vanilla" => {
                            let mut pre_stmts = Vec::new();
                            let mut post_stmts = Vec::new();
                            if vanilla::transform_vanilla_class(
                                class,
                                &target,
                                &ast,
                                &scoping,
                                &import_ctx,
                                &mut pre_stmts,
                                &mut post_stmts,
                            ) {
                                for s in pre_stmts {
                                    new_statements.push(s);
                                }
                                new_statements.push(stmt);
                                for s in post_stmts {
                                    new_statements.push(s);
                                }
                                vanilla_count += 1;
                            } else {
                                new_statements.push(stmt);
                            }
                            continue;
                        }
                        "micro" => {
                            let lowered = micro::transform_micro_class(
                                class,
                                &source,
                                &target,
                                &ast,
                                &import_ctx,
                            );
                            new_statements.push(stmt);
                            if lowered {
                                micro_count += 1;
                            }
                            continue;
                        }
                        _ => {}
                    }
                }
                new_statements.push(stmt);
            }
            Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(target) = classifier::classify_class(
                        class,
                        forced_mode,
                        &define_calls,
                        &trailing_decorators,
                        &import_ctx,
                        &scoping,
                        None,
                    ) {
                        classifications.push(target.clone());
                        match target.mode.as_str() {
                            "vanilla" => {
                                let mut pre_stmts = Vec::new();
                                let mut post_stmts = Vec::new();
                                if vanilla::transform_vanilla_class(
                                    class,
                                    &target,
                                    &ast,
                                    &scoping,
                                    &import_ctx,
                                    &mut pre_stmts,
                                    &mut post_stmts,
                                ) {
                                    for s in pre_stmts {
                                        new_statements.push(s);
                                    }
                                    new_statements.push(stmt);
                                    for s in post_stmts {
                                        new_statements.push(s);
                                    }
                                    vanilla_count += 1;
                                } else {
                                    new_statements.push(stmt);
                                }
                                continue;
                            }
                            "micro" => {
                                let lowered = micro::transform_micro_class(
                                    class,
                                    &source,
                                    &target,
                                    &ast,
                                    &import_ctx,
                                );
                                new_statements.push(stmt);
                                if lowered {
                                    micro_count += 1;
                                }
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
            Statement::ExportDefaultDeclaration(export_decl) => {
                match &mut export_decl.declaration {
                    ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                        if let Some(target) = classifier::classify_class(
                            class,
                            forced_mode,
                            &define_calls,
                            &trailing_decorators,
                            &import_ctx,
                            &scoping,
                            None,
                        ) {
                            classifications.push(target.clone());
                            match target.mode.as_str() {
                                "vanilla" => {
                                    let mut pre_stmts = Vec::new();
                                    let mut post_stmts = Vec::new();
                                    if vanilla::transform_vanilla_class(
                                        class,
                                        &target,
                                        &ast,
                                        &scoping,
                                        &import_ctx,
                                        &mut pre_stmts,
                                        &mut post_stmts,
                                    ) {
                                        for s in pre_stmts {
                                            new_statements.push(s);
                                        }
                                        new_statements.push(stmt);
                                        for s in post_stmts {
                                            new_statements.push(s);
                                        }
                                        vanilla_count += 1;
                                    } else {
                                        new_statements.push(stmt);
                                    }
                                    continue;
                                }
                                "micro" => {
                                    let lowered = micro::transform_micro_class(
                                        class,
                                        &source,
                                        &target,
                                        &ast,
                                        &import_ctx,
                                    );
                                    new_statements.push(stmt);
                                    if lowered {
                                        micro_count += 1;
                                    }
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
                }
            }
            _ => {
                new_statements.push(stmt);
            }
        }
    }

    if vanilla_count == 0 && micro_count == 0 {
        return TransformResult {
            code: source,
            map: None,
            vanilla_count: 0,
            micro_count: 0,
            classifications,
        };
    }

    program.body = new_statements;

    // Dead import elimination:
    import_scanner::clean_dead_imports(&mut program, &ast);

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
