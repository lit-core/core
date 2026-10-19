use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::collections::HashMap;

use crate::analyzer::{compute_part_mask, is_directive_name, is_lit_html_tag, LitSemanticAnalysis};

fn is_event_binding_quasi(quasi_raw: &str) -> bool {
    let trimmed = quasi_raw.trim_end();
    let s = if let Some(stripped) = trimmed.strip_suffix('"') {
        stripped.trim_end()
    } else if let Some(stripped) = trimmed.strip_suffix('\'') {
        stripped.trim_end()
    } else {
        trimmed
    };
    if let Some(eq_pos) = s.rfind('=') {
        let before_eq = s[..eq_pos].trim_end();
        if let Some(at_pos) = before_eq.rfind('@') {
            let event_name = &before_eq[at_pos + 1..];
            if !event_name.is_empty()
                && event_name
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.')
            {
                let before_at = &before_eq[..at_pos];
                if before_at.is_empty()
                    || before_at.ends_with(char::is_whitespace)
                    || before_at.ends_with('<')
                {
                    return true;
                }
            }
        }
        if let Some(lh_pos) = before_eq.rfind("data-lh-") {
            let before_lh = &before_eq[..lh_pos];
            if before_lh.is_empty()
                || before_lh.ends_with(char::is_whitespace)
                || before_lh.ends_with('<')
            {
                return true;
            }
        }
    }
    false
}

fn is_lh_action_call(call: &CallExpression) -> bool {
    match call.callee.without_parentheses() {
        Expression::Identifier(id) => id.name == "__lhAction",
        Expression::StaticMemberExpression(mem) => mem.property.name == "__lhAction",
        _ => false,
    }
}

fn is_directive_expression(expr: &Expression, ctx: Option<&LitSemanticAnalysis>) -> bool {
    match expr {
        Expression::CallExpression(call) => {
            if is_lh_action_call(call) {
                return true;
            }
            if let Some(c) = ctx {
                c.is_directive_call(call)
            } else {
                match &call.callee {
                    Expression::Identifier(id) => is_directive_name(id.name.as_str()),
                    Expression::StaticMemberExpression(mem) => {
                        is_directive_name(mem.property.name.as_str())
                    }
                    _ => false,
                }
            }
        }
        _ => false,
    }
}

pub fn mask_expressions_in_expr<'a>(
    expr: &mut Expression<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&LitSemanticAnalysis>,
    no_change_ident: &str,
) {
    let is_tag = |tag: &Expression| -> bool {
        if let Some(c) = ctx {
            c.is_lit_tag(tag)
        } else {
            is_lit_html_tag(tag)
        }
    };

    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_tag(&tagged.tag) {
                for expr_idx in 0..tagged.quasi.expressions.len() {
                    let quasi_expr = &tagged.quasi.expressions[expr_idx];
                    if let Expression::ConditionalExpression(cond) = quasi_expr {
                        if let Expression::BinaryExpression(bin) = &cond.test {
                            if let Expression::StaticMemberExpression(mem) = &bin.left {
                                if mem.property.name == "__litDirtyMask" {
                                    continue;
                                }
                            }
                        }
                    }

                    if expr_idx < tagged.quasi.quasis.len() {
                        let raw = tagged.quasi.quasis[expr_idx].value.raw.as_str();
                        if is_event_binding_quasi(raw) {
                            continue;
                        }
                    }

                    if is_directive_expression(quasi_expr, ctx) {
                        continue;
                    }

                    let quasi_expr = &mut tagged.quasi.expressions[expr_idx];
                    let mask = compute_part_mask(quasi_expr, reactive_props);
                    let ast = AstBuilder::new(allocator);

                    let this_expr = Expression::new_this_expression(SPAN, &ast);
                    let member_prop = IdentifierName::new(SPAN, "__litDirtyMask", &ast);
                    let member = Expression::new_static_member_expression(
                        SPAN,
                        this_expr,
                        member_prop,
                        false,
                        &ast,
                    );
                    let mask_num = Expression::new_numeric_literal(
                        SPAN,
                        mask as f64,
                        None,
                        NumberBase::Decimal,
                        &ast,
                    );
                    let test = Expression::new_binary_expression(
                        SPAN,
                        member,
                        BinaryOperator::BitwiseAnd,
                        mask_num,
                        &ast,
                    );

                    let placeholder = Expression::new_identifier(
                        SPAN,
                        allocator.alloc_str(no_change_ident),
                        &ast,
                    );
                    let original = std::mem::replace(quasi_expr, placeholder);
                    let conditional = Expression::new_conditional_expression(
                        SPAN,
                        test,
                        original,
                        Expression::new_identifier(
                            SPAN,
                            allocator.alloc_str(no_change_ident),
                            &ast,
                        ),
                        &ast,
                    );
                    *quasi_expr = conditional;
                    *masked_count += 1;
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    mask_expressions_in_expr(
                        quasi_expr,
                        reactive_props,
                        allocator,
                        masked_count,
                        ctx,
                        no_change_ident,
                    );
                }
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            mask_expressions_in_expr(
                &mut paren.expression,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        Expression::ConditionalExpression(cond) => {
            mask_expressions_in_expr(
                &mut cond.test,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_expr(
                &mut cond.consequent,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_expr(
                &mut cond.alternate,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        _ => {}
    }
}

pub fn mask_expressions_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&LitSemanticAnalysis>,
    no_change_ident: &str,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                mask_expressions_in_expr(
                    arg,
                    reactive_props,
                    allocator,
                    masked_count,
                    ctx,
                    no_change_ident,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            mask_expressions_in_expr(
                &mut expr_stmt.expression,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    mask_expressions_in_expr(
                        init,
                        reactive_props,
                        allocator,
                        masked_count,
                        ctx,
                        no_change_ident,
                    );
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                mask_expressions_in_stmt(
                    s,
                    reactive_props,
                    allocator,
                    masked_count,
                    ctx,
                    no_change_ident,
                );
            }
        }
        Statement::IfStatement(if_stmt) => {
            mask_expressions_in_expr(
                &mut if_stmt.test,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_stmt(
                &mut if_stmt.consequent,
                reactive_props,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                mask_expressions_in_stmt(
                    alt,
                    reactive_props,
                    allocator,
                    masked_count,
                    ctx,
                    no_change_ident,
                );
            }
        }
        _ => {}
    }
}

pub fn mask_expressions_in_body<'a>(
    body: &mut FunctionBody<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&LitSemanticAnalysis>,
    no_change_ident: &str,
) {
    for stmt in &mut body.statements {
        mask_expressions_in_stmt(
            stmt,
            reactive_props,
            allocator,
            masked_count,
            ctx,
            no_change_ident,
        );
    }
}
