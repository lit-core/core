use crate::import_scanner::{DirectiveKind, ImportContext};
use crate::models::{ClassificationResult, ClassifyOptions};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::SourceType;
use std::collections::HashMap;

pub fn scan_define_calls<'a>(program: &Program<'a>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for stmt in &program.body {
        if let Some((tag, cls)) = get_ce_define_call(stmt) {
            map.insert(cls, tag);
        }
    }
    map
}

pub fn get_ce_define_call<'a>(stmt: &Statement<'a>) -> Option<(String, String)> {
    if let Statement::ExpressionStatement(expr_stmt) = stmt {
        if let Expression::CallExpression(call) = &expr_stmt.expression {
            let is_ce_define = match &call.callee {
                Expression::StaticMemberExpression(mem) => {
                    mem.property.name == "define"
                        && match &mem.object {
                            Expression::Identifier(id) => id.name == "customElements",
                            Expression::StaticMemberExpression(inner) => {
                                inner.property.name == "customElements"
                            }
                            _ => false,
                        }
                }
                _ => false,
            };
            if is_ce_define && call.arguments.len() >= 2 {
                let tag_str = match call.arguments[0].as_expression() {
                    Some(Expression::StringLiteral(s)) => Some(s.value.as_str().to_string()),
                    Some(Expression::TemplateLiteral(t))
                        if t.expressions.is_empty() && !t.quasis.is_empty() =>
                    {
                        Some(t.quasis[0].value.raw.as_str().to_string())
                    }
                    _ => None,
                };
                let class_str = match call.arguments[1].as_expression() {
                    Some(Expression::Identifier(id)) => Some(id.name.as_str().to_string()),
                    _ => None,
                };
                if let (Some(tag), Some(cls)) = (tag_str, class_str) {
                    return Some((tag, cls));
                }
            }
        }
    }
    None
}

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
    let define_calls = scan_define_calls(program);
    let mut results = Vec::new();

    let forced_mode = options.mode.as_deref().unwrap_or("auto");

    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(res) =
                    classify_class(class, forced_mode, &define_calls, &import_ctx, None)
                {
                    results.push(res);
                }
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(res) =
                        classify_class(class, forced_mode, &define_calls, &import_ctx, None)
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
                                classify_class(class, forced_mode, &define_calls, &import_ctx, name)
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
                        classify_class(class, forced_mode, &define_calls, &import_ctx, None)
                    {
                        results.push(res);
                    }
                }
                ExportDefaultDeclarationKind::ClassExpression(class) => {
                    if let Some(res) =
                        classify_class(class, forced_mode, &define_calls, &import_ctx, None)
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
                            classify_class(class, forced_mode, &define_calls, &import_ctx, name)
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
    define_calls: &HashMap<String, String>,
    import_ctx: &ImportContext,
    fallback_name: Option<&str>,
) -> Option<ClassificationResult> {
    let component_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .or_else(|| fallback_name.map(|s| s.to_string()))
        .unwrap_or_else(|| "AnonymousComponent".to_string());

    let tag_name = extract_tag_name(class, define_calls, fallback_name);
    let has_render_method = class.body.body.iter().any(|elem| match elem {
        ClassElement::MethodDefinition(m) => {
            m.key.static_name().map(|n| n == "render").unwrap_or(false)
        }
        _ => false,
    });

    // Only components that define a render() method are candidates for AOT compilation.
    // Classes without a render() method (e.g. abstract base classes, controller hosts, or mixins)
    // are skipped so their capability inheritance remains intact.
    if !has_render_method {
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
                    || name == "connectedCallback"
                    || name == "disconnectedCallback"
                    || name == "attributeChangedCallback"
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

    let extends_direct_lit = match &class.heritage {
        Some(h) => match &h.expression {
            Expression::Identifier(id) => {
                id.name == "LitElement"
                    || id.name == "ReactiveElement"
                    || import_ctx.lit_bindings.contains(id.name.as_str())
            }
            Expression::StaticMemberExpression(mem) => {
                mem.property.name == "LitElement" || mem.property.name == "ReactiveElement"
            }
            _ => false,
        },
        None => false,
    };

    // Classification decision:
    // 1. If not directly extending LitElement (e.g. custom base element) -> Mode B micro
    // 2. If has structural directives (repeat, cache, until, live) -> Mode B micro/skip
    // 3. If has lowerable directives (classMap, styleMap, ifDefined, guard) OR complex lifecycle -> Mode B
    // 4. If genuine leaf (direct LitElement, no directives, <= 12 props, single template, no lifecycle overrides) -> Mode A vanilla
    let (mode, reason) = if !extends_direct_lit {
        ("micro", Some("Subclasses custom base element".to_string()))
    } else if has_structural_directive {
        (
            "micro",
            Some("Contains structural Lit directives".to_string()),
        )
    } else if has_lowerable_directive {
        (
            "micro",
            Some("Contains lowerable Lit directives".to_string()),
        )
    } else if has_lifecycle_override || num_html_templates > 1 || num_reactive_props > 12 {
        (
            "micro",
            Some("Complex lifecycle or multiple templates".to_string()),
        )
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
                inspect_render_expression(
                    arg,
                    import_ctx,
                    has_structural,
                    has_lowerable,
                    num_templates,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            inspect_render_expression(
                &expr_stmt.expression,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
        }
        Statement::IfStatement(if_stmt) => {
            inspect_render_expression(
                &if_stmt.test,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
            inspect_render_statement(
                &if_stmt.consequent,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
            if let Some(alt) = &if_stmt.alternate {
                inspect_render_statement(
                    alt,
                    import_ctx,
                    has_structural,
                    has_lowerable,
                    num_templates,
                );
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                inspect_render_statement(
                    s,
                    import_ctx,
                    has_structural,
                    has_lowerable,
                    num_templates,
                );
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
                inspect_render_expression(
                    e,
                    import_ctx,
                    has_structural,
                    has_lowerable,
                    num_templates,
                );
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
                    inspect_render_expression(
                        e,
                        import_ctx,
                        has_structural,
                        has_lowerable,
                        num_templates,
                    );
                }
            }
        }
        Expression::ConditionalExpression(cond) => {
            inspect_render_expression(
                &cond.test,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
            inspect_render_expression(
                &cond.consequent,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
            inspect_render_expression(
                &cond.alternate,
                import_ctx,
                has_structural,
                has_lowerable,
                num_templates,
            );
        }
        _ => {}
    }
}

fn extract_tag_name<'a>(
    class: &Class<'a>,
    define_calls: &HashMap<String, String>,
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

    define_calls.get(class_name).cloned()
}
