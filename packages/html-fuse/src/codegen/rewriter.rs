use crate::models::{ExtractedFragment, HtmlClusterGroup, RewrittenFileInfo};
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone)]
struct FragReplacement<'a> {
    start: usize,
    end: usize,
    cluster: &'a HtmlClusterGroup,
    is_full_template: bool,
}

pub fn rewrite_file(
    file_path: &str,
    original_code: &str,
    fragments: &[ExtractedFragment],
    clusters: &[HtmlClusterGroup],
    output_dir: &str,
    virtual_imports: bool,
) -> Option<RewrittenFileInfo> {
    // Check which clusters apply to this file
    let applicable_clusters: Vec<&HtmlClusterGroup> = clusters
        .iter()
        .filter(|c| c.shared_by_files.contains(&file_path.to_string()))
        .collect();

    if applicable_clusters.is_empty() {
        return None;
    }

    let mut cluster_map = HashMap::new();
    for cluster in &applicable_clusters {
        if let Some(hash) = cluster.id.split('_').next_back() {
            cluster_map.insert(hash.to_string(), *cluster);
        }
    }

    let file_frags: Vec<&ExtractedFragment> = fragments
        .iter()
        .filter(|f| f.file_path == file_path)
        .collect();

    if file_frags.is_empty() {
        return None;
    }

    let mut replacements: Vec<FragReplacement> = Vec::new();
    for frag in file_frags {
        if let Some(cluster) = cluster_map.get(&frag.hash) {
            replacements.push(FragReplacement {
                start: frag.span.start,
                end: frag.span.end,
                cluster,
                is_full_template: frag.is_full_template,
            });
        }
    }

    if replacements.is_empty() {
        return None;
    }

    // Deduplicate/filter overlapping replacements: sort by start asc, end desc
    replacements.sort_by(|a, b| {
        let cmp = a.start.cmp(&b.start);
        if cmp != std::cmp::Ordering::Equal {
            return cmp;
        }
        b.end.cmp(&a.end)
    });

    let mut filtered_replacements: Vec<FragReplacement> = Vec::new();
    let mut used_clusters = Vec::new();
    let mut last_end = 0;
    for rep in replacements {
        if rep.start >= last_end {
            last_end = rep.end;
            used_clusters.push(rep.cluster.id.clone());
            filtered_replacements.push(rep);
        }
    }

    if filtered_replacements.is_empty() {
        return None;
    }

    used_clusters.sort();
    used_clusters.dedup();

    let allocator = Allocator::default();
    let source_type = SourceType::from_path(Path::new(file_path)).unwrap_or_default();
    let parser = Parser::new(&allocator, original_code, source_type);
    let mut parsed = parser.parse();

    if !parsed.diagnostics.is_empty() && parsed.program.body.is_empty() {
        return None;
    }

    let ast = AstBuilder::new(&allocator);
    let mut rewritten_count = 0;

    for stmt in &mut parsed.program.body {
        walk_statement(
            stmt,
            &ast,
            &allocator,
            &filtered_replacements,
            &mut rewritten_count,
        );
    }

    if rewritten_count == 0 {
        return None;
    }

    // Prepend import statements for used virtual clusters
    let mut new_body = ArenaVec::new_in(&ast);
    for cid in &used_clusters {
        let import_specifier = if virtual_imports {
            format!("virtual:html-fuse/{}.js", cid)
        } else {
            compute_relative_import(file_path, output_dir, cid)
        };
        new_body.push(create_import_declaration(
            &ast,
            &allocator,
            cid,
            &import_specifier,
        ));
    }
    for stmt in parsed.program.body {
        new_body.push(stmt);
    }
    parsed.program.body = new_body;

    let codegen_options = oxc_codegen::CodegenOptions {
        single_quote: true,
        ..oxc_codegen::CodegenOptions::default()
    };
    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);

    Some(RewrittenFileInfo {
        file_path: file_path.to_string(),
        original_code: original_code.to_string(),
        transformed_code: codegen_result.code,
        fused_imports: used_clusters,
    })
}

fn walk_statement<'a>(
    stmt: &mut Statement<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    replacements: &[FragReplacement],
    rewritten_count: &mut usize,
) {
    match stmt {
        Statement::ClassDeclaration(class) => {
            walk_class(class, ast, allocator, replacements, rewritten_count);
        }
        Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
            Declaration::ClassDeclaration(class) => {
                walk_class(class, ast, allocator, replacements, rewritten_count);
            }
            Declaration::FunctionDeclaration(func) => {
                walk_function(func, ast, allocator, replacements, rewritten_count);
            }
            Declaration::VariableDeclaration(var_decl) => {
                walk_variable_declaration(var_decl, ast, allocator, replacements, rewritten_count);
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export_default) => {
            match &mut export_default.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    walk_class(class, ast, allocator, replacements, rewritten_count);
                }
                ExportDefaultDeclarationKind::FunctionDeclaration(func) => {
                    walk_function(func, ast, allocator, replacements, rewritten_count);
                }
                _ => {
                    if let Some(expr) = export_default.declaration.as_expression_mut() {
                        walk_expression(expr, ast, allocator, replacements, rewritten_count);
                    }
                }
            }
        }
        Statement::FunctionDeclaration(func) => {
            walk_function(func, ast, allocator, replacements, rewritten_count);
        }
        Statement::VariableDeclaration(var_decl) => {
            walk_variable_declaration(var_decl, ast, allocator, replacements, rewritten_count);
        }
        Statement::ExpressionStatement(expr_stmt) => {
            walk_expression(
                &mut expr_stmt.expression,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &mut ret.argument {
                walk_expression(arg, ast, allocator, replacements, rewritten_count);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                walk_statement(s, ast, allocator, replacements, rewritten_count);
            }
        }
        Statement::IfStatement(if_stmt) => {
            walk_expression(
                &mut if_stmt.test,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_statement(
                &mut if_stmt.consequent,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            if let Some(alt) = &mut if_stmt.alternate {
                walk_statement(alt, ast, allocator, replacements, rewritten_count);
            }
        }
        Statement::SwitchStatement(switch_stmt) => {
            walk_expression(
                &mut switch_stmt.discriminant,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            for case in &mut switch_stmt.cases {
                if let Some(test) = &mut case.test {
                    walk_expression(test, ast, allocator, replacements, rewritten_count);
                }
                for s in &mut case.consequent {
                    walk_statement(s, ast, allocator, replacements, rewritten_count);
                }
            }
        }
        Statement::TryStatement(try_stmt) => {
            for s in &mut try_stmt.block.body {
                walk_statement(s, ast, allocator, replacements, rewritten_count);
            }
            if let Some(handler) = &mut try_stmt.handler {
                for s in &mut handler.body.body {
                    walk_statement(s, ast, allocator, replacements, rewritten_count);
                }
            }
            if let Some(finalizer) = &mut try_stmt.finalizer {
                for s in &mut finalizer.body {
                    walk_statement(s, ast, allocator, replacements, rewritten_count);
                }
            }
        }
        Statement::WhileStatement(while_stmt) => {
            walk_expression(
                &mut while_stmt.test,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_statement(
                &mut while_stmt.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::DoWhileStatement(do_while) => {
            walk_statement(
                &mut do_while.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_expression(
                &mut do_while.test,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::ForStatement(for_stmt) => {
            if let Some(init) = &mut for_stmt.init {
                match init {
                    ForStatementInit::VariableDeclaration(var_decl) => {
                        walk_variable_declaration(
                            var_decl,
                            ast,
                            allocator,
                            replacements,
                            rewritten_count,
                        );
                    }
                    _ => {
                        if let Some(expr) = init.as_expression_mut() {
                            walk_expression(expr, ast, allocator, replacements, rewritten_count);
                        }
                    }
                }
            }
            if let Some(test) = &mut for_stmt.test {
                walk_expression(test, ast, allocator, replacements, rewritten_count);
            }
            if let Some(update) = &mut for_stmt.update {
                walk_expression(update, ast, allocator, replacements, rewritten_count);
            }
            walk_statement(
                &mut for_stmt.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::ForInStatement(for_in) => {
            if let ForStatementLeft::VariableDeclaration(var_decl) = &mut for_in.left {
                walk_variable_declaration(var_decl, ast, allocator, replacements, rewritten_count);
            }
            walk_expression(
                &mut for_in.right,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_statement(
                &mut for_in.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::ForOfStatement(for_of) => {
            if let ForStatementLeft::VariableDeclaration(var_decl) = &mut for_of.left {
                walk_variable_declaration(var_decl, ast, allocator, replacements, rewritten_count);
            }
            walk_expression(
                &mut for_of.right,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_statement(
                &mut for_of.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::LabeledStatement(labeled) => {
            walk_statement(
                &mut labeled.body,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Statement::ThrowStatement(throw_stmt) => {
            walk_expression(
                &mut throw_stmt.argument,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        _ => {}
    }
}

fn walk_class<'a>(
    class: &mut Class<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    replacements: &[FragReplacement],
    rewritten_count: &mut usize,
) {
    for element in &mut class.body.body {
        match element {
            ClassElement::MethodDefinition(method) => {
                if let Some(body) = &mut method.value.body {
                    for stmt in &mut body.statements {
                        walk_statement(stmt, ast, allocator, replacements, rewritten_count);
                    }
                }
            }
            ClassElement::PropertyDefinition(prop) => {
                if let Some(val) = &mut prop.value {
                    walk_expression(val, ast, allocator, replacements, rewritten_count);
                }
            }
            _ => {}
        }
    }
}

fn walk_function<'a>(
    func: &mut Function<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    replacements: &[FragReplacement],
    rewritten_count: &mut usize,
) {
    if let Some(body) = &mut func.body {
        for stmt in &mut body.statements {
            walk_statement(stmt, ast, allocator, replacements, rewritten_count);
        }
    }
}

fn walk_variable_declaration<'a>(
    var_decl: &mut VariableDeclaration<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    replacements: &[FragReplacement],
    rewritten_count: &mut usize,
) {
    for declarator in &mut var_decl.declarations {
        if let Some(init) = &mut declarator.init {
            walk_expression(init, ast, allocator, replacements, rewritten_count);
        }
    }
}

fn walk_expression<'a>(
    expr: &mut Expression<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    replacements: &[FragReplacement],
    rewritten_count: &mut usize,
) {
    if let Expression::TaggedTemplateExpression(tagged) = expr {
        let tagged_start = tagged.span.start as usize;

        // Check if full template candidate matches this tagged template
        if let Some(rep) = replacements
            .iter()
            .find(|r| r.is_full_template && r.start == tagged_start)
        {
            *expr = Expression::new_identifier(SPAN, allocator.alloc_str(&rep.cluster.id), ast);
            *rewritten_count += 1;
            return;
        }

        // Subtree candidates within the template literal quasis
        // Process quasis
        let mut q_idx = 0;
        while q_idx < tagged.quasi.quasis.len() {
            let quasi_start = tagged.quasi.quasis[q_idx].span.start as usize;
            let quasi_end = tagged.quasi.quasis[q_idx].span.end as usize;

            // Find all replacements that fall strictly within this quasi
            let mut matching_reps: Vec<&FragReplacement> = replacements
                .iter()
                .filter(|r| !r.is_full_template && r.start >= quasi_start && r.end <= quasi_end)
                .collect();

            if matching_reps.is_empty() {
                q_idx += 1;
                continue;
            }

            // Sort matching replacements descending by start offset
            matching_reps.sort_by_key(|r| std::cmp::Reverse(r.start));

            for rep in matching_reps {
                let rel_start = rep.start - quasi_start;
                let rel_end = rep.end - quasi_start;
                let raw = tagged.quasi.quasis[q_idx].value.raw.as_str().to_string();

                if rel_start <= rel_end && rel_end <= raw.len() {
                    let part_before = &raw[..rel_start];
                    let part_after = &raw[rel_end..];
                    let was_tail = tagged.quasi.quasis[q_idx].tail;

                    let before_str = allocator.alloc_str(part_before);
                    tagged.quasi.quasis[q_idx].value.raw = before_str.into();
                    tagged.quasi.quasis[q_idx].value.cooked = Some(before_str.into());
                    tagged.quasi.quasis[q_idx].tail = false;

                    let after_str = allocator.alloc_str(part_after);
                    let val_after = TemplateElementValue {
                        raw: after_str.into(),
                        cooked: Some(after_str.into()),
                    };
                    let new_quasi = TemplateElement::new(SPAN, val_after, was_tail, ast);

                    let new_expr =
                        Expression::new_identifier(SPAN, allocator.alloc_str(&rep.cluster.id), ast);

                    tagged.quasi.quasis.insert(q_idx + 1, new_quasi);
                    tagged.quasi.expressions.insert(q_idx, new_expr);
                    *rewritten_count += 1;
                }
            }

            q_idx += 1;
        }

        // Walk expressions inside the template
        for expr_child in &mut tagged.quasi.expressions {
            walk_expression(expr_child, ast, allocator, replacements, rewritten_count);
        }
        return;
    }

    match expr {
        Expression::CallExpression(call) => {
            walk_expression(
                &mut call.callee,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            for arg in &mut call.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    walk_expression(e, ast, allocator, replacements, rewritten_count);
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for stmt in &mut body.statements {
                    walk_statement(stmt, ast, allocator, replacements, rewritten_count);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression_mut() {
                    walk_expression(e, ast, allocator, replacements, rewritten_count);
                }
            }
        },
        Expression::ParenthesizedExpression(p) => {
            walk_expression(
                &mut p.expression,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Expression::ConditionalExpression(c) => {
            walk_expression(&mut c.test, ast, allocator, replacements, rewritten_count);
            walk_expression(
                &mut c.consequent,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
            walk_expression(
                &mut c.alternate,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Expression::LogicalExpression(l) => {
            walk_expression(&mut l.left, ast, allocator, replacements, rewritten_count);
            walk_expression(&mut l.right, ast, allocator, replacements, rewritten_count);
        }
        Expression::BinaryExpression(b) => {
            walk_expression(&mut b.left, ast, allocator, replacements, rewritten_count);
            walk_expression(&mut b.right, ast, allocator, replacements, rewritten_count);
        }
        Expression::ArrayExpression(arr) => {
            for elem in &mut arr.elements {
                if let Some(e) = elem.as_expression_mut() {
                    walk_expression(e, ast, allocator, replacements, rewritten_count);
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    walk_expression(&mut p.value, ast, allocator, replacements, rewritten_count);
                }
            }
        }
        Expression::AssignmentExpression(assign) => {
            walk_expression(
                &mut assign.right,
                ast,
                allocator,
                replacements,
                rewritten_count,
            );
        }
        Expression::SequenceExpression(seq) => {
            for e in &mut seq.expressions {
                walk_expression(e, ast, allocator, replacements, rewritten_count);
            }
        }
        _ => {}
    }
}

fn create_import_declaration<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_id: &str,
    import_specifier: &str,
) -> Statement<'a> {
    let imported =
        ModuleExportName::new_identifier_name(SPAN, allocator.alloc_str(cluster_id), ast);
    let local = BindingIdentifier::new(SPAN, allocator.alloc_str(cluster_id), ast);
    let specifier = ImportDeclarationSpecifier::ImportSpecifier(ArenaBox::new_in(
        ImportSpecifier::new(SPAN, imported, local, ImportOrExportKind::Value, ast),
        ast,
    ));
    let mut specifiers = ArenaVec::new_in(ast);
    specifiers.push(specifier);
    let source_lit = StringLiteral::new(SPAN, allocator.alloc_str(import_specifier), None, ast);
    Statement::new_import_declaration(
        SPAN,
        Some(specifiers),
        source_lit,
        None,
        None,
        ImportOrExportKind::Value,
        ast,
    )
}

fn compute_relative_import(from_file: &str, output_dir: &str, cluster_id: &str) -> String {
    let file_path = Path::new(from_file);
    let parent = file_path.parent().unwrap_or(Path::new(""));
    let out_path = Path::new(output_dir).join(format!("{}.js", cluster_id));

    let parent_components: Vec<_> = parent.components().collect();
    let target_components: Vec<_> = out_path.components().collect();

    let mut common = 0;
    while common < parent_components.len()
        && common < target_components.len()
        && parent_components[common] == target_components[common]
    {
        common += 1;
    }

    let mut parts = Vec::new();
    for _ in common..parent_components.len() {
        parts.push("..".to_string());
    }
    for c in &target_components[common..] {
        parts.push(c.as_os_str().to_string_lossy().to_string());
    }

    let joined = parts.join("/");
    if !joined.starts_with("./") && !joined.starts_with("../") {
        format!("./{}", joined)
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rewrite_bailout_when_no_clusters() {
        let code = "import { html } from 'lit'; const t = html`<div>test</div>`;";
        let res = rewrite_file("comp.ts", code, &[], &[], ".fused", false);
        assert!(
            res.is_none(),
            "rewrite_file must cleanly bail out with None when no clusters apply"
        );
    }
}
