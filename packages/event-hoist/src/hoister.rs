use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::{SourceType, SPAN};
use std::collections::HashSet;

use crate::analyzer::{has_event_options, is_lit_html_tag, match_event_attr};

pub fn hoist_events_in_expr<'a>(
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

pub fn hoist_events_in_stmt<'a>(
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
