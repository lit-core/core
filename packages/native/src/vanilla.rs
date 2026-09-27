use crate::models::{ClassificationResult, TransformOptions};
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use std::collections::HashSet;

#[derive(Debug, Clone)]
struct PropertyInfo {
    name: String,
    prop_type: String, // "string", "number", "boolean", "object"
    reflect: bool,
    attribute_name: String,
    default_value: Option<String>,
}

#[derive(Debug, Clone)]
struct EventInfo {
    event_name: String,
    handler_expr: String,
    node_path: Vec<usize>,
}

#[derive(Debug, Clone)]
struct DynamicBindingInfo {
    prop_name: String,
    node_path: Vec<usize>,
    is_attribute: bool,
    attribute_name: Option<String>,
    is_boolean: bool,
}

pub fn transform_vanilla(source: &str, target: &ClassificationResult, options: &TransformOptions) -> String {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(options.filename.as_deref().unwrap_or("file.ts"))
        .unwrap_or_else(|_| SourceType::ts());

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.program.body.is_empty() {
        return source.to_string();
    }

    let program = &parsed.program;

    // 1. Extract class properties, styles, and template
    let mut styles_css: Option<String> = None;
    let mut template_html: Option<String> = None;
    let mut properties: Vec<PropertyInfo> = Vec::new();
    let mut events: Vec<EventInfo> = Vec::new();
    let mut dynamic_bindings: Vec<DynamicBindingInfo> = Vec::new();
    let mut styles_span: Option<(usize, usize)> = None;
    let mut render_span: Option<(usize, usize)> = None;
    let mut class_span: Option<(usize, usize)> = None;
    let mut class_heritage_span: Option<(usize, usize)> = None;

    for stmt in &program.body {
        match stmt {
            Statement::ClassDeclaration(class) => {
                let name = class.id.as_ref().map(|id| id.name.as_str()).unwrap_or("");
                if name == target.component_name {
                    class_span = Some((class.span.start as usize, class.span.end as usize));
                    if let Some(heritage) = &class.heritage {
                        class_heritage_span = Some((heritage.span().start as usize, heritage.span().end as usize));
                    }
                    analyze_class(
                        class,
                        source,
                        &mut styles_css,
                        &mut styles_span,
                        &mut template_html,
                        &mut render_span,
                        &mut properties,
                        &mut events,
                        &mut dynamic_bindings,
                    );
                }
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    let name = class.id.as_ref().map(|id| id.name.as_str()).unwrap_or("");
                    if name == target.component_name {
                        class_span = Some((class.span.start as usize, class.span.end as usize));
                        if let Some(heritage) = &class.heritage {
                            class_heritage_span = Some((heritage.span().start as usize, heritage.span().end as usize));
                        }
                        analyze_class(
                            class,
                            source,
                            &mut styles_css,
                            &mut styles_span,
                            &mut template_html,
                            &mut render_span,
                            &mut properties,
                            &mut events,
                            &mut dynamic_bindings,
                        );
                    }
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) = &export_decl.declaration {
                    let name = class.id.as_ref().map(|id| id.name.as_str()).unwrap_or("");
                    if name == target.component_name {
                        class_span = Some((class.span.start as usize, class.span.end as usize));
                        if let Some(heritage) = &class.heritage {
                            class_heritage_span = Some((heritage.span().start as usize, heritage.span().end as usize));
                        }
                        analyze_class(
                            class,
                            source,
                            &mut styles_css,
                            &mut styles_span,
                            &mut template_html,
                            &mut render_span,
                            &mut properties,
                            &mut events,
                            &mut dynamic_bindings,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    let Some(_span) = class_span else {
        return source.to_string();
    };

    // Build the transformed code
    let mut output = String::with_capacity(source.len() + 1024);

    // 1. Remove Lit imports
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ") && (trimmed.contains("'lit'") || trimmed.contains("\"lit\"") || trimmed.contains("'lit/") || trimmed.contains("\"lit/") || trimmed.contains("'lit-element'") || trimmed.contains("'lit-html'")) {
            // Check if this import imports non-lit things or purely lit
            if trimmed.contains("LitElement") || trimmed.contains("html") || trimmed.contains("css") || trimmed.contains("customElement") || trimmed.contains("property") || trimmed.contains("state") {
                // Strip this lit import line
                continue;
            }
        }
        output.push_str(line);
        output.push('\n');
    }

    // 2. Synthesize module-level stylesheet and template constants
    let comp_id = &target.component_name;
    let sheet_var = format!("__lit_native_sheet_{}", comp_id);
    let tmpl_var = format!("__lit_native_tmpl_{}", comp_id);

    let mut hoisted_preamble = String::new();

    if let Some(css) = &styles_css {
        hoisted_preamble.push_str(&format!(
            "const {} = new CSSStyleSheet();\n{}.replaceSync(`{}`);\n\n",
            sheet_var, sheet_var, css.replace('`', "\\`").replace('$', "\\$")
        ));
    }

    let clean_tmpl = template_html.unwrap_or_else(|| "<slot></slot>".to_string());
    hoisted_preamble.push_str(&format!(
        "const {} = document.createElement('template');\n{}.innerHTML = `{}`;\n\n",
        tmpl_var, tmpl_var, clean_tmpl.replace('`', "\\`")
    ));

    // Inject preamble at the top of the file (after imports)
    let mut final_code = String::with_capacity(output.len() + hoisted_preamble.len() + 2048);
    let mut injected_preamble = false;

    for line in output.lines() {
        if !injected_preamble && !line.trim().starts_with("import ") && !line.trim().starts_with("//") && !line.trim().starts_with("/*") && !line.trim().is_empty() {
            final_code.push_str(&hoisted_preamble);
            injected_preamble = true;
        }
        final_code.push_str(line);
        final_code.push('\n');
    }
    if !injected_preamble {
        final_code.insert_str(0, &hoisted_preamble);
    }

    // Replace `extends LitElement` or `extends ReactiveElement` with `extends HTMLElement`
    let mut rewritten = final_code
        .replace("extends LitElement", "extends HTMLElement")
        .replace("extends ReactiveElement", "extends HTMLElement");

    // Strip decorators on class like @customElement('tag'), @property, @state
    rewritten = strip_decorator(&rewritten, "customElement");
    rewritten = strip_decorator(&rewritten, "property");
    rewritten = strip_decorator(&rewritten, "state");

    // Strip static styles and render() method
    rewritten = strip_method_or_prop(&rewritten, "styles");
    rewritten = strip_method_or_prop(&rewritten, "render");

    // Now inject custom element body additions:
    // static observedAttributes
    // constructor with attachShadow, adoptedStyleSheets, template clone, events
    // property getters and setters
    // attributeChangedCallback
    let observed_attrs: Vec<String> = properties.iter().map(|p| format!("'{}'", p.attribute_name)).collect();
    let observed_attrs_code = if observed_attrs.is_empty() {
        "".to_string()
    } else {
        format!("  static observedAttributes = [{}];\n", observed_attrs.join(", "))
    };

    let mut ctor_body = String::new();
    ctor_body.push_str("    super();\n");
    ctor_body.push_str("    this.attachShadow({ mode: 'open' });\n");
    if styles_css.is_some() {
        ctor_body.push_str(&format!("    this.shadowRoot.adoptedStyleSheets = [{}];\n", sheet_var));
    }
    ctor_body.push_str(&format!("    const __frag = {}.content.cloneNode(true);\n", tmpl_var));

    // Store node references for dynamic bindings
    for (idx, b) in dynamic_bindings.iter().enumerate() {
        let mut path_expr = "__frag".to_string();
        for step in &b.node_path {
            path_expr = format!("{}.childNodes[{}]", path_expr, step);
        }
        ctor_body.push_str(&format!("    this.__lit_node_{} = {} || __frag.appendChild(document.createTextNode(''));\n", idx, path_expr));
    }

    // Attach events
    for (idx, ev) in events.iter().enumerate() {
        let mut path_expr = "__frag".to_string();
        for step in &ev.node_path {
            path_expr = format!("{}.childNodes[{}]", path_expr, step);
        }
        ctor_body.push_str(&format!("    const __btn_{} = {};\n", idx, path_expr));
        ctor_body.push_str(&format!("    if (__btn_{}) __btn_{}.addEventListener('{}', (e) => this.{}(e));\n", idx, idx, ev.event_name, ev.handler_expr));
    }

    ctor_body.push_str("    this.shadowRoot.appendChild(__frag);\n");

    // Initialize property defaults
    for p in &properties {
        let val = p.default_value.as_deref().unwrap_or(match p.prop_type.as_str() {
            "number" => "0",
            "boolean" => "false",
            _ => "''",
        });
        ctor_body.push_str(&format!("    this._{} = {};\n", p.name, val));
    }

    let mut accessors_code = String::new();
    for p in &properties {
        let p_name = &p.name;
        accessors_code.push_str(&format!("  get {}() {{ return this._{}; }}\n", p_name, p_name));
        accessors_code.push_str(&format!("  set {}(v) {{\n", p_name));
        accessors_code.push_str(&format!("    if (this._{} === v) return;\n", p_name));
        accessors_code.push_str(&format!("    this._{} = v;\n", p_name));

        // Direct C++ text node mutation or attribute update
        for (idx, b) in dynamic_bindings.iter().enumerate() {
            if b.prop_name == *p_name {
                if b.is_attribute {
                    if let Some(attr) = &b.attribute_name {
                        if b.is_boolean {
                            accessors_code.push_str(&format!("    if (this.__lit_node_{}) {{ this.__lit_node_{}.toggleAttribute('{}', Boolean(v)); }}\n", idx, idx, attr));
                        } else {
                            accessors_code.push_str(&format!("    if (this.__lit_node_{}) {{ this.__lit_node_{}.setAttribute('{}', String(v ?? '')); }}\n", idx, idx, attr));
                        }
                    }
                } else {
                    accessors_code.push_str(&format!("    if (this.__lit_node_{}) {{ this.__lit_node_{}.data = String(v ?? ''); }}\n", idx, idx));
                }
            }
        }

        if p.reflect {
            if p.prop_type == "boolean" {
                accessors_code.push_str(&format!("    this.toggleAttribute('{}', Boolean(v));\n", p.attribute_name));
            } else {
                accessors_code.push_str(&format!("    if (v != null) this.setAttribute('{}', String(v)); else this.removeAttribute('{}');\n", p.attribute_name, p.attribute_name));
            }
        }
        accessors_code.push_str("  }\n");
    }

    let mut attr_changed_callback = String::new();
    if !properties.is_empty() {
        attr_changed_callback.push_str("  attributeChangedCallback(name, oldVal, newVal) {\n");
        attr_changed_callback.push_str("    if (oldVal === newVal) return;\n");
        attr_changed_callback.push_str("    switch (name) {\n");
        for p in &properties {
            let cast = match p.prop_type.as_str() {
                "number" => "newVal != null ? Number(newVal) : 0",
                "boolean" => "newVal !== null",
                _ => "newVal ?? ''",
            };
            attr_changed_callback.push_str(&format!("      case '{}': this.{} = {}; break;\n", p.attribute_name, p.name, cast));
        }
        attr_changed_callback.push_str("    }\n");
        attr_changed_callback.push_str("  }\n");
    }

    // Inject members into the class
    // Find class opening `{`
    let class_decl_pattern = format!("class {}", comp_id);
    if let Some(pos) = rewritten.find(&class_decl_pattern) {
        if let Some(open_brace) = rewritten[pos..].find('{') {
            let insert_pos = pos + open_brace + 1;
            let class_body_slice = &rewritten[insert_pos..];
            let has_existing_ctor = class_body_slice.find("constructor(").is_some();

            let mut injected_members = String::new();
            injected_members.push('\n');
            injected_members.push_str(&observed_attrs_code);

            if !has_existing_ctor {
                injected_members.push_str("  constructor() {\n");
                injected_members.push_str(&ctor_body);
                injected_members.push_str("  }\n");
            } else if let Some(super_pos) = class_body_slice.find("super(") {
                if let Some(semi) = class_body_slice[super_pos..].find(';') {
                    let after_super_pos = insert_pos + super_pos + semi + 1;
                    rewritten.insert_str(after_super_pos, &format!("\n{}", ctor_body.replace("super();\n", "")));
                }
            }

            injected_members.push_str(&accessors_code);
            injected_members.push_str(&attr_changed_callback);
            rewritten.insert_str(insert_pos, &injected_members);
        }
    }

    // If tag_name was present and customElements.define is not already called, emit define
    if let Some(tag) = &target.tag_name {
        let define_call = format!("customElements.define('{}', {});\n", tag, comp_id);
        if !rewritten.contains(&format!("customElements.define('{}'", tag)) && !rewritten.contains(&format!("customElements.define(\"{}\"", tag)) {
            rewritten.push('\n');
            rewritten.push_str(&define_call);
        }
    }

    rewritten
}

fn analyze_class<'a>(
    class: &Class<'a>,
    source: &str,
    out_styles: &mut Option<String>,
    out_styles_span: &mut Option<(usize, usize)>,
    out_template: &mut Option<String>,
    out_render_span: &mut Option<(usize, usize)>,
    out_properties: &mut Vec<PropertyInfo>,
    out_events: &mut Vec<EventInfo>,
    out_dynamic_bindings: &mut Vec<DynamicBindingInfo>,
) {
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
                        *out_styles_span = Some((prop.span.start as usize, prop.span.end as usize));
                        if let Some(init) = &prop.value {
                            *out_styles = extract_css_from_expr(init, source);
                        }
                        continue;
                    }

                    // Check for @property or @state decorators
                    for dec in &prop.decorators {
                        if let Expression::CallExpression(call) = &dec.expression {
                            let callee = match &call.callee {
                                Expression::Identifier(id) => Some(id.name.as_str()),
                                Expression::StaticMemberExpression(mem) => Some(mem.property.name.as_str()),
                                _ => None,
                            };
                            if callee == Some("property") {
                                if seen_props.insert(prop_name.clone()) {
                                    let mut p_type = "string".to_string();
                                    let mut reflect = false;
                                    let mut attr_name = prop_name.to_lowercase();

                                    if let Some(arg) = call.arguments.first() {
                                        if let Some(Expression::ObjectExpression(obj)) = arg.as_expression() {
                                            for p in &obj.properties {
                                                if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                                                    let k = match &prop_kv.key {
                                                        PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                                                        _ => None,
                                                    };
                                                    if k == Some("type") {
                                                        if let Expression::Identifier(t_id) = &prop_kv.value {
                                                            let tn = t_id.name.as_str();
                                                            if tn == "Number" { p_type = "number".to_string(); }
                                                            else if tn == "Boolean" { p_type = "boolean".to_string(); }
                                                        }
                                                    }
                                                    if k == Some("reflect") {
                                                        if let Expression::BooleanLiteral(b) = &prop_kv.value {
                                                            reflect = b.value;
                                                        }
                                                    }
                                                    if k == Some("attribute") {
                                                        if let Expression::StringLiteral(s) = &prop_kv.value {
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

                                    out_properties.push(PropertyInfo {
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
            }
            ClassElement::MethodDefinition(m) => {
                let name = m.key.static_name().unwrap_or_default();
                if m.r#static && name == "styles" {
                    *out_styles_span = Some((m.span.start as usize, m.span.end as usize));
                    if let Some(body) = &m.value.body {
                        let span = body.span;
                        *out_styles = Some(extract_css_from_str(&source[span.start as usize..span.end as usize]));
                    }
                } else if name == "render" {
                    *out_render_span = Some((m.span.start as usize, m.span.end as usize));
                    if let Some(body) = &m.value.body {
                        let span = body.span;
                        let render_slice = &source[span.start as usize..span.end as usize];
                        parse_render_template(
                            render_slice,
                            out_template,
                            out_events,
                            out_dynamic_bindings,
                        );
                    }
                }
            }
            _ => {}
        }
    }
}

fn extract_css_from_expr<'a>(expr: &Expression<'a>, source: &str) -> Option<String> {
    match expr {
        Expression::TaggedTemplateExpression(tag) => {
            let start = tag.quasi.span.start as usize + 1;
            let end = tag.quasi.span.end as usize - 1;
            if start <= end && end <= source.len() {
                Some(source[start..end].to_string())
            } else {
                None
            }
        }
        Expression::ArrayExpression(arr) => {
            let mut parts = Vec::new();
            for el in &arr.elements {
                if let Some(e) = el.as_expression() {
                    if let Some(s) = extract_css_from_expr(e, source) {
                        parts.push(s);
                    }
                }
            }
            Some(parts.join("\n"))
        }
        _ => None,
    }
}

fn extract_css_from_str(s: &str) -> String {
    if let Some(start) = s.find("css`") {
        let after = &s[start + 4..];
        if let Some(end) = after.find('`') {
            return after[..end].to_string();
        }
    }
    String::new()
}

fn parse_render_template(
    render_code: &str,
    out_template: &mut Option<String>,
    out_events: &mut Vec<EventInfo>,
    out_dynamic_bindings: &mut Vec<DynamicBindingInfo>,
) {
    // Find html`...`
    let Some(start) = render_code.find("html`") else {
        return;
    };
    let after = &render_code[start + 5..];
    let Some(end) = after.rfind('`') else {
        return;
    };
    let tmpl_str = &after[..end];

    // Simple parsing of template string: extract dynamic parts ${...}
    // Replace ${...} with clean HTML and record paths
    let mut clean_html = String::with_capacity(tmpl_str.len());
    let mut i = 0;
    let bytes = tmpl_str.as_bytes();

    while i < bytes.len() {
        if bytes[i] == b'$' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            let exp_start = i + 2;
            let mut depth = 1;
            let mut exp_end = exp_start;
            while exp_end < bytes.len() && depth > 0 {
                if bytes[exp_end] == b'{' { depth += 1; }
                else if bytes[exp_end] == b'}' { depth -= 1; }
                exp_end += 1;
            }
            let expr = std::str::from_utf8(&bytes[exp_start..exp_end - 1]).unwrap_or("").trim();

            // Check if this was an event binding: e.g. @click=${this._onClick}
            let preceding = &tmpl_str[..i];
            if let Some(at_pos) = preceding.rfind('@') {
                let event_slice = preceding[at_pos..].trim();
                if event_slice.ends_with('=') || event_slice.ends_with("=\"") || event_slice.ends_with("='") {
                    let ev_name = event_slice.trim_start_matches('@').trim_end_matches('=').trim_end_matches('"').trim_end_matches('\'');
                    let clean_handler = expr.trim_start_matches("this.").trim_end_matches("()");
                    out_events.push(EventInfo {
                        event_name: ev_name.to_string(),
                        handler_expr: clean_handler.to_string(),
                        node_path: vec![0], // Direct top-level element
                    });
                }
            } else if let Some(question_pos) = preceding.rfind('?') {
                // Boolean attribute binding: ?disabled=${this.disabled}
                let attr_slice = preceding[question_pos..].trim();
                let attr_name = attr_slice.trim_start_matches('?').trim_end_matches('=').trim_end_matches('"').trim_end_matches('\'');
                let prop_name = expr.trim_start_matches("this.");
                out_dynamic_bindings.push(DynamicBindingInfo {
                    prop_name: prop_name.to_string(),
                    node_path: vec![0],
                    is_attribute: true,
                    attribute_name: Some(attr_name.to_string()),
                    is_boolean: true,
                });
            } else {
                // Text node dynamic interpolation
                let prop_name = expr.trim_start_matches("this.");
                out_dynamic_bindings.push(DynamicBindingInfo {
                    prop_name: prop_name.to_string(),
                    node_path: vec![0, 0], // Text inside top element
                    is_attribute: false,
                    attribute_name: None,
                    is_boolean: false,
                });
                clean_html.push(' '); // placeholder text space
            }

            i = exp_end;
        } else {
            clean_html.push(bytes[i] as char);
            i += 1;
        }
    }

    *out_template = Some(clean_html.trim().to_string());
}

fn strip_decorator(s: &str, dec_name: &str) -> String {
    let mut res = s.to_string();
    let pattern = format!("@{}", dec_name);
    while let Some(pos) = res.find(&pattern) {
        let after = &res[pos + pattern.len()..];
        let trimmed_after = after.trim_start();
        if trimmed_after.starts_with('(') {
            let offset = pos + pattern.len() + (after.len() - trimmed_after.len());
            let bytes = res.as_bytes();
            let mut depth = 1;
            let mut end = offset + 1;
            while end < bytes.len() && depth > 0 {
                if bytes[end] == b'(' { depth += 1; }
                else if bytes[end] == b')' { depth -= 1; }
                end += 1;
            }
            while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t' || bytes[end] == b'\n' || bytes[end] == b'\r') {
                end += 1;
            }
            res.replace_range(pos..end, "");
        } else {
            res.replace_range(pos..pos + pattern.len(), "");
        }
    }
    res
}

fn strip_method_or_prop(s: &str, name: &str) -> String {
    let mut res = s.to_string();
    let patterns = [
        format!("static styles ="),
        format!("static get styles()"),
        format!("static styles()"),
        format!("render()"),
    ];

    for pat in patterns {
        if !pat.contains(name) {
            continue;
        }
        while let Some(pos) = res.find(&pat) {
            let after = &res[pos..];
            if let Some(open_brace) = after.find('{') {
                let start_brace = pos + open_brace;
                let bytes = res.as_bytes();
                let mut depth = 1;
                let mut end = start_brace + 1;
                while end < bytes.len() && depth > 0 {
                    if bytes[end] == b'{' { depth += 1; }
                    else if bytes[end] == b'}' { depth -= 1; }
                    end += 1;
                }
                while end < bytes.len() && (bytes[end] == b';' || bytes[end] == b' ' || bytes[end] == b'\t' || bytes[end] == b'\n') {
                    end += 1;
                }
                res.replace_range(pos..end, "");
            } else if let Some(semi) = after.find(';') {
                let end = pos + semi + 1;
                res.replace_range(pos..end, "");
            } else {
                break;
            }
        }
    }
    res
}
