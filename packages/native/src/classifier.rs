use crate::import_scanner::{DirectiveKind, ImportContext};
use crate::models::{ClassificationResult, ClassifyOptions};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_semantic::{Scoping, SemanticBuilder};
use oxc_span::SourceType;
use std::collections::{HashMap, HashSet};

pub fn scan_define_calls<'a>(program: &Program<'a>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for stmt in &program.body {
        if let Some((tag, cls)) = get_ce_define_call(stmt) {
            map.insert(cls, tag);
        }
        if let Some((tag, cls)) = get_trailing_custom_element_call(stmt) {
            map.insert(cls, tag);
        }
    }
    map
}

pub fn get_trailing_custom_element_call<'a>(stmt: &Statement<'a>) -> Option<(String, String)> {
    match stmt {
        Statement::ExpressionStatement(expr_stmt) => {
            get_custom_element_from_decorator_expr(&expr_stmt.expression)
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &var_decl.declarations {
                if let Some(init) = &decl.init {
                    if let Some(res) = get_custom_element_from_decorator_expr(init) {
                        return Some(res);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn get_custom_element_from_decorator_expr<'a>(expr: &Expression<'a>) -> Option<(String, String)> {
    match expr {
        Expression::CallExpression(call) => {
            if is_decorator_callee(&call.callee) {
                let tag = extract_tag_from_decorator_array(call.arguments.first()?)?;
                let cls = extract_class_name_from_decorator_target(call.arguments.get(1)?)?;
                return Some((tag, cls));
            }
        }
        Expression::AssignmentExpression(assign) => {
            if let Expression::CallExpression(call) = &assign.right {
                if is_decorator_callee(&call.callee) {
                    let tag = extract_tag_from_decorator_array(call.arguments.first()?)?;
                    let cls = if let Some(arg1) = call.arguments.get(1) {
                        extract_class_name_from_decorator_target(arg1)
                    } else {
                        None
                    }
                    .or_else(|| extract_class_name_from_assign_target(&assign.left))?;
                    return Some((tag, cls));
                }
            }
        }
        _ => {}
    }
    None
}

fn extract_tag_from_decorator_array<'a>(arg: &Argument<'a>) -> Option<String> {
    if let Some(Expression::ArrayExpression(arr)) = arg.as_expression() {
        for el in &arr.elements {
            if let Some(Expression::CallExpression(call)) = el.as_expression() {
                let is_ce = match &call.callee {
                    Expression::Identifier(id) => id.name == "customElement",
                    Expression::StaticMemberExpression(mem) => mem.property.name == "customElement",
                    _ => false,
                };
                if is_ce {
                    if let Some(first_arg) = call.arguments.first() {
                        if let Some(Expression::StringLiteral(s)) = first_arg.as_expression() {
                            return Some(s.value.as_str().to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn scan_trailing_decorators<'a>(program: &Program<'a>) -> HashSet<String> {
    let mut set = HashSet::new();
    for stmt in &program.body {
        match stmt {
            Statement::ExpressionStatement(expr_stmt) => {
                check_trailing_decorator_expr(&expr_stmt.expression, &mut set);
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(init) = &decl.init {
                        check_trailing_decorator_expr(init, &mut set);
                    }
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::VariableDeclaration(var_decl) = &export_decl.declaration {
                    for decl in &var_decl.declarations {
                        if let Some(init) = &decl.init {
                            check_trailing_decorator_expr(init, &mut set);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    set
}

fn is_decorator_fn_name(name: &str) -> bool {
    matches!(
        name,
        "__decorate" | "_ts_decorate" | "decorate" | "_decorate"
    )
}

fn is_decorator_callee<'a>(expr: &Expression<'a>) -> bool {
    match expr {
        Expression::Identifier(id) => is_decorator_fn_name(id.name.as_str()),
        Expression::StaticMemberExpression(mem) => is_decorator_fn_name(mem.property.name.as_str()),
        _ => false,
    }
}

fn check_trailing_decorator_expr<'a>(expr: &Expression<'a>, set: &mut HashSet<String>) {
    match expr {
        Expression::CallExpression(call) => {
            if is_decorator_callee(&call.callee) {
                if let Some(arg1) = call.arguments.get(1) {
                    if let Some(cls) = extract_class_name_from_decorator_target(arg1) {
                        set.insert(cls);
                    }
                }
            }
        }
        Expression::AssignmentExpression(assign) => {
            if let Expression::CallExpression(call) = &assign.right {
                if is_decorator_callee(&call.callee) {
                    if let Some(cls) = extract_class_name_from_assign_target(&assign.left) {
                        set.insert(cls);
                    }
                    if let Some(arg1) = call.arguments.get(1) {
                        if let Some(cls) = extract_class_name_from_decorator_target(arg1) {
                            set.insert(cls);
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn extract_class_name_from_assign_target<'a>(target: &AssignmentTarget<'a>) -> Option<String> {
    if let Some(simple) = target.as_simple_assignment_target() {
        match simple {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => {
                Some(id.name.as_str().to_string())
            }
            SimpleAssignmentTarget::StaticMemberExpression(mem) => {
                if mem.property.name == "prototype" {
                    match &mem.object {
                        Expression::Identifier(id) => Some(id.name.as_str().to_string()),
                        _ => None,
                    }
                } else {
                    Some(mem.property.name.as_str().to_string())
                }
            }
            _ => None,
        }
    } else {
        None
    }
}

fn extract_class_name_from_decorator_target<'a>(arg: &Argument<'a>) -> Option<String> {
    let expr = arg.as_expression()?;
    match expr {
        Expression::Identifier(id) => Some(id.name.as_str().to_string()),
        Expression::StaticMemberExpression(mem) => {
            if mem.property.name == "prototype" {
                match &mem.object {
                    Expression::Identifier(id) => Some(id.name.as_str().to_string()),
                    Expression::StaticMemberExpression(inner) => {
                        Some(inner.property.name.as_str().to_string())
                    }
                    _ => None,
                }
            } else {
                Some(mem.property.name.as_str().to_string())
            }
        }
        _ => None,
    }
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
    let semantic_ret = SemanticBuilder::new().build(program);
    let scoping = semantic_ret.semantic.into_scoping();
    let import_ctx = ImportContext::scan(program, &scoping);
    let define_calls = scan_define_calls(program);
    let trailing_decorators = scan_trailing_decorators(program);
    let mut results = Vec::new();

    let forced_mode = options.mode.as_deref().unwrap_or("auto");

    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(res) = classify_class(
                    class,
                    forced_mode,
                    &define_calls,
                    &trailing_decorators,
                    &import_ctx,
                    &scoping,
                    None,
                ) {
                    results.push(res);
                }
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(res) = classify_class(
                        class,
                        forced_mode,
                        &define_calls,
                        &trailing_decorators,
                        &import_ctx,
                        &scoping,
                        None,
                    ) {
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
                            if let Some(res) = classify_class(
                                class,
                                forced_mode,
                                &define_calls,
                                &trailing_decorators,
                                &import_ctx,
                                &scoping,
                                name,
                            ) {
                                results.push(res);
                            }
                        }
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export_decl) => match &export_decl.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    if let Some(res) = classify_class(
                        class,
                        forced_mode,
                        &define_calls,
                        &trailing_decorators,
                        &import_ctx,
                        &scoping,
                        None,
                    ) {
                        results.push(res);
                    }
                }
                ExportDefaultDeclarationKind::ClassExpression(class) => {
                    if let Some(res) = classify_class(
                        class,
                        forced_mode,
                        &define_calls,
                        &trailing_decorators,
                        &import_ctx,
                        &scoping,
                        None,
                    ) {
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
                        if let Some(res) = classify_class(
                            class,
                            forced_mode,
                            &define_calls,
                            &trailing_decorators,
                            &import_ctx,
                            &scoping,
                            name,
                        ) {
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
    trailing_decorators: &HashSet<String>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
    fallback_name: Option<&str>,
) -> Option<ClassificationResult> {
    let component_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .or_else(|| fallback_name.map(|s| s.to_string()))
        .unwrap_or_else(|| "AnonymousComponent".to_string());

    let tag_name = extract_tag_name(class, define_calls, fallback_name, import_ctx, scoping);
    let has_render_method = class.body.body.iter().any(|elem| match elem {
        ClassElement::MethodDefinition(m) => {
            m.key.static_name().map(|n| n == "render").unwrap_or(false)
        }
        _ => false,
    });

    if !has_render_method {
        return None;
    }

    let extends_direct_lit = match &class.heritage {
        Some(h) => import_ctx.is_lit_element(&h.expression, scoping),
        None => false,
    };
    let has_lit_decorator = has_any_lit_decorator(class, import_ctx, scoping);

    // Inspect complexity of the class
    let mut has_structural_directive = false;
    let mut has_lowerable_directive = false;
    let mut has_unsupported_template_expr = false;
    let mut num_html_templates = 0;
    let mut num_reactive_props = 0;
    let mut template_quasis: Vec<String> = Vec::new();
    let mut template_exprs_count: usize = 0;

    for elem in &class.body.body {
        match elem {
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if let Some(body) = &m.value.body {
                    if name == "render" {
                        // Count templates and inspect directives
                        for stmt in &body.statements {
                            inspect_render_statement(
                                stmt,
                                import_ctx,
                                scoping,
                                &mut has_structural_directive,
                                &mut has_lowerable_directive,
                                &mut num_html_templates,
                                &mut has_unsupported_template_expr,
                            );
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(Expression::TaggedTemplateExpression(tag)) =
                                    &ret.argument
                                {
                                    if import_ctx.is_html_tag(&tag.tag, scoping) {
                                        for q in &tag.quasi.quasis {
                                            template_quasis.push(q.value.raw.as_str().to_string());
                                        }
                                        template_exprs_count = tag.quasi.expressions.len();
                                    }
                                }
                            }
                        }
                    } else {
                        // Inspect helper methods for html tagged templates
                        for stmt in &body.statements {
                            count_html_templates_in_statement(
                                stmt,
                                import_ctx,
                                scoping,
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
                                if import_ctx.is_property_decorator(&call.callee, scoping)
                                    || import_ctx.is_state_decorator(&call.callee, scoping)
                                {
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

    // Only components that extend a Lit base class, use Lit decorators,
    // or import Lit and render Lit HTML templates are candidates for Lit AOT compilation.
    // Non-Lit classes (such as React components, ORM models, or plain utility classes)
    // are never classified.
    let is_lit_component = extends_direct_lit
        || has_lit_decorator
        || (import_ctx.has_lit_imports && (num_html_templates > 0 || tag_name.is_some()));

    if !is_lit_component {
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

    let has_trailing_decorators = class
        .id
        .as_ref()
        .map(|id| trailing_decorators.contains(id.name.as_str()))
        .unwrap_or(false)
        || fallback_name
            .map(|name| trailing_decorators.contains(name))
            .unwrap_or(false)
        || trailing_decorators.contains(&component_name);

    let has_custom_constructor = has_non_trivial_constructor(class);
    let has_unsupported_decs = has_unsupported_decorators(class, import_ctx, scoping);
    let has_unsupported_prop_opts = has_unsupported_property_options(class, import_ctx, scoping);
    let has_lifecycle_or_runtime_refs = class_references_lit_lifecycle(class);

    let quasis_slices: Vec<&str> = template_quasis.iter().map(|s| s.as_str()).collect();
    let template_parseable = !quasis_slices.is_empty()
        && crate::template_parser::parse_html_template(&quasis_slices, template_exprs_count)
            .is_some();

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
    } else if tag_name.is_none() {
        (
            "micro",
            Some("Subclasses custom base element or internal base class".to_string()),
        )
    } else if has_trailing_decorators {
        (
            "micro",
            Some("Contains unhandled decorators or trailing decorator calls".to_string()),
        )
    } else if has_unsupported_decs {
        (
            "micro",
            Some("Contains unhandled decorators or query bindings".to_string()),
        )
    } else if has_unsupported_prop_opts {
        (
            "micro",
            Some("Reactive properties use unsupported options".to_string()),
        )
    } else if has_custom_constructor {
        (
            "micro",
            Some("Custom constructor initialization logic".to_string()),
        )
    } else if has_lifecycle_or_runtime_refs {
        (
            "micro",
            Some("Complex lifecycle or reactive runtime dependencies".to_string()),
        )
    } else if num_html_templates != 1 || !template_parseable {
        (
            "micro",
            Some("Complex lifecycle or multiple templates".to_string()),
        )
    } else if has_unsupported_template_expr {
        (
            "micro",
            Some("Template expressions contain method calls or unsupported structures".to_string()),
        )
    } else if num_reactive_props > 12 {
        ("micro", Some("Large property surface".to_string()))
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

fn count_html_templates_in_statement<'a>(
    stmt: &Statement<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
    num_templates: &mut usize,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                count_html_templates_in_expression(arg, import_ctx, scoping, num_templates);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            count_html_templates_in_expression(
                &expr_stmt.expression,
                import_ctx,
                scoping,
                num_templates,
            );
        }
        Statement::IfStatement(if_stmt) => {
            count_html_templates_in_expression(&if_stmt.test, import_ctx, scoping, num_templates);
            count_html_templates_in_statement(
                &if_stmt.consequent,
                import_ctx,
                scoping,
                num_templates,
            );
            if let Some(alt) = &if_stmt.alternate {
                count_html_templates_in_statement(alt, import_ctx, scoping, num_templates);
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                count_html_templates_in_statement(s, import_ctx, scoping, num_templates);
            }
        }
        _ => {}
    }
}

fn count_html_templates_in_expression<'a>(
    expr: &Expression<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
    num_templates: &mut usize,
) {
    match expr {
        Expression::TaggedTemplateExpression(tag) => {
            if import_ctx.is_html_tag(&tag.tag, scoping) {
                *num_templates += 1;
            }
            for e in &tag.quasi.expressions {
                count_html_templates_in_expression(e, import_ctx, scoping, num_templates);
            }
        }
        Expression::CallExpression(call) => {
            count_html_templates_in_expression(&call.callee, import_ctx, scoping, num_templates);
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    count_html_templates_in_expression(e, import_ctx, scoping, num_templates);
                }
            }
        }
        Expression::ConditionalExpression(cond) => {
            count_html_templates_in_expression(&cond.test, import_ctx, scoping, num_templates);
            count_html_templates_in_expression(
                &cond.consequent,
                import_ctx,
                scoping,
                num_templates,
            );
            count_html_templates_in_expression(&cond.alternate, import_ctx, scoping, num_templates);
        }
        Expression::LogicalExpression(log) => {
            count_html_templates_in_expression(&log.left, import_ctx, scoping, num_templates);
            count_html_templates_in_expression(&log.right, import_ctx, scoping, num_templates);
        }
        Expression::BinaryExpression(bin) => {
            count_html_templates_in_expression(&bin.left, import_ctx, scoping, num_templates);
            count_html_templates_in_expression(&bin.right, import_ctx, scoping, num_templates);
        }
        Expression::ParenthesizedExpression(p) => {
            count_html_templates_in_expression(&p.expression, import_ctx, scoping, num_templates);
        }
        Expression::ArrayExpression(arr) => {
            for el in &arr.elements {
                if let Some(e) = el.as_expression() {
                    count_html_templates_in_expression(e, import_ctx, scoping, num_templates);
                }
            }
        }
        _ => {}
    }
}

fn inspect_render_statement<'a>(
    stmt: &Statement<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
    has_structural: &mut bool,
    has_lowerable: &mut bool,
    num_templates: &mut usize,
    has_unsupported_expr: &mut bool,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(arg) = &ret.argument {
                inspect_render_expression(
                    arg,
                    import_ctx,
                    scoping,
                    has_structural,
                    has_lowerable,
                    num_templates,
                    has_unsupported_expr,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            inspect_render_expression(
                &expr_stmt.expression,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
        }
        Statement::IfStatement(if_stmt) => {
            inspect_render_expression(
                &if_stmt.test,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            inspect_render_statement(
                &if_stmt.consequent,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            if let Some(alt) = &if_stmt.alternate {
                inspect_render_statement(
                    alt,
                    import_ctx,
                    scoping,
                    has_structural,
                    has_lowerable,
                    num_templates,
                    has_unsupported_expr,
                );
            }
        }
        Statement::BlockStatement(block) => {
            for s in &block.body {
                inspect_render_statement(
                    s,
                    import_ctx,
                    scoping,
                    has_structural,
                    has_lowerable,
                    num_templates,
                    has_unsupported_expr,
                );
            }
        }
        _ => {}
    }
}

fn inspect_render_expression<'a>(
    expr: &Expression<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
    has_structural: &mut bool,
    has_lowerable: &mut bool,
    num_templates: &mut usize,
    has_unsupported_expr: &mut bool,
) {
    match expr {
        Expression::TaggedTemplateExpression(tag) => {
            if import_ctx.is_html_tag(&tag.tag, scoping) {
                *num_templates += 1;
            }
            for e in &tag.quasi.expressions {
                inspect_render_expression(
                    e,
                    import_ctx,
                    scoping,
                    has_structural,
                    has_lowerable,
                    num_templates,
                    has_unsupported_expr,
                );
            }
        }
        Expression::CallExpression(call) => {
            if let Some(directive) = import_ctx.get_directive_kind_by_expr(&call.callee, scoping) {
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
            } else {
                *has_unsupported_expr = true;
            }
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    inspect_render_expression(
                        e,
                        import_ctx,
                        scoping,
                        has_structural,
                        has_lowerable,
                        num_templates,
                        has_unsupported_expr,
                    );
                }
            }
        }
        Expression::ConditionalExpression(cond) => {
            inspect_render_expression(
                &cond.test,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            inspect_render_expression(
                &cond.consequent,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            inspect_render_expression(
                &cond.alternate,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
        }
        Expression::LogicalExpression(log) => {
            inspect_render_expression(
                &log.left,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            inspect_render_expression(
                &log.right,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
        }
        Expression::BinaryExpression(bin) => {
            inspect_render_expression(
                &bin.left,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
            inspect_render_expression(
                &bin.right,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
        }
        Expression::ParenthesizedExpression(p) => {
            inspect_render_expression(
                &p.expression,
                import_ctx,
                scoping,
                has_structural,
                has_lowerable,
                num_templates,
                has_unsupported_expr,
            );
        }
        Expression::ArrayExpression(arr) => {
            for el in &arr.elements {
                if let Some(e) = el.as_expression() {
                    inspect_render_expression(
                        e,
                        import_ctx,
                        scoping,
                        has_structural,
                        has_lowerable,
                        num_templates,
                        has_unsupported_expr,
                    );
                }
            }
        }
        Expression::SequenceExpression(seq) => {
            for e in &seq.expressions {
                inspect_render_expression(
                    e,
                    import_ctx,
                    scoping,
                    has_structural,
                    has_lowerable,
                    num_templates,
                    has_unsupported_expr,
                );
            }
        }
        _ => {}
    }
}

fn extract_tag_name<'a>(
    class: &Class<'a>,
    define_calls: &HashMap<String, String>,
    fallback_name: Option<&str>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
) -> Option<String> {
    for dec in &class.decorators {
        if let Expression::CallExpression(call) = &dec.expression {
            if import_ctx.is_custom_element_decorator(&call.callee, scoping) {
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

fn is_decorator_lit<'a>(
    expr: &Expression<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
) -> bool {
    let callee = match expr {
        Expression::CallExpression(call) => &call.callee,
        other => other,
    };
    import_ctx.is_custom_element_decorator(callee, scoping)
        || import_ctx.is_property_decorator(callee, scoping)
        || import_ctx.is_state_decorator(callee, scoping)
        || import_ctx.is_other_lit_decorator(callee, scoping)
}

fn has_any_lit_decorator<'a>(
    class: &Class<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
) -> bool {
    for dec in &class.decorators {
        if is_decorator_lit(&dec.expression, import_ctx, scoping) {
            return true;
        }
    }

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop) => {
                for dec in &prop.decorators {
                    if is_decorator_lit(&dec.expression, import_ctx, scoping) {
                        return true;
                    }
                }
            }
            ClassElement::AccessorProperty(acc) => {
                for dec in &acc.decorators {
                    if is_decorator_lit(&dec.expression, import_ctx, scoping) {
                        return true;
                    }
                }
            }
            ClassElement::MethodDefinition(meth) => {
                for dec in &meth.decorators {
                    if is_decorator_lit(&dec.expression, import_ctx, scoping) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }

    false
}

fn has_non_trivial_constructor<'a>(class: &Class<'a>) -> bool {
    for elem in &class.body.body {
        if let ClassElement::MethodDefinition(m) = elem {
            if m.kind == MethodDefinitionKind::Constructor {
                if let Some(body) = &m.value.body {
                    if body.statements.is_empty() {
                        return false;
                    }
                    if body.statements.len() == 1 {
                        if let Statement::ExpressionStatement(expr_stmt) = &body.statements[0] {
                            if let Expression::CallExpression(call) = &expr_stmt.expression {
                                if matches!(&call.callee, Expression::Super(_)) {
                                    return false;
                                }
                            }
                        }
                    }
                    return true;
                }
            }
        }
    }
    false
}

fn has_unsupported_decorators<'a>(
    class: &Class<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
) -> bool {
    for dec in &class.decorators {
        let callee = match &dec.expression {
            Expression::CallExpression(call) => &call.callee,
            other => other,
        };
        if !import_ctx.is_custom_element_decorator(callee, scoping) {
            return true;
        }
    }

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop) => {
                for dec in &prop.decorators {
                    let callee = match &dec.expression {
                        Expression::CallExpression(call) => &call.callee,
                        other => other,
                    };
                    let is_prop = import_ctx.is_property_decorator(callee, scoping);
                    let is_state = import_ctx.is_state_decorator(callee, scoping);
                    if !is_prop && !is_state {
                        return true;
                    }
                }
            }
            ClassElement::AccessorProperty(acc) => {
                for dec in &acc.decorators {
                    let callee = match &dec.expression {
                        Expression::CallExpression(call) => &call.callee,
                        other => other,
                    };
                    let is_prop = import_ctx.is_property_decorator(callee, scoping);
                    let is_state = import_ctx.is_state_decorator(callee, scoping);
                    if !is_prop && !is_state {
                        return true;
                    }
                }
            }
            ClassElement::MethodDefinition(meth) if !meth.decorators.is_empty() => {
                return true;
            }
            _ => {}
        }
    }

    false
}

fn has_unsupported_property_options<'a>(
    class: &Class<'a>,
    import_ctx: &ImportContext,
    scoping: &Scoping,
) -> bool {
    for elem in &class.body.body {
        if let ClassElement::PropertyDefinition(prop) = elem {
            for dec in &prop.decorators {
                if let Expression::CallExpression(call) = &dec.expression {
                    if import_ctx.is_property_decorator(&call.callee, scoping) {
                        if let Some(first_arg) = call.arguments.first() {
                            if let Some(Expression::ObjectExpression(obj)) =
                                first_arg.as_expression()
                            {
                                for prop_kind in &obj.properties {
                                    match prop_kind {
                                        ObjectPropertyKind::ObjectProperty(kv) => {
                                            let key_name = match &kv.key {
                                                PropertyKey::StaticIdentifier(id) => {
                                                    Some(id.name.as_str())
                                                }
                                                PropertyKey::StringLiteral(lit) => {
                                                    Some(lit.value.as_str())
                                                }
                                                _ => None,
                                            };
                                            match key_name {
                                                Some("type") => {
                                                    let is_valid_type = match &kv.value {
                                                        Expression::Identifier(id) => matches!(
                                                            id.name.as_str(),
                                                            "String" | "Number" | "Boolean"
                                                        ),
                                                        _ => false,
                                                    };
                                                    if !is_valid_type {
                                                        return true;
                                                    }
                                                }
                                                Some("reflect") => {
                                                    if !matches!(
                                                        &kv.value,
                                                        Expression::BooleanLiteral(_)
                                                    ) {
                                                        return true;
                                                    }
                                                }
                                                Some("attribute") => {
                                                    let is_valid_attr = matches!(
                                                        &kv.value,
                                                        Expression::StringLiteral(_)
                                                            | Expression::BooleanLiteral(_)
                                                    );
                                                    if !is_valid_attr {
                                                        return true;
                                                    }
                                                }
                                                Some("state") => {}
                                                _ => return true,
                                            }
                                        }
                                        _ => return true,
                                    }
                                }
                            } else {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

fn class_references_lit_lifecycle<'a>(class: &Class<'a>) -> bool {
    for elem in &class.body.body {
        if let ClassElement::MethodDefinition(m) = elem {
            if let Some(name) = m.key.static_name() {
                if matches!(
                    name.as_ref(),
                    "update"
                        | "shouldUpdate"
                        | "willUpdate"
                        | "updated"
                        | "firstUpdated"
                        | "connectedCallback"
                        | "disconnectedCallback"
                        | "attributeChangedCallback"
                        | "createRenderRoot"
                ) {
                    return true;
                }
            }
        }
    }

    for elem in &class.body.body {
        match elem {
            ClassElement::MethodDefinition(m) => {
                if let Some(body) = &m.value.body {
                    for stmt in &body.statements {
                        if stmt_references_lit_runtime(stmt) {
                            return true;
                        }
                    }
                }
            }
            ClassElement::PropertyDefinition(prop) => {
                if let Some(val) = &prop.value {
                    if expr_references_lit_runtime(val) {
                        return true;
                    }
                }
            }
            _ => {}
        }
    }

    false
}

fn is_lit_reactive_member_name(name: &str) -> bool {
    matches!(
        name,
        "updateComplete"
            | "requestUpdate"
            | "addController"
            | "removeController"
            | "renderRoot"
            | "createRenderRoot"
            | "hasUpdated"
            | "isUpdatePending"
    )
}

fn expr_references_lit_runtime<'a>(expr: &Expression<'a>) -> bool {
    match expr {
        Expression::StaticMemberExpression(mem) => {
            if matches!(&mem.object, Expression::ThisExpression(_))
                && is_lit_reactive_member_name(mem.property.name.as_str())
            {
                return true;
            }
            expr_references_lit_runtime(&mem.object)
        }
        Expression::ComputedMemberExpression(mem) => {
            if matches!(&mem.object, Expression::ThisExpression(_)) {
                if let Expression::StringLiteral(s) = &mem.expression {
                    if is_lit_reactive_member_name(s.value.as_str()) {
                        return true;
                    }
                }
            }
            expr_references_lit_runtime(&mem.object) || expr_references_lit_runtime(&mem.expression)
        }
        Expression::CallExpression(call) => {
            if expr_references_lit_runtime(&call.callee) {
                return true;
            }
            for arg in &call.arguments {
                if let Some(e) = arg.as_expression() {
                    if expr_references_lit_runtime(e) {
                        return true;
                    }
                }
            }
            false
        }
        Expression::BinaryExpression(bin) => {
            expr_references_lit_runtime(&bin.left) || expr_references_lit_runtime(&bin.right)
        }
        Expression::LogicalExpression(log) => {
            expr_references_lit_runtime(&log.left) || expr_references_lit_runtime(&log.right)
        }
        Expression::UnaryExpression(un) => expr_references_lit_runtime(&un.argument),
        Expression::AwaitExpression(aw) => expr_references_lit_runtime(&aw.argument),
        Expression::ParenthesizedExpression(p) => expr_references_lit_runtime(&p.expression),
        Expression::ConditionalExpression(cond) => {
            expr_references_lit_runtime(&cond.test)
                || expr_references_lit_runtime(&cond.consequent)
                || expr_references_lit_runtime(&cond.alternate)
        }
        Expression::AssignmentExpression(assign) => expr_references_lit_runtime(&assign.right),
        Expression::SequenceExpression(seq) => {
            seq.expressions.iter().any(expr_references_lit_runtime)
        }
        Expression::ArrayExpression(arr) => arr
            .elements
            .iter()
            .any(|el| el.as_expression().is_some_and(expr_references_lit_runtime)),
        Expression::ArrowFunctionExpression(arrow) => match &arrow.body {
            ArrowFunctionBody::FunctionBody(b) => {
                b.statements.iter().any(stmt_references_lit_runtime)
            }
            _ => {
                if let Some(e) = arrow.body.as_expression() {
                    expr_references_lit_runtime(e)
                } else {
                    false
                }
            }
        },
        Expression::FunctionExpression(func) => func
            .body
            .as_ref()
            .is_some_and(|b| b.statements.iter().any(stmt_references_lit_runtime)),
        _ => false,
    }
}

fn stmt_references_lit_runtime<'a>(stmt: &Statement<'a>) -> bool {
    match stmt {
        Statement::ExpressionStatement(e) => expr_references_lit_runtime(&e.expression),
        Statement::ReturnStatement(r) => {
            r.argument.as_ref().is_some_and(expr_references_lit_runtime)
        }
        Statement::IfStatement(i) => {
            expr_references_lit_runtime(&i.test)
                || stmt_references_lit_runtime(&i.consequent)
                || i.alternate
                    .as_ref()
                    .is_some_and(stmt_references_lit_runtime)
        }
        Statement::BlockStatement(b) => b.body.iter().any(stmt_references_lit_runtime),
        Statement::VariableDeclaration(v) => v
            .declarations
            .iter()
            .any(|d| d.init.as_ref().is_some_and(expr_references_lit_runtime)),
        Statement::ForStatement(f) => {
            f.test.as_ref().is_some_and(expr_references_lit_runtime)
                || stmt_references_lit_runtime(&f.body)
        }
        Statement::ForInStatement(f) => {
            expr_references_lit_runtime(&f.right) || stmt_references_lit_runtime(&f.body)
        }
        Statement::ForOfStatement(f) => {
            expr_references_lit_runtime(&f.right) || stmt_references_lit_runtime(&f.body)
        }
        Statement::WhileStatement(w) => {
            expr_references_lit_runtime(&w.test) || stmt_references_lit_runtime(&w.body)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aliased_semantic_classification() {
        let code = r#"
            import { LitElement as MyElement, html as litHtml } from 'lit';
            import { customElement as ce, property as prop } from 'lit/decorators.js';

            @ce('custom-button')
            export class CustomButton extends MyElement {
                @prop({ type: String }) label = 'ok';
                render() {
                    return litHtml`<button>${this.label}</button>`;
                }
            }
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].mode, "vanilla");
        assert_eq!(results[0].component_name, "CustomButton");
        assert_eq!(results[0].tag_name.as_deref(), Some("custom-button"));
    }

    #[test]
    fn test_non_lit_class_with_same_name_skipped() {
        let code = r#"
            import { LitElement } from 'not-lit';

            export class FakeButton extends LitElement {
                render() {
                    return `<button>fake</button>`;
                }
            }
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        // Since it does not extend canonical LitElement and has no Lit decorators, it is skipped
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_trailing_decorator_call_prevents_vanilla() {
        let code = r#"
            import { LitElement, html } from 'lit';
            import { property } from 'lit/decorators.js';

            export class DecoratedTabs extends LitElement {
                render() {
                    return html`<div>tabs</div>`;
                }
            }
            customElements.define('decorated-tabs', DecoratedTabs);
            __decorate([property({ type: Number })], DecoratedTabs.prototype, "activeTab", void 0);
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].mode, "micro");
        assert_eq!(results[0].component_name, "DecoratedTabs");
        assert!(results[0]
            .reason
            .as_deref()
            .unwrap()
            .contains("trailing decorator"));
    }

    #[test]
    fn test_update_complete_prevents_vanilla() {
        let code = r#"
            import { LitElement, html } from 'lit';

            export class LifecycleButton extends LitElement {
                async scrollTo() {
                    await this.updateComplete;
                }
                render() {
                    return html`<button>click</button>`;
                }
            }
            customElements.define('lifecycle-btn', LifecycleButton);
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].mode, "micro");
        assert_eq!(results[0].component_name, "LifecycleButton");
        assert!(results[0].reason.as_deref().unwrap().contains("lifecycle"));
    }

    #[test]
    fn test_custom_constructor_prevents_vanilla() {
        let code = r#"
            import { LitElement, html } from 'lit';

            export class ConstructorButton extends LitElement {
                constructor() {
                    super();
                    this.attachInternals();
                }
                render() {
                    return html`<button>click</button>`;
                }
            }
            customElements.define('ctor-btn', ConstructorButton);
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].mode, "micro");
        assert_eq!(results[0].component_name, "ConstructorButton");
        assert!(results[0]
            .reason
            .as_deref()
            .unwrap()
            .contains("constructor"));
    }

    #[test]
    fn test_untagged_base_class_prevents_vanilla() {
        let code = r#"
            import { LitElement, html } from 'lit';

            export class UntaggedBase extends LitElement {
                render() {
                    return html`<div>base</div>`;
                }
            }
        "#;
        let results = classify_code(code, ClassifyOptions::default());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].mode, "micro");
        assert_eq!(results[0].component_name, "UntaggedBase");
        assert!(results[0].reason.as_deref().unwrap().contains("base class"));
    }
}
