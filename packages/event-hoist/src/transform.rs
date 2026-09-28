use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const SAFE_BUBBLING_EVENTS: &[&str] = &[
    "click",
    "dblclick",
    "contextmenu",
    "input",
    "change",
    "submit",
    "reset",
    "keydown",
    "keyup",
    "keypress",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "touchcancel",
];

#[napi(object)]
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct EventHoistOptions {
    pub events: Option<Vec<String>>,
    pub sourcemap: Option<bool>,
    pub filename: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventHoistResult {
    pub code: String,
    pub map: Option<String>,
    pub hoisted_events_count: u32,
    pub events: Vec<String>,
    pub components_count: u32,
}

fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

fn match_event_attr(quasi_str: &str) -> Option<(usize, String, Option<char>)> {
    let mut chars = quasi_str.chars().rev().peekable();
    let mut quote = None;

    if let Some(&ch) = chars.peek() {
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            chars.next();
        }
    }

    if chars.next() != Some('=') {
        return None;
    }

    let mut event_name_rev = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            event_name_rev.push(ch);
            chars.next();
        } else {
            break;
        }
    }

    if event_name_rev.is_empty() {
        return None;
    }

    if chars.next() != Some('@') {
        return None;
    }

    let event_name: String = event_name_rev.chars().rev().collect();
    let quote_len = if quote.is_some() { 1 } else { 0 };
    let total_matched_len = 1 + event_name.len() + 1 + quote_len;
    let at_offset = quasi_str.len() - total_matched_len;

    Some((at_offset, event_name, quote))
}

fn has_event_options(expr_src: &str) -> bool {
    expr_src.contains("eventOptions(")
}

fn hoist_events_in_expr<'a>(
    expr: &mut Expression<'a>,
    source: &str,
    safe_events: &HashSet<String>,
    allocator: &'a Allocator,
    source_type: SourceType,
    hoisted_events: &mut HashSet<String>,
    hoisted_count: &mut u32,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_lit_html_tag(&tagged.tag) {
                let num_exprs = tagged.quasi.expressions.len();
                for i in 0..num_exprs {
                    let at_info = {
                        let prev_quasi = &tagged.quasi.quasis[i];
                        match_event_attr(&prev_quasi.value.raw)
                    };

                    if let Some((at_offset, event_name, quote)) = at_info {
                        if !safe_events.contains(&event_name) {
                            continue;
                        }

                        let expr_start = tagged.quasi.expressions[i].span().start as usize;
                        let expr_end = tagged.quasi.expressions[i].span().end as usize;
                        if expr_start >= expr_end || expr_end > source.len() {
                            continue;
                        }
                        let expr_src = &source[expr_start..expr_end];
                        if has_event_options(expr_src) {
                            continue;
                        }

                        let q_char = quote.unwrap_or('"');

                        // 1. Rewrite prev_quasi
                        {
                            let prev_quasi = &mut tagged.quasi.quasis[i];
                            let mut raw = prev_quasi.value.raw.to_string();
                            raw.truncate(at_offset);
                            raw.push_str(&format!("data-lh-{}={}", event_name, q_char));
                            prev_quasi.value.raw = allocator.alloc_str(&raw).into();
                        }

                        // 2. Wrap expr in this.__lhAction(...)
                        {
                            let expr_node = &mut tagged.quasi.expressions[i];
                            let wrapped_src = format!("this.__lhAction({})", expr_src);
                            let dummy = format!("let __x = {};", wrapped_src);
                            let p = Parser::new(allocator, allocator.alloc_str(&dummy), source_type).parse();
                            if let Some(Statement::VariableDeclaration(mut v)) = p.program.body.into_iter().next() {
                                if !v.declarations.is_empty() {
                                    if let Some(init) = v.declarations.remove(0).init {
                                        *expr_node = init;
                                    }
                                }
                            }
                        }

                        // 3. Rewrite next_quasi
                        if i + 1 < tagged.quasi.quasis.len() {
                            let next_quasi = &mut tagged.quasi.quasis[i + 1];
                            let mut next_raw = next_quasi.value.raw.to_string();
                            if quote.is_some() {
                                if next_raw.starts_with('"') || next_raw.starts_with('\'') {
                                    next_raw.remove(0);
                                }
                            }
                            next_raw.insert(0, q_char);
                            next_quasi.value.raw = allocator.alloc_str(&next_raw).into();
                        }

                        hoisted_events.insert(event_name);
                        *hoisted_count += 1;
                    } else {
                        hoist_events_in_expr(&mut tagged.quasi.expressions[i], source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                    }
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    hoist_events_in_expr(quasi_expr, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
        }
        Expression::CallExpression(c) => {
            hoist_events_in_expr(&mut c.callee, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            for arg in &mut c.arguments {
                match arg {
                    Argument::SpreadElement(s) => {
                        hoist_events_in_expr(&mut s.argument, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                    }
                    _ => {
                        if let Some(e) = arg.as_expression_mut() {
                            hoist_events_in_expr(e, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                        }
                    }
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    hoist_events_in_stmt(s, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
            _ => {
                if let Some(expr) = arrow.body.as_expression_mut() {
                    hoist_events_in_expr(expr, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(ref mut body) = func.body {
                for s in &mut body.statements {
                    hoist_events_in_stmt(s, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                match el {
                    ArrayExpressionElement::SpreadElement(s) => {
                        hoist_events_in_expr(&mut s.argument, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    _ => {
                        if let Some(e) = el.as_expression_mut() {
                            hoist_events_in_expr(e, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                        }
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    hoist_events_in_expr(&mut p.value, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            hoist_events_in_expr(&mut p.expression, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
        }
        Expression::ConditionalExpression(c) => {
            hoist_events_in_expr(&mut c.test, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            hoist_events_in_expr(&mut c.consequent, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            hoist_events_in_expr(&mut c.alternate, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
        }
        _ => {}
    }
}

fn hoist_events_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    source: &str,
    safe_events: &HashSet<String>,
    allocator: &'a Allocator,
    source_type: SourceType,
    hoisted_events: &mut HashSet<String>,
    hoisted_count: &mut u32,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                hoist_events_in_expr(arg, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            hoist_events_in_expr(&mut expr_stmt.expression, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    hoist_events_in_expr(init, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                hoist_events_in_stmt(s, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            }
        }
        Statement::IfStatement(if_stmt) => {
            hoist_events_in_expr(&mut if_stmt.test, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            hoist_events_in_stmt(&mut if_stmt.consequent, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            if let Some(ref mut alt) = if_stmt.alternate {
                hoist_events_in_stmt(alt, source, safe_events, allocator, source_type, hoisted_events, hoisted_count);
            }
        }
        _ => {}
    }
}

fn collect_classes_mut<'a, 'b>(
    stmts: &'b mut [Statement<'a>],
    out: &mut Vec<&'b mut Class<'a>>,
) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &mut export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &mut export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &mut var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                        out.push(class);
                    }
                }
            }
            _ => {}
        }
    }
}

pub fn transform_code(source: &str, options: EventHoistOptions) -> EventHoistResult {
    // Fast check: must contain html and @
    if !source.contains("html") || !source.contains('@') {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let safe_event_set: HashSet<String> = if let Some(custom_events) = options.events {
        custom_events.into_iter().collect()
    } else {
        SAFE_BUBBLING_EVENTS.iter().map(|s| s.to_string()).collect()
    };

    let allocator = Allocator::default();
    let filename = options.filename.as_deref().unwrap_or("file.ts");
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::ts());

    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut classes = Vec::new();
    collect_classes_mut(&mut parsed.program.body, &mut classes);

    if classes.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut transformed_components_count = 0u32;
    let mut total_hoisted_events_count = 0u32;
    let mut all_unique_events = HashSet::new();

    for class in classes {
        let mut class_hoisted_events = HashSet::new();
        let mut class_hoisted_count = 0u32;

        let mut has_connected = false;
        let mut has_first_updated = false;
        let mut has_will_update = false;

        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") {
                        for stmt in &mut body.statements {
                            hoist_events_in_stmt(stmt, source, &safe_event_set, &allocator, source_type, &mut class_hoisted_events, &mut class_hoisted_count);
                        }
                    } else if method_name == Some("connectedCallback") {
                        has_connected = true;
                    } else if method_name == Some("firstUpdated") {
                        has_first_updated = true;
                    } else if method_name == Some("willUpdate") {
                        has_will_update = true;
                    }
                }
            }
        }

        if class_hoisted_count == 0 {
            continue;
        }

        transformed_components_count += 1;
        total_hoisted_events_count += class_hoisted_count;
        for evt in &class_hoisted_events {
            all_unique_events.insert(evt.clone());
        }

        // Prepend resets and hook calls to existing methods
        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") {
                        let p = Parser::new(&allocator, "this.__lhActions = [];", source_type).parse();
                        if let Some(stmt) = p.program.body.into_iter().next() {
                            body.statements.insert(0, stmt);
                        }
                    } else if method_name == Some("connectedCallback") {
                        let p = Parser::new(&allocator, "this.__initLitEventHoist();", source_type).parse();
                        if let Some(stmt) = p.program.body.into_iter().next() {
                            body.statements.insert(0, stmt);
                        }
                    } else if method_name == Some("firstUpdated") {
                        let p = Parser::new(&allocator, "this.__initLitEventHoist();", source_type).parse();
                        if let Some(stmt) = p.program.body.into_iter().next() {
                            body.statements.insert(0, stmt);
                        }
                    } else if method_name == Some("willUpdate") {
                        let p = Parser::new(&allocator, "this.__lhActions = [];", source_type).parse();
                        if let Some(stmt) = p.program.body.into_iter().next() {
                            body.statements.insert(0, stmt);
                        }
                    }
                }
            }
        }

        // Synthesize missing lifecycle methods
        if !has_connected {
            let m_src = "class __D { connectedCallback() { super.connectedCallback?.(); this.__initLitEventHoist(); } }";
            let p = Parser::new(&allocator, m_src, source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d)) = p.program.body.into_iter().next() {
                if !d.body.body.is_empty() {
                    class.body.body.push(d.body.body.remove(0));
                }
            }
        }

        if !has_first_updated {
            let m_src = "class __D { firstUpdated(changedProperties) { super.firstUpdated?.(changedProperties); this.__initLitEventHoist(); } }";
            let p = Parser::new(&allocator, m_src, source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d)) = p.program.body.into_iter().next() {
                if !d.body.body.is_empty() {
                    class.body.body.push(d.body.body.remove(0));
                }
            }
        }

        if !has_will_update {
            let m_src = "class __D { willUpdate(changedProperties) { this.__lhActions = []; super.willUpdate?.(changedProperties); } }";
            let p = Parser::new(&allocator, m_src, source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d)) = p.program.body.into_iter().next() {
                if !d.body.body.is_empty() {
                    class.body.body.push(d.body.body.remove(0));
                }
            }
        }

        let mut sorted_class_events: Vec<String> = class_hoisted_events.into_iter().collect();
        sorted_class_events.sort();

        let mut listeners_str = String::new();
        for evt in &sorted_class_events {
            listeners_str.push_str(&format!(
                "    root.addEventListener('{}', (e) => this.__lhDispatch('{}', e));\n",
                evt, evt
            ));
        }

        let helpers_str = format!(
            r#"class __D {{
  __lhActions = [];
  __lhInitialized = false;

  __initLitEventHoist() {{
    if (this.__lhInitialized) return;
    this.__lhInitialized = true;
    const root = this.shadowRoot || this;
{}  }}

  __lhDispatch(eventName, event) {{
    const attr = `data-lh-${{eventName}}`;
    const root = this.shadowRoot || this;
    let stopped = false;
    const origStop = event.stopPropagation;
    if (origStop) {{
      event.stopPropagation = function() {{
        stopped = true;
        return origStop.apply(this, arguments);
      }};
    }}
    const path = event.composedPath ? event.composedPath() : [];
    if (path.length > 0) {{
      for (const node of path) {{
        if (node === root) break;
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) {{
          if (node.getRootNode && node.getRootNode() !== root) {{
            continue;
          }}
          const actionId = Number(node.getAttribute(attr));
          const handler = this.__lhActions && this.__lhActions[actionId];
          if (typeof handler === 'function') {{
            handler.call(this, event);
          }}
          if (event.cancelBubble || stopped) break;
        }}
      }}
    }} else {{
      let target = event.target;
      while (target && target !== root && target.nodeType === 1) {{
        if (target.hasAttribute(attr)) {{
          if (!target.getRootNode || target.getRootNode() === root) {{
            const actionId = Number(target.getAttribute(attr));
            const handler = this.__lhActions && this.__lhActions[actionId];
            if (typeof handler === 'function') {{
              handler.call(this, event);
            }}
            if (event.cancelBubble || stopped) break;
          }}
        }}
        target = target.parentElement;
      }}
    }}
  }}

  __lhAction(handler) {{
    if (!this.__lhActions) this.__lhActions = [];
    const id = this.__lhActions.length;
    this.__lhActions.push(handler);
    return id;
  }}
}}"#,
            listeners_str
        );

        let p_helpers = Parser::new(&allocator, allocator.alloc_str(&helpers_str), source_type).parse();
        if let Some(Statement::ClassDeclaration(mut d_helpers)) = p_helpers.program.body.into_iter().next() {
            let elems = std::mem::replace(&mut d_helpers.body.body, oxc_allocator::ArenaVec::new_in(&&allocator));
            for elem in elems {
                class.body.body.push(elem);
            }
        }
    }

    if transformed_components_count == 0 {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut codegen_options = CodegenOptions::default();
    if options.sourcemap.unwrap_or(false) {
        if let Some(ref filename) = options.filename {
            codegen_options.source_map_path = Some(std::path::PathBuf::from(filename));
        }
    }

    let codegen_result = Codegen::new().with_options(codegen_options).build(&parsed.program);
    let map_json = codegen_result.map.map(|m| m.to_json_string());

    let mut sorted_events: Vec<String> = all_unique_events.into_iter().collect();
    sorted_events.sort();

    EventHoistResult {
        code: codegen_result.code,
        map: map_json,
        hoisted_events_count: total_hoisted_events_count,
        events: sorted_events,
        components_count: transformed_components_count,
    }
}
