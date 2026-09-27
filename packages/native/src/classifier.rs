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
    let mut results = Vec::new();

    let forced_mode = options.mode.as_deref().unwrap_or("auto");

    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                if let Some(res) = classify_class(class, forced_mode, source, None) {
                    results.push(res);
                }
            }
            Statement::ExportDeclaration(export_decl) => match &export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    if let Some(res) = classify_class(class, forced_mode, source, None) {
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
                            if let Some(res) = classify_class(class, forced_mode, source, name) {
                                results.push(res);
                            }
                        }
                    }
                }
                _ => {}
            },
            Statement::ExportDefaultDeclaration(export_decl) => match &export_decl.declaration {
                ExportDefaultDeclarationKind::ClassDeclaration(class) => {
                    if let Some(res) = classify_class(class, forced_mode, source, None) {
                        results.push(res);
                    }
                }
                ExportDefaultDeclarationKind::ClassExpression(class) => {
                    if let Some(res) = classify_class(class, forced_mode, source, None) {
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
                        if let Some(res) = classify_class(class, forced_mode, source, name) {
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

fn classify_class<'a>(
    class: &Class<'a>,
    forced_mode: &str,
    source: &str,
    fallback_name: Option<&str>,
) -> Option<ClassificationResult> {
    let component_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str().to_string())
        .or_else(|| fallback_name.map(|s| s.to_string()))
        .unwrap_or_else(|| "AnonymousComponent".to_string());

    // Check if class extends LitElement, ReactiveElement, or has @customElement decorator
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

    // Inspect complexity of the class for Mode A vs Mode B
    let mut is_complex = false;
    let mut reason: Option<String> = None;

    // Check for complex directives and dynamic loops in render()
    for elem in &class.body.body {
        match elem {
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if name == "shouldUpdate" || name == "willUpdate" {
                    is_complex = true;
                    reason = Some(format!("Overrides {}", name));
                    break;
                }

                if name == "render" {
                    if let Some(body) = &m.value.body {
                        let span = body.span;
                        let start = span.start as usize;
                        let end = (span.end as usize).min(source.len());
                        if start < end {
                            let render_slice = &source[start..end];
                            if render_slice.contains("repeat(") {
                                is_complex = true;
                                reason = Some("Uses repeat() directive".to_string());
                                break;
                            }
                            if render_slice.contains("until(") {
                                is_complex = true;
                                reason = Some("Uses until() directive".to_string());
                                break;
                            }
                            if render_slice.contains("cache(") {
                                is_complex = true;
                                reason = Some("Uses cache() directive".to_string());
                                break;
                            }
                            if render_slice.contains("live(") {
                                is_complex = true;
                                reason = Some("Uses live() directive".to_string());
                                break;
                            }
                            if render_slice.contains(".map(") && render_slice.contains("html`") {
                                is_complex = true;
                                reason = Some("Dynamic sub-template loop in render".to_string());
                                break;
                            }
                            if render_slice.matches("html`").count() > 1 {
                                is_complex = true;
                                reason = Some("Multiple html template literals in render".to_string());
                                break;
                            }
                            if render_slice.contains("this.render") {
                                is_complex = true;
                                reason = Some("Invokes helper render methods".to_string());
                                break;
                            }
                            if render_slice.contains("classMap(")
                                || render_slice.contains("styleMap(")
                                || render_slice.contains("ifDefined(")
                                || render_slice.contains("guard(")
                            {
                                is_complex = true;
                                reason = Some("Uses Lit dynamic template directives".to_string());
                                break;
                            }
                            if render_slice.contains('?')
                                && render_slice.contains(':')
                                && render_slice.contains("html`")
                            {
                                is_complex = true;
                                reason = Some("Conditional dynamic template branches".to_string());
                                break;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let mode = if is_complex { "micro" } else { "vanilla" };

    Some(ClassificationResult {
        mode: mode.to_string(),
        component_name,
        tag_name,
        reason,
    })
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

    // Check if customElements.define is used in the module
    let class_name = class
        .id
        .as_ref()
        .map(|id| id.name.as_str())
        .or(fallback_name)?;
    let search_str = format!("customElements.define(");
    if let Some(pos) = source.find(&search_str) {
        let after = &source[pos + search_str.len()..];
        if let Some(comma_pos) = after.find(',') {
            let tag_part = after[..comma_pos].trim();
            let remaining = after[comma_pos + 1..].trim();
            if remaining.starts_with(class_name) {
                let clean_tag = tag_part.trim_matches(|c| c == '\'' || c == '"' || c == '`');
                return Some(clean_tag.to_string());
            }
        }
    }

    None
}
