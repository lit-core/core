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

pub fn match_event_attr(quasi_str: &str) -> Option<(usize, String, Option<char>)> {
    let bytes = quasi_str.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let mut idx = bytes.len();

    let quote = if bytes[idx - 1] == b'"' || bytes[idx - 1] == b'\'' {
        let q = bytes[idx - 1] as char;
        idx -= 1;
        Some(q)
    } else {
        None
    };

    if idx == 0 || bytes[idx - 1] != b'=' {
        return None;
    }
    idx -= 1;

    let end_event = idx;
    while idx > 0 {
        let b = bytes[idx - 1];
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            idx -= 1;
        } else {
            break;
        }
    }

    if idx == end_event {
        return None;
    }

    if idx == 0 || bytes[idx - 1] != b'@' {
        return None;
    }
    idx -= 1;

    let at_offset = idx;
    let event_name = quasi_str[at_offset + 1..end_event].to_string();

    Some((at_offset, event_name, quote))
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
            Statement::ExportDeclaration(export_decl) => match &mut export_decl.declaration {
                Declaration::ClassDeclaration(class) => {
                    out.push(class);
                }
                Declaration::VariableDeclaration(var_decl) => {
                    for decl in &mut var_decl.declarations {
                        if let Some(Expression::ClassExpression(class)) = &mut decl.init {
                            out.push(class);
                        }
                    }
                }
                _ => {}
            },
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
