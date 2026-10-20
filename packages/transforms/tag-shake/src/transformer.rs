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

    let mut used_tags_set: HashSet<String> =
        options.used_tags.unwrap_or_default().into_iter().collect();

    // Semantic analysis and registration detection
    let (
        has_dynamic,
        detections_empty,
        removed_tags,
        preserved_tags,
        stmts_to_remove,
        class_decorators_to_remove,
        shaken_local_classes,
        originally_referenced_imports,
    ) = {
        let semantic_ret = SemanticBuilder::new().build(&program);
        let resolver = SymbolResolver::new(&semantic_ret.semantic, &program, source);

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
        let mut preserved_component_names = HashSet::new();
        let mut candidate_shaken_classes = Vec::new();

        if !has_dynamic && !detections_empty {
            let mut visited_class_stmts = HashSet::new();
            loop {
                let mut added_any = false;
                for reg in &detections {
                    if used_tags_set.contains(&reg.tag) {
                        let cls_name_opt = match &reg.kind {
                            RegistrationKind::CustomElementsDefine { component_name, .. }
                            | RegistrationKind::StaticMethodDefine { component_name, .. }
                            | RegistrationKind::TranspiledDecorate { component_name, .. } => {
                                if !component_name.is_empty() {
                                    Some(component_name.clone())
                                } else {
                                    None
                                }
                            }
                            RegistrationKind::ClassDecorator { .. } => None,
                        };
                        let mut stmt_indices = Vec::new();
                        if matches!(reg.kind, RegistrationKind::ClassDecorator { .. }) {
                            stmt_indices.push(reg.statement_index);
                        }
                        if let Some(mut cur_cls) = cls_name_opt {
                            let mut depth = 0;
                            while let Some(idx) = find_local_class_stmt_index(&program, &cur_cls) {
                                stmt_indices.push(idx);
                                depth += 1;
                                if depth > 16 {
                                    break;
                                }
                                if let Some(super_name) =
                                    get_local_super_class_name(&program.body[idx])
                                {
                                    cur_cls = super_name;
                                } else {
                                    break;
                                }
                            }
                        }
                        for idx in stmt_indices {
                            if visited_class_stmts.insert(idx) {
                                let mut visitor = crate::scanner::CustomElementAstVisitor::new();
                                oxc_ast_visit::Visit::visit_statement(
                                    &mut visitor,
                                    &program.body[idx],
                                );
                                for t in visitor.tags {
                                    if used_tags_set.insert(t) {
                                        added_any = true;
                                    }
                                }
                            }
                        }
                    }
                }
                if !added_any {
                    break;
                }
            }

            for reg in &detections {
                if used_tags_set.contains(&reg.tag) {
                    preserved_tags.push(reg.tag.clone());
                    match &reg.kind {
                        RegistrationKind::CustomElementsDefine { component_name, .. }
                        | RegistrationKind::StaticMethodDefine { component_name, .. }
                        | RegistrationKind::TranspiledDecorate { component_name, .. } => {
                            if !component_name.is_empty() {
                                preserved_component_names.insert(component_name.clone());
                            }
                        }
                        RegistrationKind::ClassDecorator { .. } => {}
                    }
                } else {
                    removed_tags.push(reg.tag.clone());
                    match &reg.kind {
                        RegistrationKind::CustomElementsDefine { .. }
                        | RegistrationKind::StaticMethodDefine { .. } => {
                            stmts_to_remove.insert(reg.statement_index);
                        }
                        RegistrationKind::TranspiledDecorate { component_name, .. } => {
                            stmts_to_remove.insert(reg.statement_index);
                            if !component_name.is_empty() {
                                candidate_shaken_classes.push(component_name.clone());
                            }
                        }
                        RegistrationKind::ClassDecorator {
                            decorator_index, ..
                        } => {
                            class_decorators_to_remove
                                .push((reg.statement_index, *decorator_index));
                        }
                    }
                }
            }
        }

        let mut shaken_local_classes = HashSet::new();
        let mut originally_referenced_imports: HashSet<(usize, usize)> = HashSet::new();
        if !removed_tags.is_empty() {
            let scoping = resolver.semantic.scoping();
            let root = scoping.root_scope_id();

            for (stmt_idx, stmt) in program.body.iter().enumerate() {
                if let Statement::ImportDeclaration(import_decl) = stmt {
                    if let Some(specifiers) = &import_decl.specifiers {
                        for (spec_idx, spec) in specifiers.iter().enumerate() {
                            let local_name = match spec {
                                ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                    s.local.name.as_str()
                                }
                                ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                                    s.local.name.as_str()
                                }
                                ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                                    s.local.name.as_str()
                                }
                            };
                            if let Some(sym_id) = scoping.get_binding(root, local_name.into()) {
                                if scoping.get_resolved_references(sym_id).count() > 0 {
                                    originally_referenced_imports.insert((stmt_idx, spec_idx));
                                }
                            }
                        }
                    }
                }
            }

            for cls_name in candidate_shaken_classes {
                if preserved_component_names.contains(&cls_name) {
                    continue;
                }
                let Some(cls_stmt_idx) = find_local_class_stmt_index(&program, &cls_name) else {
                    continue;
                };
                let mut aux_stmts = HashSet::new();
                for (idx, stmt) in program.body.iter().enumerate() {
                    if idx == cls_stmt_idx || stmts_to_remove.contains(&idx) {
                        continue;
                    }
                    if is_auxiliary_class_stmt(stmt, &cls_name, &resolver) {
                        aux_stmts.insert(idx);
                    }
                }

                // Ensure the class is not referenced by any other active class or function in the module
                let is_used_by_other_code =
                    if let Some(sym_id) = scoping.get_binding(root, cls_name.as_str().into()) {
                        program.body.iter().enumerate().any(|(idx, stmt)| {
                            if idx == cls_stmt_idx
                                || stmts_to_remove.contains(&idx)
                                || aux_stmts.contains(&idx)
                                || is_export_or_alias_of_class(stmt, &cls_name)
                            {
                                return false;
                            }
                            resolver.count_symbol_references_in_statement(stmt, sym_id) > 0
                        })
                    } else {
                        false
                    };

                if !is_used_by_other_code {
                    stmts_to_remove.extend(aux_stmts);
                    shaken_local_classes.insert(cls_name);
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
            shaken_local_classes,
            originally_referenced_imports,
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
    for (stmt_idx, dec_idx) in &class_decorators_to_remove {
        if let Some(stmt) = program.body.get_mut(*stmt_idx) {
            match stmt {
                Statement::ClassDeclaration(class) => {
                    if *dec_idx < class.decorators.len() {
                        class.decorators.remove(*dec_idx);
                    }
                }
                Statement::VariableDeclaration(var_decl) => {
                    for decl in &mut var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                            if *dec_idx < class.decorators.len() {
                                class.decorators.remove(*dec_idx);
                            }
                        }
                    }
                }
                Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                    Declaration::ClassDeclaration(class) => {
                        if *dec_idx < class.decorators.len() {
                            class.decorators.remove(*dec_idx);
                        }
                    }
                    Declaration::VariableDeclaration(var_decl) => {
                        for decl in &mut var_decl.declarations {
                            if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                                if *dec_idx < class.decorators.len() {
                                    class.decorators.remove(*dec_idx);
                                }
                            }
                        }
                    }
                    _ => {}
                },
                Statement::ExportDefaultDeclaration(export_decl) => {
                    if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                        &mut export_decl.declaration
                    {
                        if *dec_idx < class.decorators.len() {
                            class.decorators.remove(*dec_idx);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // 2. Empty class body and heritage for shaken local transpiled classes so dead style/base imports are freed
    if !shaken_local_classes.is_empty() {
        for stmt in &mut program.body {
            clear_shaken_class_in_stmt(stmt, &shaken_local_classes);
        }
    }

    // 3. Determine which import specifiers now have 0 remaining references outside removed statements
    let (specifiers_to_remove, pruned_imports_count) = {
        let semantic_ret = SemanticBuilder::new().build(&program);
        let resolver = SymbolResolver::new(&semantic_ret.semantic, &program, source);
        let scoping = resolver.semantic.scoping();
        let root = scoping.root_scope_id();

        let mut specs_to_remove: HashSet<(usize, usize)> = HashSet::new();
        let mut pruned_count = 0;

        for &(stmt_idx, spec_idx) in &originally_referenced_imports {
            if let Some(Statement::ImportDeclaration(import_decl)) = program.body.get(stmt_idx) {
                if let Some(specifiers) = &import_decl.specifiers {
                    if let Some(spec) = specifiers.get(spec_idx) {
                        let local_name = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(s) => s.local.name.as_str(),
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                                s.local.name.as_str()
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                                s.local.name.as_str()
                            }
                        };

                        if SymbolResolver::is_identifier_exported(&program, local_name) {
                            continue;
                        }

                        if let Some(symbol_id) = scoping.get_binding(root, local_name.into()) {
                            let remaining_refs: usize = program
                                .body
                                .iter()
                                .enumerate()
                                .filter(|(idx, _)| !stmts_to_remove.contains(idx))
                                .map(|(_, s)| {
                                    resolver.count_symbol_references_in_statement(s, symbol_id)
                                })
                                .sum();

                            if remaining_refs == 0 && specs_to_remove.insert((stmt_idx, spec_idx)) {
                                pruned_count += 1;
                            }
                        }
                    }
                }
            }
        }

        (specs_to_remove, pruned_count)
    };

    // 4. Remove specifiers from import declarations deterministically without index shift
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

    // 5. Filter out statements:
    // - Explicitly marked registration and auxiliary statements
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

fn find_local_class_stmt_index(program: &Program, cls_name: &str) -> Option<usize> {
    for (idx, stmt) in program.body.iter().enumerate() {
        let matched = match stmt {
            Statement::ClassDeclaration(cls) => {
                cls.id.as_ref().map(|i| i.name.as_str()) == Some(cls_name)
            }
            Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().any(|d| {
                if let BindingPattern::BindingIdentifier(id) = &d.id {
                    if id.name == cls_name {
                        if let Some(init) = &d.init {
                            return matches!(
                                init.without_parentheses(),
                                Expression::ClassExpression(_)
                            );
                        }
                    }
                }
                false
            }),
            Statement::ExportDeclaration(exp) => match &exp.declaration {
                Declaration::ClassDeclaration(cls) => {
                    cls.id.as_ref().map(|i| i.name.as_str()) == Some(cls_name)
                }
                Declaration::VariableDeclaration(var_decl) => {
                    var_decl.declarations.iter().any(|d| {
                        if let BindingPattern::BindingIdentifier(id) = &d.id {
                            if id.name == cls_name {
                                if let Some(init) = &d.init {
                                    return matches!(
                                        init.without_parentheses(),
                                        Expression::ClassExpression(_)
                                    );
                                }
                            }
                        }
                        false
                    })
                }
                _ => false,
            },
            Statement::ExportDefaultDeclaration(exp) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &exp.declaration {
                    cls.id.as_ref().map(|i| i.name.as_str()) == Some(cls_name)
                } else {
                    false
                }
            }
            _ => false,
        };
        if matched {
            return Some(idx);
        }
    }
    None
}

fn get_local_super_class_name(stmt: &Statement) -> Option<String> {
    let cls_opt = match stmt {
        Statement::ClassDeclaration(cls) => Some(cls.as_ref()),
        Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().find_map(|d| {
            if let Some(Expression::ClassExpression(cls)) =
                d.init.as_ref().map(|e| e.without_parentheses())
            {
                Some(cls.as_ref())
            } else {
                None
            }
        }),
        Statement::ExportDeclaration(exp) => match &exp.declaration {
            Declaration::ClassDeclaration(cls) => Some(cls.as_ref()),
            Declaration::VariableDeclaration(var_decl) => {
                var_decl.declarations.iter().find_map(|d| {
                    if let Some(Expression::ClassExpression(cls)) =
                        d.init.as_ref().map(|e| e.without_parentheses())
                    {
                        Some(cls.as_ref())
                    } else {
                        None
                    }
                })
            }
            _ => None,
        },
        Statement::ExportDefaultDeclaration(exp) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &exp.declaration {
                Some(cls.as_ref())
            } else {
                None
            }
        }
        _ => None,
    };
    let cls = cls_opt?;
    let heritage = cls.heritage.as_ref()?;
    if let Expression::Identifier(id) = heritage.expression.without_parentheses() {
        Some(id.name.as_str().to_string())
    } else {
        None
    }
}

fn is_auxiliary_class_stmt(stmt: &Statement, cls_name: &str, resolver: &SymbolResolver) -> bool {
    let Statement::ExpressionStatement(expr_stmt) = stmt else {
        return false;
    };
    let expr = expr_stmt.expression.without_parentheses();
    match expr {
        Expression::CallExpression(call) => {
            if resolver.is_decorator_helper_callee(&call.callee) {
                if let Some(arg1) = call.arguments.get(1).and_then(|a| a.as_expression()) {
                    match arg1.without_parentheses() {
                        Expression::Identifier(id) if id.name == cls_name => return true,
                        Expression::StaticMemberExpression(mem)
                            if mem.property.name == "prototype" =>
                        {
                            if let Expression::Identifier(id) = mem.object.without_parentheses() {
                                if id.name == cls_name {
                                    return true;
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            if let Expression::StaticMemberExpression(mem) = call.callee.without_parentheses() {
                if let Expression::Identifier(id) = mem.object.without_parentheses() {
                    if id.name == cls_name
                        && mem.property.name != "define"
                        && mem.property.name != "register"
                    {
                        return true;
                    }
                }
            }
            false
        }
        Expression::ChainExpression(chain) => {
            if let ChainElement::CallExpression(call) = &chain.expression {
                match call.callee.without_parentheses() {
                    Expression::StaticMemberExpression(mem) => {
                        if let Expression::Identifier(id) = mem.object.without_parentheses() {
                            if id.name == cls_name {
                                return true;
                            }
                        }
                    }
                    _ => {}
                }
            }
            false
        }
        Expression::AssignmentExpression(assign) => match &assign.left {
            AssignmentTarget::StaticMemberExpression(mem) => {
                if let Expression::Identifier(id) = mem.object.without_parentheses() {
                    id.name == cls_name
                } else {
                    false
                }
            }
            _ => false,
        },
        _ => false,
    }
}

fn is_export_or_alias_of_class(stmt: &Statement, cls_name: &str) -> bool {
    match stmt {
        Statement::ExportNamedDeclaration(_) | Statement::ExportDefaultDeclaration(_) => true,
        Statement::VariableDeclaration(var_decl) => var_decl.declarations.iter().all(|d| {
            if let Some(init) = &d.init {
                if let Expression::Identifier(id) = init.without_parentheses() {
                    return id.name == cls_name;
                }
            }
            false
        }),
        _ => false,
    }
}

fn clear_shaken_class_in_stmt(stmt: &mut Statement, shaken_classes: &HashSet<String>) {
    match stmt {
        Statement::ClassDeclaration(cls) => {
            if let Some(id) = &cls.id {
                if shaken_classes.contains(id.name.as_str()) {
                    cls.heritage = None;
                    cls.body.body.clear();
                }
            }
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let BindingPattern::BindingIdentifier(id) = &decl.id {
                    if shaken_classes.contains(id.name.as_str()) {
                        if let Some(Expression::ClassExpression(cls)) = &mut decl.init {
                            cls.heritage = None;
                            cls.body.body.clear();
                        }
                    }
                }
            }
        }
        Statement::ExportDeclaration(exp) => match &mut exp.declaration {
            Declaration::ClassDeclaration(cls) => {
                if let Some(id) = &cls.id {
                    if shaken_classes.contains(id.name.as_str()) {
                        cls.heritage = None;
                        cls.body.body.clear();
                    }
                }
            }
            Declaration::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let BindingPattern::BindingIdentifier(id) = &decl.id {
                        if shaken_classes.contains(id.name.as_str()) {
                            if let Some(Expression::ClassExpression(cls)) = &mut decl.init {
                                cls.heritage = None;
                                cls.body.body.clear();
                            }
                        }
                    }
                }
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(exp) => {
            if let ExportDefaultDeclarationKind::ClassDeclaration(cls) = &mut exp.declaration {
                if let Some(id) = &cls.id {
                    if shaken_classes.contains(id.name.as_str()) {
                        cls.heritage = None;
                        cls.body.body.clear();
                    }
                }
            }
        }
        _ => {}
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

    #[test]
    fn test_aliased_decorator_helper_custom_element() {
        let code = r#"
            import { customElement } from 'lit/decorators.js';
            import { __decorate as dec } from 'tslib';
            let DeadWidget = class DeadWidget {};
            DeadWidget = dec([
                customElement('dead-widget')
            ], DeadWidget);
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
        assert!(!res.code.contains("dead-widget"));
    }
}
