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
    let mut instance_defaults: std::collections::HashMap<String, Expression<'a>> =
        std::collections::HashMap::new();

    for elem in &class.body.body {
        if let ClassElement::PropertyDefinition(prop) = elem
            && !prop.r#static
        {
            let name = match &prop.key {
                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                _ => None,
            };
            if let (Some(prop_name), Some(val)) = (name, &prop.value) {
                instance_defaults.insert(prop_name, val.clone_in(allocator));
            }
        }
    }

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

                    if prop.r#static && prop_name == "properties" {
                        if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                            extract_static_properties_obj(
                                obj,
                                allocator,
                                &instance_defaults,
                                &mut seen_props,
                                &mut properties,
                            );
                        }
                        continue;
                    }

                    // Check for @property or @state decorators
                    for dec in &prop.decorators {
                        if let Expression::CallExpression(call) = &dec.expression
                            && (import_ctx.is_property_decorator(&call.callee, scoping)
                                || import_ctx.is_state_decorator(&call.callee, scoping))
                            && seen_props.insert(prop_name.clone())
                        {
                            let is_state = import_ctx.is_state_decorator(&call.callee, scoping);
                            let opts_obj = call.arguments.first().and_then(|arg| {
                                if let Some(Expression::ObjectExpression(obj)) = arg.as_expression()
                                {
                                    Some(obj.as_ref())
                                } else {
                                    None
                                }
                            });
                            let (p_type, reflect, attr_name) =
                                parse_property_options_obj(opts_obj, &prop_name, is_state);

                            let default_val = prop.value.as_ref().map(|v| v.clone_in(allocator));

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
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if m.r#static && name == "styles" {
                    if let Some(body) = &m.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt
                                && let Some(arg) = &ret.argument
                            {
                                styles_css = extract_css_from_expr(arg);
                            }
                        }
                    }
                } else if m.r#static && name == "properties" {
                    if let Some(body) = &m.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt
                                && let Some(Expression::ObjectExpression(obj)) = &ret.argument
                            {
                                extract_static_properties_obj(
                                    obj,
                                    allocator,
                                    &instance_defaults,
                                    &mut seen_props,
                                    &mut properties,
                                );
                            }
                        }
                    }
                } else if name == "render"
                    && let Some(body) = &m.value.body
                {
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

    let mut multi_prop_bindings = HashSet::new();
    for (idx, b) in parsed_template.bindings.iter().enumerate() {
        if let Some(binding_expr) = template_exprs.get(b.expression_index) {
            let ref_count = properties
                .iter()
                .filter(|p| crate::vanilla_ast::expr_references_property(binding_expr, &p.name))
                .count();
            if ref_count > 1 {
                multi_prop_bindings.insert(idx);
            }
        }
    }

    for p in &properties {
        let (getter, setter) = crate::vanilla_ast::build_property_accessors(
            ast,
            allocator,
            p,
            &parsed_template,
            &template_exprs,
            &multi_prop_bindings,
        );
        new_body_elements.push(getter);
        new_body_elements.push(setter);
    }

    for (idx, b) in parsed_template.bindings.iter().enumerate() {
        if multi_prop_bindings.contains(&idx)
            && let Some(binding_expr) = template_exprs.get(b.expression_index)
            && let Some(u_method) = crate::vanilla_ast::build_shared_binding_update_method(
                ast,
                allocator,
                idx,
                b,
                binding_expr,
            )
        {
            new_body_elements.push(u_method);
        }
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
                    || (m.r#static && (m_name == "styles" || m_name == "properties"))
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
                if p.r#static && (p_name == Some("styles") || p_name == Some("properties")) {
                    continue;
                }
                if let Some(pn) = p_name
                    && seen_props.contains(pn)
                {
                    continue;
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
    if has_custom_element_decorator && let Some(tag) = &target.tag_name {
        let define_stmt =
            helper.define_custom_element(allocator.alloc_str(tag), allocator.alloc_str(comp_id));
        out_post_stmts.push(define_stmt);
    }

    true
}

fn parse_property_options_obj<'a>(
    opts_obj: Option<&ObjectExpression<'a>>,
    prop_name: &str,
    mut is_state: bool,
) -> (String, bool, String) {
    let mut p_type = "string".to_string();
    let mut reflect = false;
    let mut custom_attr: Option<String> = None;

    if let Some(obj) = opts_obj {
        for p in &obj.properties {
            if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                let k = match &prop_kv.key {
                    PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                    PropertyKey::StringLiteral(lit) => Some(lit.value.as_str()),
                    _ => None,
                };
                match k {
                    Some("type") => {
                        if let Expression::Identifier(t_id) = &prop_kv.value {
                            let tn = t_id.name.as_str();
                            if tn == "Number" {
                                p_type = "number".to_string();
                            } else if tn == "Boolean" {
                                p_type = "boolean".to_string();
                            }
                        }
                    }
                    Some("reflect") => {
                        if let Expression::BooleanLiteral(b) = &prop_kv.value {
                            reflect = b.value;
                        }
                    }
                    Some("state") => {
                        if let Expression::BooleanLiteral(b) = &prop_kv.value
                            && b.value
                        {
                            is_state = true;
                        }
                    }
                    Some("attribute") => match &prop_kv.value {
                        Expression::StringLiteral(s) => {
                            custom_attr = Some(s.value.as_str().to_string());
                        }
                        Expression::BooleanLiteral(b) if !b.value => {
                            custom_attr = Some(String::new());
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }
        }
    }

    let attr_name = if is_state {
        String::new()
    } else if let Some(ca) = custom_attr {
        ca
    } else {
        prop_name.to_lowercase()
    };

    (p_type, reflect, attr_name)
}

fn extract_static_properties_obj<'a>(
    obj: &ObjectExpression<'a>,
    allocator: &'a Allocator,
    instance_defaults: &std::collections::HashMap<String, Expression<'a>>,
    seen_props: &mut HashSet<String>,
    properties: &mut Vec<PropertyInfo<'a>>,
) {
    for prop_kind in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(prop_kv) = prop_kind {
            let prop_name_opt = match &prop_kv.key {
                PropertyKey::StaticIdentifier(id) => Some(id.name.as_str().to_string()),
                PropertyKey::StringLiteral(lit) => Some(lit.value.as_str().to_string()),
                _ => None,
            };
            if let Some(prop_name) = prop_name_opt
                && seen_props.insert(prop_name.clone())
            {
                let opts_obj = match &prop_kv.value {
                    Expression::ObjectExpression(inner_obj) => Some(inner_obj.as_ref()),
                    _ => None,
                };
                let (p_type, reflect, attr_name) =
                    parse_property_options_obj(opts_obj, &prop_name, false);
                let default_val = instance_defaults
                    .get(&prop_name)
                    .map(|v| v.clone_in(allocator));
                properties.push(PropertyInfo {
                    name: prop_name,
                    prop_type: p_type,
                    reflect,
                    attribute_name: attr_name,
                    default_value: default_val,
                });
            }
        }
    }
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
                if let Some(e) = el.as_expression()
                    && let Some(s) = extract_css_from_expr(e)
                {
                    parts.push(s);
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
        if let Statement::ReturnStatement(ret) = stmt
            && let Some(Expression::TaggedTemplateExpression(tag)) = &ret.argument
            && import_ctx.is_html_tag(&tag.tag, scoping)
        {
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
