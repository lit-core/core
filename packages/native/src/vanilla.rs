use crate::ast_helpers::AstHelper;
use crate::models::ClassificationResult;
use crate::template_parser::{parse_html_template, BindingKind, ParsedTemplate};
use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct PropertyInfo {
    pub name: String,
    pub prop_type: String, // "string", "number", "boolean"
    pub reflect: bool,
    pub attribute_name: String,
    pub default_value: Option<String>,
}

pub fn transform_vanilla_class<'a>(
    class: &mut Class<'a>,
    source: &str,
    target: &ClassificationResult,
    ast: &AstBuilder<'a>,
    allocator: &'a Allocator,
    out_pre_stmts: &mut Vec<Statement<'a>>,
    out_post_stmts: &mut Vec<Statement<'a>>,
) {
    let helper = AstHelper::new(ast);
    let comp_id = &target.component_name;

    // 1. Analyze class elements: extract styles, template, and properties
    let mut styles_css: Option<String> = None;
    let mut template_quasis: Vec<String> = Vec::new();
    let mut template_exprs: Vec<String> = Vec::new();
    let mut properties: Vec<PropertyInfo> = Vec::new();
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
                            let callee = match &call.callee {
                                Expression::Identifier(id) => Some(id.name.as_str()),
                                Expression::StaticMemberExpression(mem) => {
                                    Some(mem.property.name.as_str())
                                }
                                _ => None,
                            };
                            if callee == Some("property") && seen_props.insert(prop_name.clone()) {
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

                                let default_val = prop.value.as_ref().map(|v| {
                                    let s = v.span();
                                    source[s.start as usize..s.end as usize].to_string()
                                });

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
                            source,
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
    let exprs_slices: Vec<&str> = template_exprs.iter().map(|s| s.as_str()).collect();
    let parsed_template = if !quasis_slices.is_empty() {
        parse_html_template(&quasis_slices, &exprs_slices)
    } else {
        ParsedTemplate {
            html: "<slot></slot>".to_string(),
            bindings: Vec::new(),
        }
    };

    // 3. Synthesize hoisted module-level stylesheet and template constants
    let sheet_var = format!("__lit_sheet_{}", comp_id);
    let tmpl_var = format!("__lit_tmpl_{}", comp_id);

    let mut hoisted_code = String::new();
    if let Some(css) = &styles_css {
        hoisted_code.push_str(&format!(
            "const {} = new CSSStyleSheet();\n{}.replaceSync(`{}`);\n",
            sheet_var,
            sheet_var,
            css.replace('`', "\\`").replace('$', "\\$")
        ));
    }
    hoisted_code.push_str(&format!(
        "const {} = document.createElement('template');\n{}.innerHTML = `{}`;\n",
        tmpl_var,
        tmpl_var,
        parsed_template.html.replace('`', "\\`")
    ));

    // Parse hoisted code into Statements
    let hoisted_code_arena = allocator.alloc_str(&hoisted_code);
    let parsed_hoisted = Parser::new(allocator, hoisted_code_arena, SourceType::mjs()).parse();
    for stmt in parsed_hoisted.program.body {
        out_pre_stmts.push(stmt);
    }

    // 4. Synthesize class members:
    // - static observedAttributes
    // - constructor
    // - property getters & setters with direct DOM mutations
    // - attributeChangedCallback
    let mut members_code = String::new();

    // static observedAttributes
    let observed_attrs: Vec<String> = properties
        .iter()
        .map(|p| format!("'{}'", p.attribute_name))
        .collect();
    if !observed_attrs.is_empty() {
        members_code.push_str(&format!(
            "  static observedAttributes = [{}];\n",
            observed_attrs.join(", ")
        ));
    }

    // Static Lit compatibility stubs for lowered classes
    members_code.push_str("  static createProperty() {}\n");
    members_code.push_str("  static getPropertyOptions() { return {}; }\n");
    members_code.push_str("  static get elementProperties() { return new Map(); }\n");
    members_code.push_str("  static addInitializer() {}\n");

    // constructor
    members_code.push_str("  constructor() {\n");
    members_code.push_str("    super();\n");
    members_code.push_str("    this.attachShadow({ mode: 'open' });\n");
    if styles_css.is_some() {
        members_code.push_str(&format!(
            "    this.shadowRoot.adoptedStyleSheets = [{}];\n",
            sheet_var
        ));
    }
    members_code.push_str(&format!(
        "    const __frag = {}.content.cloneNode(true);\n",
        tmpl_var
    ));

    // Node path resolution and text marker replacement
    for (idx, b) in parsed_template.bindings.iter().enumerate() {
        let mut path_expr = "__frag".to_string();
        for step in &b.path {
            path_expr = format!("{}.childNodes[{}]", path_expr, step);
        }

        if b.kind == BindingKind::Text {
            // Replace marker comment with live text node
            members_code.push_str(&format!("    const __m_{} = {};\n", idx, path_expr));
            members_code.push_str(&format!(
                "    this.__lit_node_{} = document.createTextNode('');\n",
                idx
            ));
            members_code.push_str(&format!(
                "    if (__m_{}) __m_{}.replaceWith(this.__lit_node_{});\n",
                idx, idx, idx
            ));
        } else if b.kind == BindingKind::Event {
            let ev_name = b.name.as_deref().unwrap_or("click");
            let clean_handler = b
                .expr_str
                .trim_start_matches("this.")
                .trim_end_matches("()");
            members_code.push_str(&format!("    const __btn_{} = {};\n", idx, path_expr));
            members_code.push_str(&format!(
                "    if (__btn_{}) __btn_{}.addEventListener('{}', (e) => this.{}(e));\n",
                idx, idx, ev_name, clean_handler
            ));
        } else {
            // Attribute or boolean attribute
            members_code.push_str(&format!("    this.__lit_node_{} = {};\n", idx, path_expr));
        }
    }

    members_code.push_str("    this.shadowRoot.appendChild(__frag);\n");

    // Initialize property backing stores
    for p in &properties {
        let val = p
            .default_value
            .as_deref()
            .unwrap_or(match p.prop_type.as_str() {
                "number" => "0",
                "boolean" => "false",
                _ => "''",
            });
        members_code.push_str(&format!("    this._{} = {};\n", p.name, val));
    }
    members_code.push_str("  }\n");

    // Getters and setters
    for p in &properties {
        let p_name = &p.name;
        members_code.push_str(&format!(
            "  get {}() {{ return this._{}; }}\n",
            p_name, p_name
        ));
        members_code.push_str(&format!("  set {}(v) {{\n", p_name));
        members_code.push_str(&format!("    if (this._{} === v) return;\n", p_name));
        members_code.push_str(&format!("    this._{} = v;\n", p_name));

        // Direct DOM updates
        for (idx, b) in parsed_template.bindings.iter().enumerate() {
            let matches_prop = b.expr_str.contains(p_name);
            if matches_prop {
                match b.kind {
                    BindingKind::Text => {
                        members_code.push_str(&format!(
                            "    if (this.__lit_node_{}) {{ this.__lit_node_{}.data = String(v ?? ''); }}\n",
                            idx, idx
                        ));
                    }
                    BindingKind::BooleanAttribute => {
                        if let Some(attr) = &b.name {
                            members_code.push_str(&format!(
                                "    if (this.__lit_node_{}) {{ this.__lit_node_{}.toggleAttribute('{}', Boolean(v)); }}\n",
                                idx, idx, attr
                            ));
                        }
                    }
                    BindingKind::Attribute => {
                        if let Some(attr) = &b.name {
                            members_code.push_str(&format!(
                                "    if (this.__lit_node_{}) {{ this.__lit_node_{}.setAttribute('{}', String(v ?? '')); }}\n",
                                idx, idx, attr
                            ));
                        }
                    }
                    _ => {}
                }
            }
        }

        if p.reflect {
            if p.prop_type == "boolean" {
                members_code.push_str(&format!(
                    "    if (this.isConnected) {{\n      if (this.hasAttribute('{}') !== Boolean(v)) this.toggleAttribute('{}', Boolean(v));\n    }} else {{\n      queueMicrotask(() => {{\n        if (this.toggleAttribute && this.hasAttribute('{}') !== Boolean(this._{})) this.toggleAttribute('{}', Boolean(this._{}));\n      }});\n    }}\n",
                    p.attribute_name, p.attribute_name, p.attribute_name, p_name, p.attribute_name, p_name
                ));
            } else {
                members_code.push_str(&format!(
                    "    if (this.isConnected) {{\n      if (v != null) {{\n        if (this.getAttribute('{}') !== String(v)) this.setAttribute('{}', String(v));\n      }} else {{\n        this.removeAttribute('{}');\n      }}\n    }} else {{\n      queueMicrotask(() => {{\n        if (this.setAttribute) {{\n          if (this._{} != null) {{\n            if (this.getAttribute('{}') !== String(this._{})) this.setAttribute('{}', String(this._{}));\n          }} else {{\n            this.removeAttribute('{}');\n          }}\n        }}\n      }});\n    }}\n",
                    p.attribute_name, p.attribute_name, p.attribute_name, p_name, p.attribute_name, p_name, p.attribute_name, p_name, p.attribute_name
                ));
            }
        }
        members_code.push_str("  }\n");
    }

    // attributeChangedCallback
    if !properties.is_empty() {
        members_code.push_str("  attributeChangedCallback(name, oldVal, newVal) {\n");
        members_code.push_str("    if (oldVal === newVal) return;\n");
        members_code.push_str("    switch (name) {\n");
        for p in &properties {
            let cast = match p.prop_type.as_str() {
                "number" => "newVal != null ? Number(newVal) : 0",
                "boolean" => "newVal !== null",
                _ => "newVal ?? ''",
            };
            members_code.push_str(&format!(
                "      case '{}': this.{} = {}; break;\n",
                p.attribute_name, p.name, cast
            ));
        }
        members_code.push_str("    }\n");
        members_code.push_str("  }\n");
    }

    // Lit instance lifecycle compatibility stubs
    members_code.push_str("  get renderRoot() { return this.shadowRoot; }\n");
    members_code.push_str("  requestUpdate() { return Promise.resolve(false); }\n");
    members_code.push_str("  get updateComplete() { return Promise.resolve(true); }\n");

    // Parse synthesized class members into AST ClassElements
    let dummy_source = format!("class __Dummy {{\n{}\n}}", members_code);
    let dummy_source_arena = allocator.alloc_str(&dummy_source);
    let mut parsed_dummy = Parser::new(allocator, dummy_source_arena, SourceType::mjs()).parse();

    // 5. Update class AST:
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

    // First push synthesized members (observedAttributes, constructor, accessors, attributeChangedCallback)
    if let Some(Statement::ClassDeclaration(ref mut dummy_class)) =
        parsed_dummy.program.body.get_mut(0)
    {
        for elem in dummy_class.body.body.drain(..) {
            new_body_elements.push(elem);
        }
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

    // 6. Define custom element if tag_name is present
    if let Some(tag) = &target.tag_name {
        let define_stmt =
            helper.define_custom_element(allocator.alloc_str(tag), allocator.alloc_str(comp_id));
        out_post_stmts.push(define_stmt);
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
    source: &str,
    out_quasis: &mut Vec<String>,
    out_exprs: &mut Vec<String>,
) {
    for stmt in &body.statements {
        if let Statement::ReturnStatement(ret) = stmt {
            if let Some(Expression::TaggedTemplateExpression(tag)) = &ret.argument {
                for q in &tag.quasi.quasis {
                    out_quasis.push(q.value.raw.as_str().to_string());
                }
                for e in &tag.quasi.expressions {
                    let s = e.span();
                    out_exprs.push(source[s.start as usize..s.end as usize].to_string());
                }
                return;
            }
        }
    }
}
