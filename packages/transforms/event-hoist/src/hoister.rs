use oxc_allocator::{Allocator, ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;
use std::collections::HashSet;

use lit_analysis::symbol::{CanonicalLitSymbol, SymbolProofContext};

use crate::analyzer::match_event_attr;

pub struct HoistContext<'a, 's> {
    pub safe_events: &'s HashSet<String>,
    pub allocator: &'a Allocator,
    pub symbol_ctx: &'s SymbolProofContext<'s>,
    pub hoisted_events: &'s mut HashSet<String>,
    pub hoisted_count: &'s mut u32,
}

pub fn has_event_options(expr: &Expression, symbol_ctx: &SymbolProofContext) -> bool {
    let mut curr = expr.without_parentheses();
    while let Expression::CallExpression(call) = curr {
        if symbol_ctx.is_proven_decorator(curr) == Some(CanonicalLitSymbol::EventOptionsDecorator) {
            return true;
        }
        curr = call.callee.without_parentheses();
    }
    symbol_ctx.is_proven_decorator(curr) == Some(CanonicalLitSymbol::EventOptionsDecorator)
}

pub fn hoist_events_in_expr<'a>(expr: &mut Expression<'a>, ctx: &mut HoistContext<'a, '_>) {
    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if ctx.symbol_ctx.is_lit_html_or_static_tag(&tagged.tag)
                || ctx.symbol_ctx.is_lit_svg_tag(&tagged.tag)
            {
                let num_exprs = tagged.quasi.expressions.len();
                for i in 0..num_exprs {
                    let at_info = {
                        let prev_quasi = &tagged.quasi.quasis[i];
                        match_event_attr(&prev_quasi.value.raw)
                    };

                    if let Some((at_offset, event_name, quote)) = at_info {
                        if !ctx.safe_events.contains(&event_name) {
                            continue;
                        }

                        if has_event_options(&tagged.quasi.expressions[i], ctx.symbol_ctx) {
                            continue;
                        }

                        let q_char = quote.unwrap_or('"');
                        let ast = AstBuilder::new(ctx.allocator);

                        // 1. Rewrite prev_quasi via AstBuilder
                        let prev_raw = tagged.quasi.quasis[i].value.raw.as_str();
                        let prefix = &prev_raw[..at_offset];
                        let mut prev_buf =
                            String::with_capacity(prefix.len() + 9 + event_name.len() + 1);
                        prev_buf.push_str(prefix);
                        prev_buf.push_str("data-lh-");
                        prev_buf.push_str(&event_name);
                        prev_buf.push('=');
                        prev_buf.push(q_char);
                        let new_prev_raw = ctx.allocator.alloc_str(&prev_buf);
                        let prev_tail = tagged.quasi.quasis[i].tail;
                        tagged.quasi.quasis[i] = TemplateElement::new(
                            SPAN,
                            TemplateElementValue {
                                raw: new_prev_raw.into(),
                                cooked: Some(new_prev_raw.into()),
                            },
                            prev_tail,
                            &ast,
                        );

                        // 2. Wrap expr in this.__lhAction(...)
                        {
                            let expr_node = &mut tagged.quasi.expressions[i];
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

                        // 3. Rewrite next_quasi via AstBuilder
                        if i + 1 < tagged.quasi.quasis.len() {
                            let next_orig_raw = tagged.quasi.quasis[i + 1].value.raw.as_str();
                            let rest = if quote.is_some()
                                && (next_orig_raw.starts_with('"')
                                    || next_orig_raw.starts_with('\''))
                            {
                                &next_orig_raw[1..]
                            } else {
                                next_orig_raw
                            };
                            let mut next_buf = String::with_capacity(1 + rest.len());
                            next_buf.push(q_char);
                            next_buf.push_str(rest);
                            let new_next_raw = ctx.allocator.alloc_str(&next_buf);
                            let next_tail = tagged.quasi.quasis[i + 1].tail;
                            tagged.quasi.quasis[i + 1] = TemplateElement::new(
                                SPAN,
                                TemplateElementValue {
                                    raw: new_next_raw.into(),
                                    cooked: Some(new_next_raw.into()),
                                },
                                next_tail,
                                &ast,
                            );
                        }

                        ctx.hoisted_events.insert(event_name);
                        *ctx.hoisted_count += 1;
                    } else {
                        hoist_events_in_expr(&mut tagged.quasi.expressions[i], ctx);
                    }
                }
            } else {
                for quasi_expr in &mut tagged.quasi.expressions {
                    hoist_events_in_expr(quasi_expr, ctx);
                }
            }
        }
        Expression::CallExpression(c) => {
            hoist_events_in_expr(&mut c.callee, ctx);
            for arg in &mut c.arguments {
                match arg {
                    Argument::SpreadElement(s) => {
                        hoist_events_in_expr(&mut s.argument, ctx);
                    }
                    _ => {
                        if let Some(e) = arg.as_expression_mut() {
                            hoist_events_in_expr(e, ctx);
                        }
                    }
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    hoist_events_in_stmt(s, ctx);
                }
            }
            _ => {
                if let Some(expr) = arrow.body.as_expression_mut() {
                    hoist_events_in_expr(expr, ctx);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(ref mut body) = func.body {
                for s in &mut body.statements {
                    hoist_events_in_stmt(s, ctx);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                match el {
                    ArrayExpressionElement::SpreadElement(s) => {
                        hoist_events_in_expr(&mut s.argument, ctx);
                    }
                    ArrayExpressionElement::Elision(_) => {}
                    _ => {
                        if let Some(e) = el.as_expression_mut() {
                            hoist_events_in_expr(e, ctx);
                        }
                    }
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    hoist_events_in_expr(&mut p.value, ctx);
                }
            }
        }
        Expression::ParenthesizedExpression(p) => {
            hoist_events_in_expr(&mut p.expression, ctx);
        }
        Expression::ConditionalExpression(c) => {
            hoist_events_in_expr(&mut c.test, ctx);
            hoist_events_in_expr(&mut c.consequent, ctx);
            hoist_events_in_expr(&mut c.alternate, ctx);
        }
        Expression::LogicalExpression(l) => {
            hoist_events_in_expr(&mut l.left, ctx);
            hoist_events_in_expr(&mut l.right, ctx);
        }
        _ => {}
    }
}

pub fn hoist_events_in_stmt<'a>(stmt: &mut Statement<'a>, ctx: &mut HoistContext<'a, '_>) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                hoist_events_in_expr(arg, ctx);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            hoist_events_in_expr(&mut expr_stmt.expression, ctx);
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    hoist_events_in_expr(init, ctx);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                hoist_events_in_stmt(s, ctx);
            }
        }
        Statement::IfStatement(if_stmt) => {
            hoist_events_in_expr(&mut if_stmt.test, ctx);
            hoist_events_in_stmt(&mut if_stmt.consequent, ctx);
            if let Some(ref mut alt) = if_stmt.alternate {
                hoist_events_in_stmt(alt, ctx);
            }
        }
        _ => {}
    }
}
