use napi_derive::napi;
use oxc_allocator::{Allocator, ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::Parser;
use oxc_span::{SourceType, SPAN};
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

fn has_event_options(expr: &Expression) -> bool {
    match expr {
        Expression::CallExpression(call) => match &call.callee {
            Expression::Identifier(ident) => ident.name == "eventOptions",
            Expression::CallExpression(inner_call) => match &inner_call.callee {
                Expression::Identifier(ident) => ident.name == "eventOptions",
                Expression::StaticMemberExpression(mem) => mem.property.name == "eventOptions",
                _ => false,
            },
            Expression::StaticMemberExpression(mem) => mem.property.name == "eventOptions",
            _ => false,
        },
        _ => false,
    }
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

                        if has_event_options(&tagged.quasi.expressions[i]) {
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
                            let ast = AstBuilder::new(allocator);
                            let this_expr = Expression::new_this_expression(SPAN, &ast);
                            let callee = Expression::new_static_member_expression(
                                SPAN,
                                this_expr,
                                IdentifierName::new(SPAN, "__lhAction", &ast),
                                false,
                                &ast,
                            );
                            let dummy_placeholder = Expression::new_this_expression(SPAN, &ast);
                            let original_expr = std::mem::replace(expr_node, dummy_placeholder);
                            let mut args = ArenaVec::new_in(&ast);
                            args.push(Argument::from(original_expr));
                            *expr_node = Expression::new_call_expression(
                                SPAN, callee, None, args, false, &ast,
                            );
                        }

                        // 3. Rewrite next_quasi
                        if i + 1 < tagged.quasi.quasis.len() {
                            let next_quasi = &mut tagged.quasi.quasis[i + 1];
                            let mut next_raw = next_quasi.value.raw.to_string();
                            if quote.is_some()
                                && (next_raw.starts_with('"') || next_raw.starts_with('\''))
                            {
                                next_raw.remove(0);
                            }
                            next_raw.insert(0, q_char);
                            next_quasi.value.raw = allocator.alloc_str(&next_raw).into();
                        }

                        hoisted_events.insert(event_name);
                        *hoisted_count += 1;
                    } else {
                        hoist_events_in_expr(
                            &mut tagged.quasi.expressions[i],
                            source,
                            safe_events,
                            allocator,
                            source_type,
                            hoisted_events,
                            hoisted_count,
                        );
                    }
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    hoist_events_in_expr(
                        quasi_expr,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
        }
        Expression::CallExpression(c) => {
            hoist_events_in_expr(
                &mut c.callee,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
            for arg in &mut c.arguments {
                match arg {
                    Argument::SpreadElement(s) => {
                        hoist_events_in_expr(
                            &mut s.argument,
                            source,
                            safe_events,
                            allocator,
                            source_type,
                            hoisted_events,
                            hoisted_count,
                        );
                    }
                    _ => {
                        if let Some(e) = arg.as_expression_mut() {
                            hoist_events_in_expr(
                                e,
                                source,
                                safe_events,
                                allocator,
                                source_type,
                                hoisted_events,
                                hoisted_count,
                            );
                        }
                    }
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    hoist_events_in_stmt(
                        s,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
            _ => {
                if let Some(expr) = arrow.body.as_expression_mut() {
                    hoist_events_in_expr(
                        expr,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(ref mut body) = func.body {
                for s in &mut body.statements {
                    hoist_events_in_stmt(
                        s,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                match el {
                    ArrayExpressionElement::SpreadElement(s) => {
                        hoist_events_in_expr(
                            &mut s.argument,
                            source,
                            safe_events,
                            allocator,
                            source_type,
                            hoisted_events,
                            hoisted_count,
                        );
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    _ => {
                        if let Some(e) = el.as_expression_mut() {
                            hoist_events_in_expr(
                                e,
                                source,
                                safe_events,
                                allocator,
                                source_type,
                                hoisted_events,
                                hoisted_count,
                            );
                        }
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    hoist_events_in_expr(
                        &mut p.value,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            hoist_events_in_expr(
                &mut p.expression,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
        }
        Expression::ConditionalExpression(c) => {
            hoist_events_in_expr(
                &mut c.test,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
            hoist_events_in_expr(
                &mut c.consequent,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
            hoist_events_in_expr(
                &mut c.alternate,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
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
                hoist_events_in_expr(
                    arg,
                    source,
                    safe_events,
                    allocator,
                    source_type,
                    hoisted_events,
                    hoisted_count,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            hoist_events_in_expr(
                &mut expr_stmt.expression,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    hoist_events_in_expr(
                        init,
                        source,
                        safe_events,
                        allocator,
                        source_type,
                        hoisted_events,
                        hoisted_count,
                    );
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                hoist_events_in_stmt(
                    s,
                    source,
                    safe_events,
                    allocator,
                    source_type,
                    hoisted_events,
                    hoisted_count,
                );
            }
        }
        Statement::IfStatement(if_stmt) => {
            hoist_events_in_expr(
                &mut if_stmt.test,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
            hoist_events_in_stmt(
                &mut if_stmt.consequent,
                source,
                safe_events,
                allocator,
                source_type,
                hoisted_events,
                hoisted_count,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                hoist_events_in_stmt(
                    alt,
                    source,
                    safe_events,
                    allocator,
                    source_type,
                    hoisted_events,
                    hoisted_count,
                );
            }
        }
        _ => {}
    }
}

fn collect_classes_mut<'a, 'b>(stmts: &'b mut [Statement<'a>], out: &mut Vec<&'b mut Class<'a>>) {
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

fn build_reset_lh_actions<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__lhActions", ast),
        false,
        ast,
    );
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target,
        empty_arr,
        ast,
    );
    Statement::new_expression_statement(SPAN, assign, ast)
}

fn build_call_init_event_hoist<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let callee = Expression::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__initLitEventHoist", ast),
        false,
        ast,
    );
    let call =
        Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(ast), false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

fn build_add_listener_statement<'a>(evt: &str, ast: &AstBuilder<'a>) -> Statement<'a> {
    let root_ident = Expression::new_identifier(SPAN, "root", ast);
    let add_event_listener = IdentifierName::new(SPAN, "addEventListener", ast);
    let callee =
        Expression::new_static_member_expression(SPAN, root_ident, add_event_listener, false, ast);

    let mut args = ArenaVec::new_in(ast);
    let evt_str = ast.allocator().alloc_str(evt);
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));

    let e_binding = BindingPattern::new_binding_identifier(SPAN, "e", ast);
    let param = FormalParameter::new_plain(SPAN, e_binding, ast);
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        params_vec,
        None,
        ast,
    );

    let this_expr = Expression::new_this_expression(SPAN, ast);
    let dispatch_prop = IdentifierName::new(SPAN, "__lhDispatch", ast);
    let dispatch_callee =
        Expression::new_static_member_expression(SPAN, this_expr, dispatch_prop, false, ast);

    let mut dispatch_args = ArenaVec::new_in(ast);
    dispatch_args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));
    dispatch_args.push(Argument::from(Expression::new_identifier(SPAN, "e", ast)));

    let dispatch_call =
        Expression::new_call_expression(SPAN, dispatch_callee, None, dispatch_args, false, ast);
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        formal_params,
        None,
        ArrowFunctionBody::from(dispatch_call),
        ast,
    );
    args.push(Argument::from(arrow));

    let call = Expression::new_call_expression(SPAN, callee, None, args, false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

const LIFECYCLE_STUBS: &str = r#"class __D {
  connectedCallback() {
    super.connectedCallback?.();
    this.__initLitEventHoist();
  }
  firstUpdated(changedProperties) {
    super.firstUpdated?.(changedProperties);
    this.__initLitEventHoist();
  }
  willUpdate(changedProperties) {
    this.__lhActions = [];
    super.willUpdate?.(changedProperties);
  }
}"#;

const STATIC_HELPERS: &str = r#"class __D {
  __lhActions = [];
  __lhInitialized = false;

  __initLitEventHoist() {
    if (this.__lhInitialized) return;
    this.__lhInitialized = true;
    const root = this.shadowRoot || this;
  }

  __lhDispatch(eventName, event) {
    const attr = `data-lh-${eventName}`;
    const root = this.shadowRoot || this;
    let stopped = false;
    const origStop = event.stopPropagation;
    if (origStop) {
      event.stopPropagation = function() {
        stopped = true;
        return origStop.apply(this, arguments);
      };
    }
    const path = event.composedPath ? event.composedPath() : [];
    if (path.length > 0) {
      for (const node of path) {
        if (node === root) break;
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) {
          if (node.getRootNode && node.getRootNode() !== root) {
            continue;
          }
          const actionId = Number(node.getAttribute(attr));
          const handler = this.__lhActions && this.__lhActions[actionId];
          if (typeof handler === 'function') {
            handler.call(this, event);
          }
          if (event.cancelBubble || stopped) break;
        }
      }
    } else {
      let target = event.target;
      while (target && target !== root && target.nodeType === 1) {
        if (target.hasAttribute(attr)) {
          if (!target.getRootNode || target.getRootNode() === root) {
            const actionId = Number(target.getAttribute(attr));
            const handler = this.__lhActions && this.__lhActions[actionId];
            if (typeof handler === 'function') {
              handler.call(this, event);
            }
            if (event.cancelBubble || stopped) break;
          }
        }
        target = target.parentElement;
      }
    }
  }

  __lhAction(handler) {
    if (!this.__lhActions) this.__lhActions = [];
    const id = this.__lhActions.length;
    this.__lhActions.push(handler);
    return id;
  }
}"#;

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
                            hoist_events_in_stmt(
                                stmt,
                                source,
                                &safe_event_set,
                                &allocator,
                                source_type,
                                &mut class_hoisted_events,
                                &mut class_hoisted_count,
                            );
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

        let ast = AstBuilder::new(&allocator);

        // Prepend resets and hook calls to existing methods
        for elem in class.body.body.iter_mut() {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(ref mut body) = method.value.body {
                    if method_name == Some("render") || method_name == Some("willUpdate") {
                        body.statements.insert(0, build_reset_lh_actions(&ast));
                    } else if method_name == Some("connectedCallback")
                        || method_name == Some("firstUpdated")
                    {
                        body.statements.insert(0, build_call_init_event_hoist(&ast));
                    }
                }
            }
        }

        // Synthesize missing lifecycle methods
        if !has_connected || !has_first_updated || !has_will_update {
            let p_stubs = Parser::new(&allocator, LIFECYCLE_STUBS, source_type).parse();
            if let Some(Statement::ClassDeclaration(mut d)) =
                p_stubs.program.body.into_iter().next()
            {
                let stubs = std::mem::replace(&mut d.body.body, ArenaVec::new_in(&ast));
                for elem in stubs {
                    let keep = if let ClassElement::MethodDefinition(ref method) = elem {
                        let name = match &method.key {
                            PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                            _ => None,
                        };
                        (!has_connected && name == Some("connectedCallback"))
                            || (!has_first_updated && name == Some("firstUpdated"))
                            || (!has_will_update && name == Some("willUpdate"))
                    } else {
                        false
                    };
                    if keep {
                        class.body.body.push(elem);
                    }
                }
            }
        }

        let mut sorted_class_events: Vec<String> = class_hoisted_events.into_iter().collect();
        sorted_class_events.sort();

        let p_helpers = Parser::new(&allocator, STATIC_HELPERS, source_type).parse();
        if let Some(Statement::ClassDeclaration(mut d_helpers)) =
            p_helpers.program.body.into_iter().next()
        {
            let helpers = std::mem::replace(&mut d_helpers.body.body, ArenaVec::new_in(&ast));
            for mut elem in helpers {
                if let ClassElement::MethodDefinition(ref mut method) = elem {
                    let name = match &method.key {
                        PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                        _ => None,
                    };
                    if name == Some("__initLitEventHoist") {
                        if let Some(ref mut body) = method.value.body {
                            for evt in &sorted_class_events {
                                body.statements
                                    .push(build_add_listener_statement(evt, &ast));
                            }
                        }
                    }
                }
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

    let codegen_result = Codegen::new()
        .with_options(codegen_options)
        .build(&parsed.program);
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
