use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use std::collections::HashSet;

use crate::detector::{RegistrationDetector, RegistrationKind};
use crate::options::{TagShakeOptions, TagShakeResult};
use crate::resolver::SymbolResolver;

pub fn transform_code(source: &str, options: TagShakeOptions) -> TagShakeResult {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return TagShakeResult {
            code: source.to_string(),
            map: None,
            removed_tags: vec![],
            preserved_tags: vec![],
            shaken_registrations_count: 0,
            pruned_imports_count: 0,
            is_empty: false,
        };
    }

    let mut program = parsed.program;

    let used_tags_set: HashSet<String> =
        options.used_tags.unwrap_or_default().into_iter().collect();

    // Semantic analysis and registration detection
    let (
        has_dynamic,
        detections_empty,
        removed_tags,
        preserved_tags,
        stmts_to_remove,
        class_decorators_to_remove,
        specifiers_to_remove,
        pruned_imports_count,
    ) = {
        let semantic_ret = SemanticBuilder::new().build(&program);
        let resolver = SymbolResolver::new(&semantic_ret.semantic, &program);

        let mut detections = Vec::new();
        let mut has_dynamic = false;

        for (stmt_idx, stmt) in program.body.iter().enumerate() {
            if let Some(reg) = RegistrationDetector::detect_statement(stmt, stmt_idx, &resolver) {
                if reg.is_dynamic {
                    has_dynamic = true;
                }
                detections.push(reg);
            }
        }

        let detections_empty = detections.is_empty();

        let mut removed_tags = Vec::new();
        let mut preserved_tags = Vec::new();
        let mut stmts_to_remove = HashSet::new();
        let mut class_decorators_to_remove: Vec<(usize, usize)> = Vec::new();
        let mut candidate_names_to_prune = Vec::new();

        if !has_dynamic && !detections_empty {
            for reg in &detections {
                if used_tags_set.contains(&reg.tag) {
                    preserved_tags.push(reg.tag.clone());
                } else {
                    removed_tags.push(reg.tag.clone());
                    match &reg.kind {
                        RegistrationKind::CustomElementsDefine { component_name, .. }
                        | RegistrationKind::StaticMethodDefine { component_name, .. } => {
                            stmts_to_remove.insert(reg.statement_index);
                            if !component_name.is_empty() {
                                candidate_names_to_prune.push(component_name.clone());
                            }
                        }
                        RegistrationKind::TranspiledDecorate {
                            component_name,
                            decorator_name,
                            ..
                        } => {
                            stmts_to_remove.insert(reg.statement_index);
                            if !component_name.is_empty() {
                                candidate_names_to_prune.push(component_name.clone());
                            }
                            if !decorator_name.is_empty() {
                                candidate_names_to_prune.push(decorator_name.clone());
                            }
                        }
                        RegistrationKind::ClassDecorator {
                            decorator_index,
                            decorator_name,
                        } => {
                            class_decorators_to_remove
                                .push((reg.statement_index, *decorator_index));
                            if !decorator_name.is_empty() {
                                candidate_names_to_prune.push(decorator_name.clone());
                            }
                        }
                    }
                }
            }
        }

        let mut specifiers_to_remove: HashSet<(usize, usize)> = HashSet::new();
        let mut pruned_count = 0;

        if !removed_tags.is_empty() {
            for name in &candidate_names_to_prune {
                if SymbolResolver::is_identifier_exported(&program, name) {
                    continue;
                }

                if let Some(import_loc) = SymbolResolver::find_import_location(&program, name) {
                    let scoping = resolver.semantic.scoping();
                    let root = scoping.root_scope_id();
                    if let Some(symbol_id) = scoping.get_binding(root, name.as_str().into()) {
                        if !resolver.is_symbol_referenced_outside_removals(
                            symbol_id,
                            &stmts_to_remove,
                            &class_decorators_to_remove,
                            &program,
                        ) && specifiers_to_remove
                            .insert((import_loc.import_stmt_index, import_loc.specifier_index))
                        {
                            pruned_count += 1;
                        }
                    }
                }
            }
        }

        (
            has_dynamic,
            detections_empty,
            removed_tags,
            preserved_tags,
            stmts_to_remove,
            class_decorators_to_remove,
            specifiers_to_remove,
            pruned_count,
        )
    };

    if has_dynamic || detections_empty || removed_tags.is_empty() {
        return TagShakeResult {
            code: source.to_string(),
            map: None,
            removed_tags: vec![],
            preserved_tags,
            shaken_registrations_count: 0,
            pruned_imports_count: 0,
            is_empty: false,
        };
    }

    // AST transformation using oxc_allocator and AstBuilder
    let ast = AstBuilder::new(&allocator);

    // 1. Remove class decorators
    for (stmt_idx, dec_idx) in class_decorators_to_remove {
        if let Some(stmt) = program.body.get_mut(stmt_idx) {
            match stmt {
                Statement::ClassDeclaration(class) => {
                    if dec_idx < class.decorators.len() {
                        class.decorators.remove(dec_idx);
                    }
                }
                Statement::ExportDeclaration(export_decl) => {
                    if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                        if dec_idx < class.decorators.len() {
                            class.decorators.remove(dec_idx);
                        }
                    }
                }
                Statement::ExportDefaultDeclaration(export_decl) => {
                    if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                        &mut export_decl.declaration
                    {
                        if dec_idx < class.decorators.len() {
                            class.decorators.remove(dec_idx);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // 2. Remove specifiers from import declarations deterministically without index shift
    if !specifiers_to_remove.is_empty() {
        for (stmt_idx, stmt) in program.body.iter_mut().enumerate() {
            if let Statement::ImportDeclaration(import_decl) = stmt {
                if let Some(specifiers) = &mut import_decl.specifiers {
                    let mut current_idx = 0;
                    specifiers.retain(|_| {
                        let keep = !specifiers_to_remove.contains(&(stmt_idx, current_idx));
                        current_idx += 1;
                        keep
                    });
                }
            }
        }
    }

    // 3. Filter out statements:
    // - Explicitly marked registration statements
    // - Import declarations whose specifiers were completely pruned
    let mut new_body = ArenaVec::new_in(&ast);
    for (idx, stmt) in program.body.into_iter().enumerate() {
        if stmts_to_remove.contains(&idx) {
            continue;
        }

        if let Statement::ImportDeclaration(ref import_decl) = stmt {
            if let Some(specifiers) = &import_decl.specifiers {
                if specifiers.is_empty() {
                    continue;
                }
            }
        }

        new_body.push(stmt);
    }
    program.body = new_body;

    let is_empty = program.body.is_empty();

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        codegen_options.source_map_path = options.filename.map(std::path::PathBuf::from);
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&program);

    TagShakeResult {
        code: codegen_result.code,
        map: codegen_result.map.map(|m| m.to_json_string()),
        shaken_registrations_count: removed_tags.len() as u32,
        removed_tags,
        preserved_tags,
        pruned_imports_count,
        is_empty,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shadowed_custom_elements_preserved() {
        let code = r#"
            import { MyElement } from './my-element.js';
            const customElements = { define: () => {} };
            customElements.define('my-element', MyElement);
        "#;
        let res = transform_code(
            code,
            TagShakeOptions {
                used_tags: Some(vec![]),
                ..Default::default()
            },
        );
        assert_eq!(res.shaken_registrations_count, 0);
        assert!(res
            .code
            .contains("customElements.define('my-element', MyElement)"));
    }

    #[test]
    fn test_aliased_custom_element_decorator() {
        let code = r#"
            import { LitElement } from 'lit';
            import { customElement as ce } from 'lit/decorators.js';
            @ce('dead-widget')
            export class DeadWidget extends LitElement {}
        "#;
        let res = transform_code(
            code,
            TagShakeOptions {
                used_tags: Some(vec![]),
                ..Default::default()
            },
        );
        assert_eq!(res.shaken_registrations_count, 1);
        assert_eq!(res.removed_tags, vec!["dead-widget"]);
        assert!(!res.code.contains("@ce('dead-widget')"));
        assert!(!res.code.contains("customElement as ce"));
    }

    #[test]
    fn test_multi_specifier_pruning_deterministic() {
        let code = r#"
            import { CompA, CompB, CompC } from './components.js';
            customElements.define('comp-a', CompA);
            customElements.define('comp-b', CompB);
            customElements.define('comp-c', CompC);
        "#;
        for _ in 0..20 {
            let res = transform_code(
                code,
                TagShakeOptions {
                    used_tags: Some(vec!["comp-c".to_string()]),
                    ..Default::default()
                },
            );
            assert_eq!(res.shaken_registrations_count, 2);
            assert_eq!(res.pruned_imports_count, 2);
            assert!(
                res.code
                    .contains("import { CompC } from './components.js';")
                    || res
                        .code
                        .contains("import { CompC } from \"./components.js\";")
            );
            assert!(!res.code.contains("CompA"));
            assert!(!res.code.contains("CompB"));
            assert!(
                res.code.contains("customElements.define('comp-c', CompC)")
                    || res
                        .code
                        .contains("customElements.define(\"comp-c\", CompC)")
            );
        }
    }
}
