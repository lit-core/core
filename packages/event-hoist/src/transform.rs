use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
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
    expr_src.contains("eventOptions")
        || expr_src.contains("capture:")
        || expr_src.contains("passive:")
        || expr_src.contains("once:")
}

struct EventHoistVisitor<'s> {
    source: &'s str,
    safe_events: &'s HashSet<String>,
    replacements: Vec<(usize, usize, String)>,
    hoisted_events: HashSet<String>,
    hoisted_count: u32,
}

impl<'a, 's> Visit<'a> for EventHoistVisitor<'s> {
    fn visit_tagged_template_expression(&mut self, tagged: &TaggedTemplateExpression<'a>) {
        if is_lit_html_tag(&tagged.tag) {
            let num_exprs = tagged.quasi.expressions.len();
            for i in 0..num_exprs {
                let prev_quasi = &tagged.quasi.quasis[i];
                let expr = &tagged.quasi.expressions[i];

                let quasi_str = &prev_quasi.value.raw;
                if let Some((at_offset, event_name, quote)) = match_event_attr(quasi_str) {
                    if !self.safe_events.contains(&event_name) {
                        continue;
                    }

                    let expr_start = expr.span().start as usize;
                    let expr_end = expr.span().end as usize;
                    let expr_src = &self.source[expr_start..expr_end];

                    if has_event_options(expr_src) {
                        continue;
                    }

                    let attr_start = (prev_quasi.span.start as usize) + at_offset;

                    // Replacement 1: Before expression
                    let before_repl = if quote == Some('\'') {
                        format!("data-lh-{}='${{this.__lhAction(", event_name)
                    } else {
                        format!("data-lh-{}=\"${{this.__lhAction(", event_name)
                    };
                    self.replacements.push((attr_start, expr_start, before_repl));

                    // Replacement 2: After expression, replace closing brace and quote
                    let rest = &self.source[expr_end..];
                    if let Some(brace_idx) = rest.find('}') {
                        let close_start = expr_end;
                        let mut close_end = expr_end + brace_idx + 1;
                        if let Some(q) = quote {
                            let after_brace = &self.source[close_end..];
                            if after_brace.starts_with(q) {
                                close_end += 1;
                            }
                        }

                        let after_repl = if quote == Some('\'') {
                            ")}'".to_string()
                        } else {
                            ")}\"".to_string()
                        };
                        self.replacements.push((close_start, close_end, after_repl));
                    }

                    self.hoisted_events.insert(event_name);
                    self.hoisted_count += 1;
                }
            }
        }

        oxc_ast_visit::walk::walk_tagged_template_expression(self, tagged);
    }
}

fn collect_classes<'a>(stmts: &'a [Statement<'a>], out: &mut Vec<&'a Class<'a>>) {
    for stmt in stmts {
        match stmt {
            Statement::ClassDeclaration(class) => {
                out.push(class);
            }
            Statement::ExportDeclaration(export_decl) => {
                if let Declaration::ClassDeclaration(class) = &export_decl.declaration {
                    out.push(class);
                }
            }
            Statement::ExportDefaultDeclaration(export_decl) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) =
                    &export_decl.declaration
                {
                    out.push(class);
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                for decl in &var_decl.declarations {
                    if let Some(Expression::ClassExpression(class)) = &decl.init {
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

    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let program = &parsed.program;
    let mut classes = Vec::new();
    collect_classes(&program.body, &mut classes);

    if classes.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut total_hoisted_events_count: u32 = 0;
    let mut all_unique_events: HashSet<String> = HashSet::new();
    let mut transformed_components_count: u32 = 0;

    for class in classes {
        let mut visitor = EventHoistVisitor {
            source,
            safe_events: &safe_event_set,
            replacements: Vec::new(),
            hoisted_events: HashSet::new(),
            hoisted_count: 0,
        };

        visitor.visit_class_body(&class.body);

        if visitor.hoisted_count == 0 {
            continue;
        }

        transformed_components_count += 1;
        total_hoisted_events_count += visitor.hoisted_count;
        for evt in &visitor.hoisted_events {
            all_unique_events.insert(evt.clone());
        }

        // Add template replacements
        replacements.extend(visitor.replacements);

        let mut render_method_span: Option<usize> = None;
        let mut connected_method_span: Option<usize> = None;
        let mut first_updated_method_span: Option<usize> = None;
        let mut will_update_method_span: Option<usize> = None;

        for elem in &class.body.body {
            if let ClassElement::MethodDefinition(method) = elem {
                let method_name = match &method.key {
                    PropertyKey::StaticIdentifier(ident) => Some(ident.name.as_str()),
                    _ => None,
                };

                if let Some(body) = &method.value.body {
                    if method_name == Some("render") {
                        render_method_span = Some(body.span.start as usize);
                    } else if method_name == Some("connectedCallback") {
                        connected_method_span = Some(body.span.start as usize);
                    } else if method_name == Some("firstUpdated") {
                        first_updated_method_span = Some(body.span.start as usize);
                    } else if method_name == Some("willUpdate") {
                        will_update_method_span = Some(body.span.start as usize);
                    }
                }
            }
        }

        // Inject resets and hook calls
        if let Some(render_start) = render_method_span {
            replacements.push((
                render_start + 1,
                render_start + 1,
                "\n    this.__lhActions = [];".to_string(),
            ));
        }

        if let Some(conn_start) = connected_method_span {
            replacements.push((
                conn_start + 1,
                conn_start + 1,
                "\n    this.__initLitEventHoist();".to_string(),
            ));
        }

        if let Some(first_start) = first_updated_method_span {
            replacements.push((
                first_start + 1,
                first_start + 1,
                "\n    this.__initLitEventHoist();".to_string(),
            ));
        }

        if let Some(will_start) = will_update_method_span {
            replacements.push((
                will_start + 1,
                will_start + 1,
                "\n    this.__lhActions = [];".to_string(),
            ));
        }

        // Synthesize dispatcher and delegated listener methods before class closing brace
        let class_end = class.body.span.end as usize;
        let mut injected = String::new();

        if connected_method_span.is_none() {
            injected.push_str(
                r#"
  connectedCallback() {
    super.connectedCallback?.();
    this.__initLitEventHoist();
  }
"#,
            );
        }

        if first_updated_method_span.is_none() {
            injected.push_str(
                r#"
  firstUpdated(changedProperties) {
    super.firstUpdated?.(changedProperties);
    this.__initLitEventHoist();
  }
"#,
            );
        }

        if will_update_method_span.is_none() {
            injected.push_str(
                r#"
  willUpdate(changedProperties) {
    this.__lhActions = [];
    super.willUpdate?.(changedProperties);
  }
"#,
            );
        }

        let mut sorted_class_events: Vec<String> = visitor.hoisted_events.into_iter().collect();
        sorted_class_events.sort();

        injected.push_str(
            r#"
  __lhActions = [];
  __lhInitialized = false;

  __initLitEventHoist() {
    if (this.__lhInitialized) return;
    this.__lhInitialized = true;
    const root = this.shadowRoot || this;
"#,
        );

        for evt in &sorted_class_events {
            injected.push_str(&format!(
                "    root.addEventListener('{}', (e) => this.__lhDispatch('{}', e));\n",
                evt, evt
            ));
        }

        injected.push_str(
            r#"  }

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
"#,
        );

        replacements.push((class_end - 1, class_end - 1, injected));
    }

    if replacements.is_empty() {
        return EventHoistResult {
            code: source.to_string(),
            map: None,
            hoisted_events_count: 0,
            events: Vec::new(),
            components_count: 0,
        };
    }

    // Sort replacements descending by start position to safely apply string slices
    replacements.sort_by(|a, b| b.0.cmp(&a.0));

    let mut rewritten = source.to_string();
    for (start, end, repl) in replacements {
        if start <= end && end <= rewritten.len() {
            rewritten.replace_range(start..end, &repl);
        }
    }

    let mut sorted_events: Vec<String> = all_unique_events.into_iter().collect();
    sorted_events.sort();

    EventHoistResult {
        code: rewritten,
        map: None,
        hoisted_events_count: total_hoisted_events_count,
        events: sorted_events,
        components_count: transformed_components_count,
    }
}
