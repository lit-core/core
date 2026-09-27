use crate::import_scanner::{DirectiveKind, ImportContext};
use crate::models::{ClassificationResult, ClassifyOptions};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};

pub fn classify_code(source: &str, options: ClassifyOptions) -> Vec<ClassificationResult> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() && parsed.program.body.is_empty() {
        return Vec::new();
    }

    let program = &parsed.program;
    let import_ctx = ImportContext::scan(program);
    let mut results = Vec::new();

    let forced_mode = options.mode.as_deref().unwrap_or("auto");

    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(res) = classify_class(class, forced_mode, source, &import_ctx, None) {
                    results.push(res);
                }
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(res) =
                        classify_class(class, forced_mode, source, &import_ctx, None)
                    {
                        results.push(res);
                    }
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &decl.init {
                            let name = match &decl.id {
                                BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
                                _ => None,
                            };
                            if let Some(res) =
                                classify_class(class, forced_mode, source, &import_ctx, name)
                            {
                                results.push(res);
                            }
                        }
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export_decl) => match &export_decl.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    if let Some(res) =
                        classify_class(class, forced_mode, source, &import_ctx, None)
                    {
                        results.push(res);
                    }
                }
                ExportDefaultDeclarationKind::ClassExpression(class) => {
                    if let Some(res) =
                        classify_class(class, forced_mode, source, &import_ctx, None)
                    {
                        results.push(res);
                    }
                }
                _ => {}
            },
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
                        let name = match &decl.id {
                            BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
                            _ => None,
                        };
                        if let Some(res) =
                            classify_class(class, forced_mode, source, &import_ctx, name)
                        {
                            results.push(res);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    results
}

pub fn classify_class<'a>(
    class: &Class<'a>,
    forced_mode: &str,
    source: &str,
    import_ctx: &ImportContext,
    fallback_name: Option<&str>,
) -> Option<ClassificationResult> {
    let component_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .or_else(|| fallback_name.map(|s| s.to_string()))
        .unwrap_or_else(|| "AnonymousComponent".to_string());

    // Check heritage: class must extend LitElement, ReactiveElement, or mixin wrapping it
    let mut extends_lit = false;
    if let Some(heritage) = &class.heritage {
        let span = heritage.expression.span();
        let start = (span.start as usize).min(source.len());
        let end = (span.end as usize).min(source.len());
        let heritage_str = &source[start..end];
        if heritage_str.contains("LitElement")
            || heritage_str.contains("ReactiveElement")
            || heritage_str.contains("Element")
        {
            extends_lit = true;
        }
    }

    let tag_name = extract_tag_name(class, source, fallback_name);
    let has_custom_element_decorator = tag_name.is_some();
    let has_render_method = class.body.body.iter().any(|elem| match elem {
        ClassElement::MethodDefinition(m) => {
            m.key.static_name().map(|n| n == "render").unwrap_or(false)
        }
        _ => false,
    });

    if !extends_lit && !has_custom_element_decorator && !has_render_method {
        return None;
    }

    if forced_mode == "vanilla-only" {
        return Some(ClassificationResult {
            mode: "vanilla".to_string(),
            component_name,
            tag_name,
            reason: Some("Forced vanilla-only mode".to_string()),
        });
    }

    if forced_mode == "micro-only" {
        return Some(ClassificationResult {
            mode: "micro".to_string(),
            component_name,
            tag_name,
            reason: Some("Forced micro-only mode".to_string()),
        });
    }

    // Inspect complexity of the class
    let mut has_structural_directive = false;
    let mut has_lowerable_directive = false;
    let mut has_lifecycle_override = false;
    let mut num_html_templates = 0;
    let mut num_reactive_props = 0;

    for elem in &class.body.body {
        match elem {
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if name == "shouldUpdate"
                    || name == "willUpdate"
                    || name == "updated"
                    || name == "firstUpdated"
                {
                    has_lifecycle_override = true;
                }

                if name == "render" {
                    if let Some(body) = &m.value.body {
                        // Count templates and inspect directives
                        for stmt in &body.statements {
                            inspect_render_statement(
                                stmt,
                                import_ctx,
                                &mut has_structural_directive,
                                &mut has_lowerable_directive,
                                &mut num_html_templates,
                            );
                        }
                    }
                }
            }
            ClassElement::PropertyDefinition(prop) => {
                let name = match &prop.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if let Some(p_name) = name {
                    if !prop.r#static && p_name != "styles" {
                        for dec in &prop.decorators {
                            if let Expression::CallExpression(call) = &dec.expression {
                                let callee_name = match &call.callee {
                                    Expression::Identifier(id) => Some(id.name.as_str()),
                                    Expression::StaticMemberExpression(mem) => {
                                        Some(mem.property.name.as_str())
                                    }
                                    _ => None,
                                };
                                if callee_name == Some("property") || callee_name == Some("state") {
                                    num_reactive_props += 1;
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Classification decision:
    // 1. If has structural directives (repeat, cache, until, live) -> Mode B micro/skip
    // 2. If has lowerable directives (classMap, styleMap, ifDefined, guard) OR complex lifecycle -> Mode B
    // 3. If genuine leaf (no directives, <= 12 props, single template, no lifecycle overrides) -> Mode A vanilla
    let (mode, reason) = if has_structural_directive {
        ("micro", Some("Contains structural Lit directives".to_string()))
    } else if has_lowerable_directive {
        ("micro", Some("Contains lowerable Lit directives".to_string()))
    } else if has_lifecycle_override || num_html_templates > 1 || num_reactive_props > 12 {
        ("micro", Some("Complex lifecycle or multiple templates".to_string()))
    } else {
        ("vanilla", Some("Genuine leaf component".to_string()))
    };

    Some(ClassificationResult {
        mode: mode.to_string(),
        component_name,
        tag_name,
        reason,
    })
}

fn inspect_render_statement<'a>(
    stmt: &Statement<'a>,
    import_ctx: &ImportContext,
    has_structural: &mut bool,
    has_lowerable: &mut bool,
    num_templates: &mut usize,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                inspect_render_expression(arg, import_ctx, has_structural, has_lowerable, num_templates);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            inspect_render_expression(&expr_stmt.expression, import_ctx, has_structural, has_lowerable, num_templates);
        }
        Statement::IfStatement(if_stmt) => {
            inspect_render_expression(&if_stmt.test, import_ctx, has_structural, has_lowerable, num_templates);
            inspect_render_statement(&if_stmt.consequent, import_ctx, has_structural, has_lowerable, num_templates);
            if let Some(alt) = &if_stmt.alternate {
                inspect_render_statement(alt, import_ctx, has_structural, has_lowerable, num_templates);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                inspect_render_statement(s, import_ctx, has_structural, has_lowerable, num_templates);
            }
        }
        _ => {}
    }
}

fn inspect_render_expression<'a>(
    expr: &Expression<'a>,
    import_ctx: &ImportContext,
    has_structural: &mut bool,
    has_lowerable: &mut bool,
    num_templates: &mut usize,
) {
    match expr {
        Expression::TaggedTemplateExpression(tag) => {
            if let Expression::Identifier(id) = &tag.tag {
                if id.name == "html" {
                    *num_templates += 1;
                }
            }
            for e in &tag.quasi.expressions {
                inspect_render_expression(e, import_ctx, has_structural, has_lowerable, num_templates);
            }
        }
        Expression::CallExpression(call) => {
            if let Expression::Identifier(id) = &call.callee {
                if let Some(directive) = import_ctx.get_directive_kind(&id.name) {
                    match directive {
                        DirectiveKind::Repeat
                        | DirectiveKind::Cache
                        | DirectiveKind::Until
                        | DirectiveKind::Live => {
                            *has_structural = true;
                        }
                        DirectiveKind::ClassMap
                        | DirectiveKind::StyleMap
                        | DirectiveKind::IfDefined
                        | DirectiveKind::Guard => {
                            *has_lowerable = true;
                        }
                    }
                }
            }
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    inspect_render_expression(e, import_ctx, has_structural, has_lowerable, num_templates);
                }
            }
        }
        Expression::ConditionalExpression(cond) => {
            inspect_render_expression(&cond.test, import_ctx, has_structural, has_lowerable, num_templates);
            inspect_render_expression(&cond.consequent, import_ctx, has_structural, has_lowerable, num_templates);
            inspect_render_expression(&cond.alternate, import_ctx, has_structural, has_lowerable, num_templates);
        }
        _ => {}
    }
}

fn extract_tag_name<'a>(
    class: &Class<'a>,
    source: &str,
    fallback_name: Option<&str>,
) -> Option<String> {
    for dec in &class.decorators {
        if let Expression::CallExpression(call) = &dec.expression {
            let is_custom_elem = match &call.callee {
                Expression::Identifier(id) => id.name == "customElement",
                Expression::StaticMemberExpression(mem) => mem.property.name == "customElement",
                _ => false,
            };
            if is_custom_elem {
                if let Some(first_arg) = call.arguments.first() {
                    if let Some(Expression::StringLiteral(str_lit)) = first_arg.as_expression() {
                        return Some(str_lit.value.as_str().to_string());
                    }
                }
            }
        }
    }

    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str())
        .or(fallback_name)?;
    let search_str = "customElements.define(";
    let mut pos_offset = 0;
    while let Some(pos) = source[pos_offset..].find(search_str) {
        let abs_pos = pos_offset + pos;
        let after = &source[abs_pos + search_str.len()..];
        if let Some(comma_pos) = after.find(',') {
            let tag_part = after[..comma_pos].trim();
            let remaining = after[comma_pos + 1..].trim();
            if remaining.starts_with(class_name) {
                let clean_tag = tag_part.trim_matches(|c| c == '\'' || c == '"' || c == '`');
                return Some(clean_tag.to_string());
            }
        }
        pos_offset = abs_pos + search_str.len();
    }

    None
}
