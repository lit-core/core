use crate::models::{ClusterGroup, ExtractedStyle, RewrittenFileInfo};
use crate::normalizer::subtract_rules_from_css;
use oxc_allocator::{Allocator, ArenaVec, Box as ArenaBox};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SPAN, SourceType};
use std::path::Path;

struct StyleRewrite {
    style_span_start: usize,
    parent_span_start: Option<usize>,
    remaining_css: Option<String>,
    tag: String,
}

pub fn rewrite_file(
    file_path: &str,
    original_code: &str,
    extracted_styles: &[ExtractedStyle],
    clusters: &[ClusterGroup],
    output_dir: &str,
    virtual_imports: bool,
) -> Option<RewrittenFileInfo> {
    // Find which clusters apply to this file
    let applicable_clusters: Vec<&ClusterGroup> = clusters
        .iter()
        .filter(|c| c.shared_by_files.contains(&file_path.to_string()))
        .collect();

    if applicable_clusters.is_empty() {
        return None;
    }

    let file_styles: Vec<&ExtractedStyle> = extracted_styles
        .iter()
        .filter(|s| s.file_path == file_path)
        .collect();

    if file_styles.is_empty() {
        return None;
    }

    // Gather all shared rules applicable to this file
    let mut shared_rules = Vec::new();
    let mut cluster_ids = Vec::new();
    for cluster in &applicable_clusters {
        shared_rules.extend(cluster.rules.clone());
        cluster_ids.push(cluster.id.clone());
    }
    cluster_ids.sort_by(|a, b| {
        let a_sub = a.starts_with("_fused_subsystem_");
        let b_sub = b.starts_with("_fused_subsystem_");
        match (a_sub, b_sub) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.cmp(b),
        }
    });
    cluster_ids.dedup();

    let mut rewrites = Vec::new();
    for style in file_styles {
        let remaining_css = subtract_rules_from_css(style, &shared_rules);
        let tag = style.tag_identifier.as_deref().unwrap_or("css").to_string();
        rewrites.push(StyleRewrite {
            style_span_start: style.span.start,
            parent_span_start: style.parent_span.as_ref().map(|p| p.start),
            remaining_css,
            tag,
        });
    }

    if rewrites.is_empty() {
        return None;
    }

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
        rewrite_statement(
            stmt,
            &ast,
            &allocator,
            &cluster_ids,
            &rewrites,
            &mut rewritten_count,
        );
    }

    if rewritten_count == 0 {
        return None;
    }

    // Prepend import statements for applicable fused clusters
    let mut new_body = ArenaVec::new_in(&ast);
    for cid in &cluster_ids {
        let import_specifier = if virtual_imports {
            format!("virtual:css-fuse/{}.js", cid)
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
        fused_imports: cluster_ids,
    })
}

fn rewrite_statement<'a>(
    stmt: &mut Statement<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_ids: &[String],
    rewrites: &[StyleRewrite],
    rewritten_count: &mut usize,
) {
    match stmt {
        Statement::ClassDeclaration(class) => {
            rewrite_class(
                class,
                ast,
                allocator,
                cluster_ids,
                rewrites,
                rewritten_count,
            );
        }
        Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
            Declaration::ClassDeclaration(class) => {
                rewrite_class(
                    class,
                    ast,
                    allocator,
                    cluster_ids,
                    rewrites,
                    rewritten_count,
                );
            }
            Declaration::VariableDeclaration(var_decl) => {
                rewrite_variable_declaration(
                    var_decl,
                    ast,
                    allocator,
                    cluster_ids,
                    rewrites,
                    rewritten_count,
                );
            }
            _ => {}
        },
        Statement::ExportDefaultDeclaration(export_default) => {
            match &mut export_default.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    rewrite_class(
                        class,
                        ast,
                        allocator,
                        cluster_ids,
                        rewrites,
                        rewritten_count,
                    );
                }
                _ => {
                    if let Some(expr) = export_default.declaration.as_expression_mut() {
                        let expr_start = expr.span().start as usize;
                        rewrite_styles_expression(
                            expr,
                            ast,
                            allocator,
                            cluster_ids,
                            rewrites,
                            Some(expr_start),
                            rewritten_count,
                        );
                    }
                }
            }
        }
        Statement::VariableDeclaration(var_decl) => {
            rewrite_variable_declaration(
                var_decl,
                ast,
                allocator,
                cluster_ids,
                rewrites,
                rewritten_count,
            );
        }
        Statement::ExpressionStatement(expr_stmt) => {
            let expr_start = expr_stmt.expression.span().start as usize;
            rewrite_styles_expression(
                &mut expr_stmt.expression,
                ast,
                allocator,
                cluster_ids,
                rewrites,
                Some(expr_start),
                rewritten_count,
            );
        }
        _ => {}
    }
}

fn rewrite_class<'a>(
    class: &mut Class<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_ids: &[String],
    rewrites: &[StyleRewrite],
    rewritten_count: &mut usize,
) {
    for element in &mut class.body.body {
        match element {
            ClassElement::PropertyDefinition(prop) => {
                let is_styles_key = match &prop.key {
                    PropertyKey::StaticIdentifier(id) => id.name == "styles",
                    PropertyKey::Identifier(id) => id.name == "styles",
                    _ => false,
                };

                if prop.r#static && is_styles_key {
                    let prop_start = prop.span.start as usize;
                    if let Some(val) = &mut prop.value {
                        rewrite_styles_expression(
                            val,
                            ast,
                            allocator,
                            cluster_ids,
                            rewrites,
                            Some(prop_start),
                            rewritten_count,
                        );
                    }
                }
            }
            ClassElement::MethodDefinition(method) => {
                let is_styles_key = match &method.key {
                    PropertyKey::StaticIdentifier(id) => id.name == "styles",
                    PropertyKey::Identifier(id) => id.name == "styles",
                    _ => false,
                };

                if method.r#static
                    && method.kind == MethodDefinitionKind::Get
                    && is_styles_key
                    && let Some(body) = &mut method.value.body
                {
                    for body_stmt in &mut body.statements {
                        if let Statement::ReturnStatement(ret) = body_stmt {
                            let ret_start = ret.span.start as usize;
                            if let Some(arg) = &mut ret.argument {
                                rewrite_styles_expression(
                                    arg,
                                    ast,
                                    allocator,
                                    cluster_ids,
                                    rewrites,
                                    Some(ret_start),
                                    rewritten_count,
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn rewrite_variable_declaration<'a>(
    var_decl: &mut VariableDeclaration<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_ids: &[String],
    rewrites: &[StyleRewrite],
    rewritten_count: &mut usize,
) {
    for declarator in &mut var_decl.declarations {
        if let Some(init) = &mut declarator.init {
            let decl_start = declarator.span.start as usize;
            rewrite_styles_expression(
                init,
                ast,
                allocator,
                cluster_ids,
                rewrites,
                Some(decl_start),
                rewritten_count,
            );
        }
    }
}

fn create_tagged_template_expr<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    remaining_css: &str,
    tag: &str,
) -> Expression<'a> {
    let tag_ident = Expression::new_identifier(SPAN, allocator.alloc_str(tag), ast);
    let mut quasis = ArenaVec::new_in(ast);
    let raw_css = allocator.alloc_str(remaining_css);
    let val = TemplateElementValue {
        raw: raw_css.into(),
        cooked: Some(raw_css.into()),
    };
    quasis.push(TemplateElement::new(SPAN, val, true, ast));
    let tmpl_lit = TemplateLiteral::new(SPAN, quasis, ArenaVec::new_in(ast), ast);
    Expression::new_tagged_template_expression(SPAN, tag_ident, None, tmpl_lit, ast)
}

fn create_styles_array_expr<'a>(
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_ids: &[String],
    remaining_css: Option<&str>,
    tag: &str,
) -> Expression<'a> {
    let mut elements = ArenaVec::new_in(ast);
    for cid in cluster_ids {
        let ident = Expression::new_identifier(SPAN, allocator.alloc_str(cid), ast);
        elements.push(ArrayExpressionElement::from(ident));
    }

    if let Some(rem) = remaining_css {
        let tagged_tmpl = create_tagged_template_expr(ast, allocator, rem, tag);
        elements.push(ArrayExpressionElement::from(tagged_tmpl));
    }

    Expression::new_array_expression(SPAN, elements, ast)
}

fn rewrite_styles_expression<'a>(
    expr: &mut Expression<'a>,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    cluster_ids: &[String],
    rewrites: &[StyleRewrite],
    parent_span_start: Option<usize>,
    rewritten_count: &mut usize,
) {
    match expr {
        Expression::ArrayExpression(arr) => {
            let has_matched_element = arr.elements.iter().any(|elem| {
                if let Some(e) = elem.as_expression() {
                    let e_start = e.span().start as usize;
                    rewrites.iter().any(|r| r.style_span_start == e_start)
                } else {
                    false
                }
            });

            if has_matched_element {
                let old_elements = std::mem::replace(&mut arr.elements, ArenaVec::new_in(ast));
                let mut new_elements = ArenaVec::new_in(ast);

                for cid in cluster_ids {
                    let ident = Expression::new_identifier(SPAN, allocator.alloc_str(cid), ast);
                    new_elements.push(ArrayExpressionElement::from(ident));
                }

                for elem in old_elements {
                    if let Some(e) = elem.as_expression() {
                        let e_start = e.span().start as usize;
                        if let Some(rw) = rewrites.iter().find(|r| r.style_span_start == e_start) {
                            *rewritten_count += 1;
                            if let Some(rem) = rw.remaining_css.as_deref() {
                                let remaining_expr =
                                    create_tagged_template_expr(ast, allocator, rem, &rw.tag);
                                new_elements.push(ArrayExpressionElement::from(remaining_expr));
                            }
                            continue;
                        }
                    }
                    new_elements.push(elem);
                }

                arr.elements = new_elements;
            } else if let Some(p_start) = parent_span_start
                && let Some(rw) = rewrites
                    .iter()
                    .find(|r| r.parent_span_start == Some(p_start))
            {
                *expr = create_styles_array_expr(
                    ast,
                    allocator,
                    cluster_ids,
                    rw.remaining_css.as_deref(),
                    &rw.tag,
                );
                *rewritten_count += 1;
            }
        }
        _ => {
            let expr_start = expr.span().start as usize;
            let matched_rewrite = rewrites.iter().find(|r| {
                r.style_span_start == expr_start
                    || parent_span_start
                        .map(|ps| r.parent_span_start == Some(ps))
                        .unwrap_or(false)
            });

            if let Some(rw) = matched_rewrite {
                *expr = create_styles_array_expr(
                    ast,
                    allocator,
                    cluster_ids,
                    rw.remaining_css.as_deref(),
                    &rw.tag,
                );
                *rewritten_count += 1;
            }
        }
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
