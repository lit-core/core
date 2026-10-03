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

    // Detect registrations
    let mut detections = Vec::new();
    let mut has_dynamic = false;

    for (stmt_idx, stmt) in program.body.iter().enumerate() {
        if let Some(reg) = RegistrationDetector::detect_statement(stmt, stmt_idx) {
            if reg.is_dynamic {
                has_dynamic = true;
            }
            detections.push(reg);
        }
    }

    // Invariant: If a tag name is dynamic, bail out cleanly and leave the file completely untouched.
    if has_dynamic || detections.is_empty() {
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

    let used_tags_set: HashSet<String> =
        options.used_tags.unwrap_or_default().into_iter().collect();

    // Check which detections to prune
    let mut removed_tags = Vec::new();
    let mut preserved_tags = Vec::new();
    let mut stmts_to_remove = HashSet::new();
    let mut class_decorators_to_remove: Vec<(usize, usize)> = Vec::new(); // (stmt_idx, decorator_idx)
    let mut candidate_components_to_prune = Vec::new();

    for reg in &detections {
        if used_tags_set.contains(&reg.tag) {
            preserved_tags.push(reg.tag.clone());
        } else {
            removed_tags.push(reg.tag.clone());
            match &reg.kind {
                RegistrationKind::CustomElementsDefine { component_name, .. }
                | RegistrationKind::StaticMethodDefine { component_name, .. }
                | RegistrationKind::TranspiledDecorate { component_name, .. } => {
                    stmts_to_remove.insert(reg.statement_index);
                    if !component_name.is_empty() {
                        candidate_components_to_prune.push(component_name.clone());
                    }
                }
                RegistrationKind::ClassDecorator { decorator_index } => {
                    class_decorators_to_remove.push((reg.statement_index, *decorator_index));
                }
            }
        }
    }

    if removed_tags.is_empty() {
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

    // Build semantic model to check references
    let _semantic_ret = SemanticBuilder::new().build(&program);

    // Determine which candidate components can be pruned (not exported, and not referenced elsewhere)
    let mut pruned_imports_count = 0;
    let mut specifiers_to_remove: HashSet<(usize, usize)> = HashSet::new(); // (stmt_idx, spec_idx)

    for comp_name in &candidate_components_to_prune {
        if SymbolResolver::is_identifier_exported(&program, comp_name) {
            // Cannot prune import if exported
            continue;
        }

        // Trace import location
        if let Some(import_loc) = SymbolResolver::find_import_location(&program, comp_name) {
            // Count total references to this symbol in the module
            // If the only references were in the registration statements that are being removed,
            // we can safely remove the import specifier!
            let mut total_references = 0;
            for (idx, stmt) in program.body.iter().enumerate() {
                if !stmts_to_remove.contains(&idx) {
                    total_references += count_ident_references_in_statement(stmt, comp_name);
                }
            }

            if total_references == 0 {
                specifiers_to_remove
                    .insert((import_loc.import_stmt_index, import_loc.specifier_index));
                pruned_imports_count += 1;
            }
        }
    }

    // AST Transformation using oxc_allocator and AstBuilder
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

    // 2. Remove specifiers from import declarations
    for (stmt_idx, spec_idx) in &specifiers_to_remove {
        if let Some(Statement::ImportDeclaration(import_decl)) = program.body.get_mut(*stmt_idx) {
            if let Some(specifiers) = &mut import_decl.specifiers {
                if *spec_idx < specifiers.len() {
                    specifiers.remove(*spec_idx);
                }
            }
        }
    }

    // 3. Filter out statements:
    // - Explicitly marked registration statements
    // - Import declarations that now have empty specifier lists (and originally had specifiers)
    let mut new_body = ArenaVec::new_in(&ast);
    for (idx, stmt) in program.body.into_iter().enumerate() {
        if stmts_to_remove.contains(&idx) {
            continue;
        }

        if let Statement::ImportDeclaration(ref import_decl) = stmt {
            if let Some(specifiers) = &import_decl.specifiers {
                if specifiers.is_empty() {
                    // All specifiers were pruned -> drop the entire import statement
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

fn count_ident_references_in_statement(stmt: &Statement, target: &str) -> usize {
    struct IdentCounter<'a> {
        target: &'a str,
        count: usize,
    }

    impl<'a> oxc_ast_visit::Visit<'_> for IdentCounter<'a> {
        fn visit_identifier_reference(&mut self, ident: &IdentifierReference) {
            if ident.name.as_str() == self.target {
                self.count += 1;
            }
        }
    }

    use oxc_ast_visit::Visit;
    let mut counter = IdentCounter { target, count: 0 };
    counter.visit_statement(stmt);
    counter.count
}
