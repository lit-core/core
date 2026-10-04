use oxc_ast::ast::*;

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

pub fn is_lit_html_tag(tag: &Expression) -> bool {
    match tag {
        Expression::Identifier(ident) => ident.name == "html" || ident.name == "svg",
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "html" || mem.property.name == "svg"
        }
        _ => false,
    }
}

pub fn match_event_attr(quasi_str: &str) -> Option<(usize, String, Option<char>)> {
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

pub fn has_event_options(expr: &Expression) -> bool {
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

pub fn collect_classes_mut<'a, 'b>(
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
