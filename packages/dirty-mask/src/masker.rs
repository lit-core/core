use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::collections::HashMap;

use crate::analyzer::{compute_part_mask, is_lit_html_tag};

pub fn mask_expressions_in_expr<'a>(
    expr: &mut Expression<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_lit_html_tag(&tagged.tag) {
                for quasi_expr in &mut tagged.quasi.expressions {
                    if let Expression::ConditionalExpression(cond) = quasi_expr {
                        if let Expression::BinaryExpression(bin) = &cond.test {
                            if let Expression::StaticMemberExpression(mem) = &bin.left {
                                if mem.property.name == "__litDirtyMask" {
                                    continue;
                                }
                            }
                        }
                    }

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

                    let placeholder = Expression::new_identifier(SPAN, "noChange", &ast);
                    let original = std::mem::replace(quasi_expr, placeholder);
                    let conditional = Expression::new_conditional_expression(
                        SPAN,
                        test,
                        original,
                        Expression::new_identifier(SPAN, "noChange", &ast),
                        &ast,
                    );
                    *quasi_expr = conditional;
                    *masked_count += 1;
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    mask_expressions_in_expr(quasi_expr, reactive_props, allocator, masked_count);
                }
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            mask_expressions_in_expr(
                &mut paren.expression,
                reactive_props,
                allocator,
                masked_count,
            );
        }
        Expression::ConditionalExpression(cond) => {
            mask_expressions_in_expr(&mut cond.test, reactive_props, allocator, masked_count);
            mask_expressions_in_expr(
                &mut cond.consequent,
                reactive_props,
                allocator,
                masked_count,
            );
            mask_expressions_in_expr(&mut cond.alternate, reactive_props, allocator, masked_count);
        }
        _ => {}
    }
}

pub fn mask_expressions_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                mask_expressions_in_expr(arg, reactive_props, allocator, masked_count);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            mask_expressions_in_expr(
                &mut expr_stmt.expression,
                reactive_props,
                allocator,
                masked_count,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    mask_expressions_in_expr(init, reactive_props, allocator, masked_count);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                mask_expressions_in_stmt(s, reactive_props, allocator, masked_count);
            }
        }
        Statement::IfStatement(if_stmt) => {
            mask_expressions_in_expr(&mut if_stmt.test, reactive_props, allocator, masked_count);
            mask_expressions_in_stmt(
                &mut if_stmt.consequent,
                reactive_props,
                allocator,
                masked_count,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                mask_expressions_in_stmt(alt, reactive_props, allocator, masked_count);
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
) {
    for stmt in &mut body.statements {
        mask_expressions_in_stmt(stmt, reactive_props, allocator, masked_count);
    }
}
