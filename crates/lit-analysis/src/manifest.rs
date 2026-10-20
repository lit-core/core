use crate::classify::ClassificationTier;
use crate::decorator::ExtractedDecorator;
use crate::property::PropertyInfo;
use crate::symbol::SymbolProofContext;
#[cfg(feature = "template-ir")]
use crate::template_ir::{AttributePrefix, TemplateIR, TemplateNode};
use oxc_ast::ast::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlotInfo {
    pub name: Option<String>,
    pub has_fallback: bool,
    pub inspected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventInfo {
    pub name: String,
    pub prop_name: String,
    pub detail_type: Option<String>,
    pub bubbles: bool,
    pub cancelable: bool,
    pub composed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StyleInfo {
    pub css_text: String,
    pub is_shared: bool,
    pub shared_import_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShadowRootOptions {
    pub delegates_focus: bool,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LitComponentInfo {
    pub tag_name: Option<String>,
    pub class_name: String,
    pub component_name: String,
    pub tier: ClassificationTier,
    pub properties: Vec<PropertyInfo>,
    pub events: Vec<EventInfo>,
    pub slots: Vec<SlotInfo>,
    pub styles: Vec<StyleInfo>,
    pub shadow_root_options: Option<ShadowRootOptions>,
    #[cfg(feature = "template-ir")]
    pub template: Option<TemplateIR>,
    #[cfg(not(feature = "template-ir"))]
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub template: Option<()>,
    pub super_class: Option<String>,
    pub mixins: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModuleManifest {
    pub file_path: String,
    pub components: Vec<LitComponentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentRef {
    pub file_path: String,
    pub class_name: String,
    pub tag_name: String,
    pub component_name: String,
    pub tier: ClassificationTier,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryManifest {
    pub tag_to_component: HashMap<String, ComponentRef>,
    pub class_to_component: HashMap<String, ComponentRef>,
    pub modules: HashMap<String, ModuleManifest>,
}

pub struct ManifestScanner;

impl ManifestScanner {
    pub fn derive_component_name(tag: Option<&str>, class_name: &str) -> String {
        if let Some(t) = tag {
            let mut out = String::new();
            let mut cap_next = true;
            for c in t.chars() {
                if c == '-' {
                    cap_next = true;
                } else if cap_next {
                    for uc in c.to_uppercase() {
                        out.push(uc);
                    }
                    cap_next = false;
                } else {
                    out.push(c);
                }
            }
            if !out.is_empty() {
                return out;
            }
        }
        class_name.to_string()
    }

    pub fn to_camel_case(s: &str) -> String {
        let mut out = String::new();
        let mut cap_next = false;
        for c in s.chars() {
            if c == '-' || c == '_' || c == ':' {
                cap_next = true;
            } else if cap_next {
                for uc in c.to_uppercase() {
                    out.push(uc);
                }
                cap_next = false;
            } else {
                out.push(c);
            }
        }
        out
    }

    pub fn derive_event_prop_name(event_name: &str) -> String {
        let camel = Self::to_camel_case(event_name);
        let mut chars = camel.chars();
        match chars.next() {
            Some(first) => {
                let mut s = String::from("on");
                for uc in first.to_uppercase() {
                    s.push(uc);
                }
                s.extend(chars);
                s
            }
            None => "onEvent".to_string(),
        }
    }

    pub fn extract_slots<'a>(
        class: Option<&'a Class<'a>>,
        #[cfg(feature = "template-ir")] template: Option<&TemplateIR>,
        #[cfg(not(feature = "template-ir"))] _template: Option<()>,
        ctx: Option<&SymbolProofContext<'a>>,
    ) -> Vec<SlotInfo> {
        let mut slots = Vec::new();
        #[cfg(feature = "template-ir")]
        if let Some(tmpl) = template {
            Self::collect_slots_from_nodes(&tmpl.roots, &mut slots);
        }

        if let (Some(class), Some(ctx)) = (class, ctx) {
            for element in &class.body.body {
                match element {
                    ClassElement::MethodDefinition(method) => {
                        if let Some(body) = &method.value.body {
                            for stmt in &body.statements {
                                Self::collect_slots_from_stmt(stmt, ctx, &mut slots);
                            }
                        }
                    }
                    ClassElement::PropertyDefinition(prop) => {
                        if let Some(init) = &prop.value {
                            Self::collect_slots_from_expr(init, ctx, &mut slots);
                        }
                    }
                    _ => {}
                }
            }
        }

        slots
    }

    fn collect_slots_from_stmt<'a>(
        stmt: &'a Statement<'a>,
        ctx: &SymbolProofContext<'a>,
        slots: &mut Vec<SlotInfo>,
    ) {
        match stmt {
            Statement::ReturnStatement(ret) => {
                if let Some(arg) = &ret.argument {
                    Self::collect_slots_from_expr(arg, ctx, slots);
                }
            }
            Statement::ExpressionStatement(expr_stmt) => {
                Self::collect_slots_from_expr(&expr_stmt.expression, ctx, slots);
            }
            Statement::IfStatement(if_stmt) => {
                Self::collect_slots_from_expr(&if_stmt.test, ctx, slots);
                Self::collect_slots_from_stmt(&if_stmt.consequent, ctx, slots);
                if let Some(alt) = &if_stmt.alternate {
                    Self::collect_slots_from_stmt(alt, ctx, slots);
                }
            }
            Statement::BlockStatement(blk) => {
                for s in &blk.body {
                    Self::collect_slots_from_stmt(s, ctx, slots);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(init) = &decl.init {
                        Self::collect_slots_from_expr(init, ctx, slots);
                    }
                }
            }
            _ => {}
        }
    }

    fn collect_slots_from_expr<'a>(
        expr: &'a Expression<'a>,
        ctx: &SymbolProofContext<'a>,
        slots: &mut Vec<SlotInfo>,
    ) {
        match expr {
            Expression::TaggedTemplateExpression(tagged) => {
                if ctx.is_lit_html_tag(&tagged.tag) || ctx.is_lit_svg_tag(&tagged.tag) {
                    #[cfg(feature = "template-ir")]
                    {
                        let quasis: Vec<&str> = tagged
                            .quasi
                            .quasis
                            .iter()
                            .map(|q| q.value.raw.as_str())
                            .collect();
                        let expr_count = tagged.quasi.expressions.len();
                        if let Ok(inner_ir) = crate::template_ir::TemplateParser::parse_lit_template(
                            &quasis, expr_count,
                        ) {
                            Self::collect_slots_from_nodes(&inner_ir.roots, slots);
                        }
                    }
                }
                for e in &tagged.quasi.expressions {
                    Self::collect_slots_from_expr(e, ctx, slots);
                }
            }
            Expression::CallExpression(call) => {
                Self::collect_slots_from_expr(&call.callee, ctx, slots);
                for arg in &call.arguments {
                    if let Some(e) = arg.as_expression() {
                        Self::collect_slots_from_expr(e, ctx, slots);
                    }
                }
            }
            Expression::ArrowFunctionExpression(arrow) => {
                if let Some(concise) = arrow.body.as_expression() {
                    Self::collect_slots_from_expr(concise, ctx, slots);
                } else if let ArrowFunctionBody::FunctionBody(b) = &arrow.body {
                    for s in &b.statements {
                        Self::collect_slots_from_stmt(s, ctx, slots);
                    }
                }
            }
            Expression::FunctionExpression(func) => {
                if let Some(body) = &func.body {
                    for s in &body.statements {
                        Self::collect_slots_from_stmt(s, ctx, slots);
                    }
                }
            }
            Expression::ConditionalExpression(c) => {
                Self::collect_slots_from_expr(&c.test, ctx, slots);
                Self::collect_slots_from_expr(&c.consequent, ctx, slots);
                Self::collect_slots_from_expr(&c.alternate, ctx, slots);
            }
            Expression::LogicalExpression(l) => {
                Self::collect_slots_from_expr(&l.left, ctx, slots);
                Self::collect_slots_from_expr(&l.right, ctx, slots);
            }
            Expression::ArrayExpression(a) => {
                for el in &a.elements {
                    if let Some(e) = el.as_expression() {
                        Self::collect_slots_from_expr(e, ctx, slots);
                    }
                }
            }
            Expression::ParenthesizedExpression(p) => {
                Self::collect_slots_from_expr(&p.expression, ctx, slots);
            }
            Expression::SequenceExpression(s) => {
                for e in &s.expressions {
                    Self::collect_slots_from_expr(e, ctx, slots);
                }
            }
            _ => {}
        }
    }

    #[cfg(feature = "template-ir")]
    fn collect_slots_from_nodes(nodes: &[TemplateNode], slots: &mut Vec<SlotInfo>) {
        for node in nodes {
            match node {
                TemplateNode::Slot(slot) => {
                    let info = SlotInfo {
                        name: slot.name.clone(),
                        has_fallback: !slot.fallback.is_empty(),
                        inspected: slot.inspected,
                    };
                    if let Some(existing) = slots.iter_mut().find(|s| s.name == info.name) {
                        existing.has_fallback = existing.has_fallback || info.has_fallback;
                        existing.inspected = existing.inspected || info.inspected;
                    } else {
                        slots.push(info);
                    }
                }
                TemplateNode::Element(el) => {
                    Self::collect_slots_from_nodes(&el.children, slots);
                }
                _ => {}
            }
        }
    }

    pub fn extract_events<'a>(
        class: &'a Class<'a>,
        #[cfg(feature = "template-ir")] template: Option<&TemplateIR>,
        #[cfg(not(feature = "template-ir"))] _template: Option<()>,
        _decorators: &[ExtractedDecorator],
    ) -> Vec<EventInfo> {
        let mut events_map: HashMap<String, EventInfo> = HashMap::new();

        // 1. From template event bindings (@eventName)
        #[cfg(feature = "template-ir")]
        if let Some(tmpl) = template {
            Self::collect_events_from_nodes(&tmpl.roots, &mut events_map);
        }

        // 2. From this.dispatchEvent(new CustomEvent('event-name', ...)) in class methods
        for element in &class.body.body {
            if let ClassElement::MethodDefinition(method) = element {
                if let Some(body) = &method.value.body {
                    for stmt in &body.statements {
                        Self::inspect_stmt_for_events(stmt, &mut events_map);
                    }
                }
            }
        }

        let mut events: Vec<EventInfo> = events_map.into_values().collect();
        events.sort_by(|a, b| a.name.cmp(&b.name));
        events
    }

    #[cfg(feature = "template-ir")]
    fn collect_events_from_nodes(
        nodes: &[TemplateNode],
        events_map: &mut HashMap<String, EventInfo>,
    ) {
        for node in nodes {
            match node {
                TemplateNode::Element(el) => {
                    for attr in &el.attributes {
                        if attr.prefix == AttributePrefix::Event {
                            let prop_name = Self::derive_event_prop_name(&attr.name);
                            events_map.entry(attr.name.clone()).or_insert(EventInfo {
                                name: attr.name.clone(),
                                prop_name,
                                detail_type: None,
                                bubbles: true,
                                cancelable: false,
                                composed: true,
                            });
                        }
                    }
                    Self::collect_events_from_nodes(&el.children, events_map);
                }
                TemplateNode::Slot(slot) => {
                    Self::collect_events_from_nodes(&slot.fallback, events_map);
                }
                _ => {}
            }
        }
    }

    fn inspect_stmt_for_events<'a>(
        stmt: &'a Statement<'a>,
        events_map: &mut HashMap<String, EventInfo>,
    ) {
        if let Statement::ExpressionStatement(expr_stmt) = stmt {
            if let Expression::CallExpression(call) = &expr_stmt.expression {
                if let Expression::StaticMemberExpression(mem) = &call.callee {
                    if mem.property.name == "dispatchEvent" {
                        if let Expression::ThisExpression(_) = &mem.object {
                            if let Some(Expression::NewExpression(new_expr)) =
                                call.arguments.first().and_then(|a| a.as_expression())
                            {
                                if let Some(Expression::StringLiteral(s)) =
                                    new_expr.arguments.first().and_then(|a| a.as_expression())
                                {
                                    let event_name = s.value.to_string();
                                    let prop_name = Self::derive_event_prop_name(&event_name);
                                    let detail_type =
                                        new_expr.type_arguments.as_ref().and_then(|tp| {
                                            tp.params.first().and_then(|param| match param {
                                                TSType::TSTypeReference(tref) => {
                                                    match &tref.type_name {
                                                        TSTypeName::IdentifierReference(id) => {
                                                            Some(id.name.to_string())
                                                        }
                                                        _ => None,
                                                    }
                                                }
                                                TSType::TSStringKeyword(_) => {
                                                    Some("string".to_string())
                                                }
                                                TSType::TSNumberKeyword(_) => {
                                                    Some("number".to_string())
                                                }
                                                TSType::TSBooleanKeyword(_) => {
                                                    Some("boolean".to_string())
                                                }
                                                _ => None,
                                            })
                                        });
                                    let entry = events_map
                                        .entry(event_name.clone())
                                        .or_insert_with(|| EventInfo {
                                            name: event_name,
                                            prop_name,
                                            detail_type: detail_type.clone(),
                                            bubbles: true,
                                            cancelable: false,
                                            composed: true,
                                        });
                                    if entry.detail_type.is_none() && detail_type.is_some() {
                                        entry.detail_type = detail_type;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pub fn extract_styles<'a>(
        class: &'a Class<'a>,
        ctx: &SymbolProofContext<'a>,
    ) -> Vec<StyleInfo> {
        let mut styles = Vec::new();

        for element in &class.body.body {
            match element {
                ClassElement::PropertyDefinition(prop)
                    if prop.r#static && prop.key.is_specific_static_name("styles") =>
                {
                    if let Some(val) = &prop.value {
                        Self::collect_styles_from_expr(val, ctx, &mut styles);
                    }
                }
                ClassElement::MethodDefinition(method)
                    if method.r#static
                        && method.kind == MethodDefinitionKind::Get
                        && method.key.is_specific_static_name("styles") =>
                {
                    if let Some(body) = &method.value.body {
                        for stmt in &body.statements {
                            if let Statement::ReturnStatement(ret) = stmt {
                                if let Some(val) = &ret.argument {
                                    Self::collect_styles_from_expr(val, ctx, &mut styles);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        styles
    }

    fn collect_styles_from_expr<'a>(
        expr: &'a Expression<'a>,
        ctx: &SymbolProofContext<'a>,
        styles: &mut Vec<StyleInfo>,
    ) {
        match expr {
            Expression::TaggedTemplateExpression(tagged) => {
                if ctx.is_lit_css_tag(&tagged.tag) {
                    let mut css = String::new();
                    for quasi in &tagged.quasi.quasis {
                        css.push_str(&quasi.value.raw);
                    }
                    styles.push(StyleInfo {
                        css_text: css,
                        is_shared: false,
                        shared_import_path: None,
                    });
                }
            }
            Expression::ArrayExpression(arr) => {
                for elem in &arr.elements {
                    if let Some(e) = elem.as_expression() {
                        Self::collect_styles_from_expr(e, ctx, styles);
                    }
                }
            }
            Expression::Identifier(id) => {
                // Shared style reference: e.g. buttonStyles
                styles.push(StyleInfo {
                    css_text: String::new(),
                    is_shared: true,
                    shared_import_path: Some(id.name.to_string()),
                });
            }
            Expression::CallExpression(call) => {
                let is_unsafe_css = match &call.callee {
                    Expression::Identifier(id) => id.name == "unsafeCSS",
                    Expression::StaticMemberExpression(mem) => mem.property.name == "unsafeCSS",
                    _ => false,
                };
                if is_unsafe_css {
                    if let Some(arg) = call.arguments.first().and_then(|a| a.as_expression()) {
                        let css_text = match arg {
                            Expression::StringLiteral(s) => s.value.to_string(),
                            Expression::TemplateLiteral(t) => {
                                let mut s = String::new();
                                for q in &t.quasis {
                                    s.push_str(&q.value.raw);
                                }
                                s
                            }
                            _ => String::new(),
                        };
                        styles.push(StyleInfo {
                            css_text,
                            is_shared: false,
                            shared_import_path: None,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    pub fn extract_shadow_root_options<'a>(class: &'a Class<'a>) -> Option<ShadowRootOptions> {
        for element in &class.body.body {
            if let ClassElement::PropertyDefinition(prop) = element {
                if prop.r#static && prop.key.is_specific_static_name("shadowRootOptions") {
                    if let Some(Expression::ObjectExpression(obj)) = &prop.value {
                        let mut delegates_focus = false;
                        let mut mode = "open".to_string();

                        for p in &obj.properties {
                            if let ObjectPropertyKind::ObjectProperty(prop_kv) = p {
                                if let Some(k) = prop_kv.key.static_name() {
                                    match k.as_ref() {
                                        "delegatesFocus" => {
                                            delegates_focus =
                                                crate::property::PropertyModelExtractor::evaluate_boolean(
                                                    &prop_kv.value,
                                                )
                                                .unwrap_or(false);
                                        }
                                        "mode" => {
                                            if let Expression::StringLiteral(s) = &prop_kv.value {
                                                mode = s.value.to_string();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }

                        return Some(ShadowRootOptions {
                            delegates_focus,
                            mode,
                        });
                    }
                }
            }
        }
        None
    }
}
