use crate::ast_helpers::AstHelper;
use crate::import_scanner::ImportContext;
use crate::models::ClassificationResult;
use crate::template_parser::parse_html_template;
use oxc_allocator::{Allocator, ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_semantic::Scoping;
use std::collections::HashSet;

#[derive(Debug)]
pub struct PropertyInfo<'a> {
    pub name: String,
    pub prop_type: String, // "string", "number", "boolean"
    pub reflect: bool,
    pub attribute_name: String,
    pub default_value: Option<Expression<'a>>,
}

pub fn transform_vanilla_class<'a>(
    class: &mut Class<'a>,
    target: &ClassificationResult,
    ast: &AstBuilder<'a>,
    scoping: &Scoping,
    import_ctx: &ImportContext,
    out_pre_stmts: &mut Vec<Statement<'a>>,
    out_post_stmts: &mut Vec<Statement<'a>>,
) -> bool {
    let allocator = ast.allocator();
    let helper = AstHelper::new(ast);
    let comp_id = &target.component_name;

    let has_custom_element_decorator = class.decorators.iter().any(|dec| {
        let expr = match &dec.expression {
            Expression::CallExpression(call) => &call.callee,
            other => other,
        };
        import_ctx.is_custom_element_decorator(expr, scoping)
    });

    // 1. Analyze class elements: extract styles, template, and properties
    let mut styles_css: Option<String> = None;
    let mut template_quasis: Vec<String> = Vec::new();
    let mut template_exprs: Vec<Expression<'a>> = Vec::new();
    let mut properties: Vec<PropertyInfo<'a>> = Vec::new();
    let mut seen_props = HashSet::new();

    for elem in &class.body.body {
        match elem {
            ClassElement::PropertyDefinition(prop) => {
                let name = match &prop.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                    _ => None,
                };

                if let Some(prop_name) = name {
                    if prop.r#static && prop_name == "styles" {
                        if let Some(init) = &prop.value {
                            styles_css = extract_css_from_expr(init);
                        }
                        continue;
                    }

                    // Check for @property or @state decorators
                    for dec in &prop.decorators {
                        if let Expression::CallExpression(call) = &dec.expression {
                            if (import_ctx.is_property_decorator(&call.callee, scoping)
                                || import_ctx.is_state_decorator(&call.callee, scoping))
                                && seen_props.insert(prop_name.clone())
                            {
                                let mut p_type = "string".to_string();
                                let mut reflect = false;
                                let mut attr_name = prop_name.to_lowercase();

                                if let Some(arg) = call.arguments.first() {
                                    if let Some(Expression::ObjectExpression(obj)) =
                                        arg.as_expression()
                                    {
                                        for p in &obj.properties {
                                            if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                                                let k = match &prop_kv.key {
                                                    PropertyKey::StaticIdentifier(id) => {
                                                        Some(id.name.as_str())
                                                    }
                                                    _ => None,
                                                };
                                                if k == Some("type") {
                                                    if let Expression::Identifier(t_id) =
                                                        &prop_kv.value
                                                    {
                                                        let tn = t_id.name.as_str();
                                                        if tn == "Number" {
                                                            p_type = "number".to_string();
                                                        } else if tn == "Boolean" {
                                                            p_type = "boolean".to_string();
                                                        }
                                                    }
                                                }
                                                if k == Some("reflect") {
                                                    if let Expression::BooleanLiteral(b) =
                                                        &prop_kv.value
                                                    {
                                                        reflect = b.value;
                                                    }
                                                }
                                                if k == Some("attribute") {
                                                    if let Expression::StringLiteral(s) =
                                                        &prop_kv.value
                                                    {
                                                        attr_name = s.value.as_str().to_string();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                let default_val =
                                    prop.value.as_ref().map(|v| v.clone_in(allocator));

                                properties.push(PropertyInfo {
                                    name: prop_name.clone(),
                                    prop_type: p_type,
                                    reflect,
                                    attribute_name: attr_name,
                                    default_value: default_val,
                                });
                            }
                        }
                    }
                }
            }
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if m.r#static && name == "styles" {
                    if let Some(body) = &m.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(arg) = &ret.argument {
                                    styles_css = extract_css_from_expr(arg);
                                }
                            }
                        }
                    }
                } else if name == "render" {
                    if let Some(body) = &m.value.body {
                        extract_render_quasis_and_exprs(
                            body,
                            allocator,
                            scoping,
                            import_ctx,
                            &mut template_quasis,
                            &mut template_exprs,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    // 2. Parse HTML template with DOM path calculation
    let quasis_slices: Vec<&str> = template_quasis.iter().map(|s| s.as_str()).collect();
    if quasis_slices.is_empty() {
        return false;
    }
    let parsed_template = match parse_html_template(&quasis_slices, template_exprs.len()) {
        Some(p) => p,
        None => return false,
    };

    // 3. Synthesize hoisted module-level stylesheet and template constants
    let sheet_var = format!("__lit_sheet_{}", comp_id);
    let tmpl_var = format!("__lit_tmpl_{}", comp_id);

    let hoisted_stmts = crate::vanilla_ast::build_hoisted_statements(
        ast,
        allocator,
        styles_css.as_deref(),
        &parsed_template.html,
        &sheet_var,
        &tmpl_var,
    );
    for stmt in hoisted_stmts {
        out_pre_stmts.push(stmt);
    }

    // 4. Update class AST:
    // Set heritage to `HTMLElement`
    let html_elem_ident = helper.ident_ref("HTMLElement");
    class.heritage = Some(ClassHeritage {
        expression: html_elem_ident,
        type_arguments: None,
    });

    // Clear class decorators
    class.decorators.clear();

    // Retain only custom non-Lit methods (filter out @property, styles, render)
    let mut new_body_elements = ArenaVec::new_in(ast);

    // Push synthesized members: observedAttributes, constructor, accessors, attributeChangedCallback
    if let Some(obs_elem) =
        crate::vanilla_ast::build_observed_attributes_element(ast, allocator, &properties)
    {
        new_body_elements.push(obs_elem);
    }

    let ctor_elem = crate::vanilla_ast::build_constructor_element(
        ast,
        &sheet_var,
        &tmpl_var,
        styles_css.is_some(),
        &parsed_template,
        &template_exprs,
        &properties,
    );
    new_body_elements.push(ctor_elem);

    for p in &properties {
        let (getter, setter) = crate::vanilla_ast::build_property_accessors(
            ast,
            allocator,
            p,
            &parsed_template,
            &template_exprs,
        );
        new_body_elements.push(getter);
        new_body_elements.push(setter);
    }

    if let Some(acc_elem) =
        crate::vanilla_ast::build_attribute_changed_callback_element(ast, allocator, &properties)
    {
        new_body_elements.push(acc_elem);
    }

    // Then retain remaining methods from original class (e.g. event handler methods)
    for elem in class.body.body.drain(..) {
        match &elem {
            ClassElement::MethodDefinition(m) => {
                let m_name = m.key.static_name().unwrap_or_default();
                if m_name == "render"
                    || (m.r#static && m_name == "styles")
                    || m_name == "constructor"
                {
                    continue;
                }
                new_body_elements.push(elem);
            }
            ClassElement::PropertyDefinition(p) => {
                let p_name = match &p.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                if p.r#static && p_name == Some("styles") {
                    continue;
                }
                if let Some(pn) = p_name {
                    if seen_props.contains(pn) {
                        continue;
                    }
                }
                new_body_elements.push(elem);
            }
            _ => {
                new_body_elements.push(elem);
            }
        }
    }

    class.body.body = new_body_elements;

    // 6. Define custom element if tag_name is present and class had a decorator.
    // If the element was not defined via decorator, the input source code already contains
    // a customElements.define statement so do not emit a duplicate.
    if has_custom_element_decorator {
        if let Some(tag) = &target.tag_name {
            let define_stmt = helper
                .define_custom_element(allocator.alloc_str(tag), allocator.alloc_str(comp_id));
            out_post_stmts.push(define_stmt);
        }
    }

    true
}

fn extract_css_from_expr<'a>(expr: &Expression<'a>) -> Option<String> {
    match expr {
        Expression::TaggedTemplateExpression(tag) => {
            let css = tag
                .quasi
                .quasis
                .iter()
                .map(|q| q.value.raw.as_str())
                .collect::<Vec<_>>()
                .join("");
            Some(css)
        }
        Expression::ArrayExpression(arr) => {
            let mut parts = Vec::new();
            for el in &arr.elements {
                if let Some(e) = el.as_expression() {
                    if let Some(s) = extract_css_from_expr(e) {
                        parts.push(s);
                    }
                }
            }
            Some(parts.join("\n"))
        }
        _ => None,
    }
}

fn extract_render_quasis_and_exprs<'a>(
    body: &FunctionBody<'a>,
    allocator: &'a Allocator,
    scoping: &Scoping,
    import_ctx: &ImportContext,
    out_quasis: &mut Vec<String>,
    out_exprs: &mut Vec<Expression<'a>>,
) {
    for stmt in &body.statements {
        if let Statement::ReturnStatement(ret) = stmt {
            if let Some(Expression::TaggedTemplateExpression(tag)) = &ret.argument {
                if import_ctx.is_html_tag(&tag.tag, scoping) {
                    for q in &tag.quasi.quasis {
                        out_quasis.push(q.value.raw.as_str().to_string());
                    }
                    for e in &tag.quasi.expressions {
                        out_exprs.push(e.clone_in(allocator));
                    }
                    return;
                }
            }
        }
    }
}
