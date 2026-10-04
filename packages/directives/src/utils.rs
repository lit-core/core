use oxc_ast::ast::*;

pub fn camel_to_kebab(s: &str) -> String {
    if s.starts_with("--") {
        return s.to_string();
    }
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() {
            out.push('-');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

pub fn extract_arrow_expr<'a>(
    arrow: &'a ArrowFunctionExpression<'a>,
) -> Option<&'a Expression<'a>> {
    if !arrow.params.items.is_empty() {
        return None;
    }
    if let Some(expr) = arrow.body.as_expression() {
        return Some(expr);
    }
    if let ArrowFunctionBody::FunctionBody(b) = &arrow.body {
        if let Some(first_stmt) = b.statements.first() {
            match first_stmt {
                Statement::ExpressionStatement(e) => return Some(&e.expression),
                Statement::ReturnStatement(r) => return r.argument.as_ref(),
                _ => {}
            }
        }
    }
    None
}
