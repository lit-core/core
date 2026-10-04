use oxc_allocator::{ArenaVec, CloneIn, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::ast_helpers::AstHelper;
use crate::lit_import_scanner::{ImportContext, LitDecoratorKind};

pub fn try_transform_expression_statement<'a>(
    expr_stmt: &mut ExpressionStatement<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Vec<Statement<'a>>> {
    match &mut expr_stmt.expression {
        Expression::CallExpression(call) => try_transform_decorate_call(call, import_ctx, ast),
        Expression::AssignmentExpression(assign) => {
            if let Expression::CallExpression(call) = &assign.right {
                try_transform_decorate_call(call, import_ctx, ast)
            } else {
                None
            }
        }
        Expression::SequenceExpression(seq) => {
            let mut out_stmts = Vec::new();
            let mut any_transformed = false;
            for expr in &seq.expressions {
                if let Expression::CallExpression(call) = expr {
                    if let Some(stmts) = try_transform_decorate_call(call, import_ctx, ast) {
                        out_stmts.extend(stmts);
                        any_transformed = true;
                        continue;
                    }
                }
                out_stmts.push(Statement::new_expression_statement(
                    SPAN,
                    expr.clone_in(ast.allocator()),
                    ast,
                ));
            }
            if any_transformed {
                Some(out_stmts)
            } else {
                None
            }
        }
        _ => None,
    }
}

pub fn try_transform_decorate_call<'a>(
    call: &CallExpression<'a>,
    import_ctx: &ImportContext,
    ast: &AstBuilder<'a>,
) -> Option<Vec<Statement<'a>>> {
    if call.arguments.len() < 2 {
        return None;
    }

    let first_arg = call.arguments.first()?;
    let Expression::ArrayExpression(arr) = first_arg.as_expression()? else {
        return None;
    };
    if arr.elements.is_empty() {
        return None;
    }

    let is_decorate = match &call.callee {
        Expression::Identifier(id) => {
            id.name == "__decorate" || id.name == "__decorateClass" || id.name == "_ts_decorate"
        }
        Expression::StaticMemberExpression(mem) => {
            mem.property.name == "__decorate" || mem.property.name == "decorate"
        }
        _ => false,
    };
    if !is_decorate {
        return None;
    }

    let second_arg = call.arguments.get(1)?;
    let target_expr = second_arg.as_expression()?;
    let helper = AstHelper::new(ast);

    // Case 1: Member decorator (__decorate([dec], Target.prototype, "key", void 0))
    if call.arguments.len() >= 3 {
        let class_expr = match target_expr {
            Expression::StaticMemberExpression(target_mem) => {
                if target_mem.property.name != "prototype" {
                    return None; // static member decorator -> bail (N7)
                }
                target_mem.object.clone_in(ast.allocator())
            }
            _ => return None, // non-prototype target -> bail (N7)
        };

        let third_arg = call.arguments.get(2)?;
        let prop_name = match third_arg.as_expression()? {
            Expression::StringLiteral(str_lit) => str_lit.value.as_str(),
            _ => return None, // identifier or computed key -> bail (N6)
        };

        let mut lowered_stmts = Vec::new();

        for elem in &arr.elements {
            let Some(Expression::CallExpression(dec_call)) = elem.as_expression() else {
                return None; // Non-call decorator or unlowered -> bail all-or-nothing
            };

            let dec_name = match &dec_call.callee {
                Expression::Identifier(id) => id.name.as_str(),
                Expression::StaticMemberExpression(mem) => mem.property.name.as_str(),
                _ => return None,
            };

            if dec_name == "__metadata" || dec_name == "metadata" {
                continue;
            }

            let Some(kind) = import_ctx.get_decorator_kind(dec_name) else {
                return None; // Unknown or unimported decorator -> bail all-or-nothing
            };

            match kind {
                LitDecoratorKind::Property => {
                    let opt_arg = dec_call
                        .arguments
                        .first()
                        .and_then(|a| a.as_expression())
                        .map(|e| e.clone_in(ast.allocator()));

                    let stmt = helper.create_property_call(
                        class_expr.clone_in(ast.allocator()),
                        ast.allocator().alloc_str(prop_name),
                        opt_arg,
                    );
                    lowered_stmts.push(stmt);
                }
                LitDecoratorKind::State => {
                    let state_key = PropertyKey::new_static_identifier(SPAN, "state", ast);
                    let true_val = Expression::new_boolean_literal(SPAN, true, ast);
                    let obj_prop = ObjectPropertyKind::new_object_property(
                        SPAN,
                        PropertyKind::Init,
                        state_key,
                        true_val,
                        false,
                        false,
                        false,
                        ast,
                    );
                    let mut props = ArenaVec::new_in(ast);
                    props.push(obj_prop);
                    let state_obj = Expression::new_object_expression(SPAN, props, ast);

                    let stmt = helper.create_property_call(
                        class_expr.clone_in(ast.allocator()),
                        ast.allocator().alloc_str(prop_name),
                        Some(state_obj),
                    );
                    lowered_stmts.push(stmt);
                }
                LitDecoratorKind::Query => {
                    let selector_arg = dec_call.arguments.first()?;
                    let selector_str = match selector_arg.as_expression()? {
                        Expression::StringLiteral(str_lit) => str_lit.value.as_str(),
                        Expression::TemplateLiteral(tmpl)
                            if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                        {
                            tmpl.quasis[0]
                                .value
                                .cooked
                                .as_ref()
                                .map(|s| s.as_str())
                                .unwrap_or(tmpl.quasis[0].value.raw.as_str())
                        }
                        _ => return None,
                    };

                    let this = helper.this_expr();
                    let render_root = helper.static_member(this, "renderRoot", false);
                    let query_selector_member =
                        helper.static_member(render_root, "querySelector", true);
                    let mut q_args = ArenaVec::new_in(ast);
                    q_args.push(Argument::from(
                        helper.string_lit(ast.allocator().alloc_str(selector_str)),
                    ));
                    let query_call = helper.call_expr(query_selector_member, q_args, false);
                    let null_expr = helper.null_lit();
                    let return_expr = helper.nullish_coalescing(query_call, null_expr);

                    let stmt = helper.define_getter(
                        target_expr.clone_in(ast.allocator()),
                        ast.allocator().alloc_str(prop_name),
                        return_expr,
                    );
                    lowered_stmts.push(stmt);
                }
                LitDecoratorKind::QueryAll => {
                    let selector_arg = dec_call.arguments.first()?;
                    let selector_str = match selector_arg.as_expression()? {
                        Expression::StringLiteral(str_lit) => str_lit.value.as_str(),
                        Expression::TemplateLiteral(tmpl)
                            if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                        {
                            tmpl.quasis[0]
                                .value
                                .cooked
                                .as_ref()
                                .map(|s| s.as_str())
                                .unwrap_or(tmpl.quasis[0].value.raw.as_str())
                        }
                        _ => return None,
                    };

                    let this = helper.this_expr();
                    let render_root = helper.static_member(this, "renderRoot", false);
                    let query_selector_all_member =
                        helper.static_member(render_root, "querySelectorAll", true);
                    let mut q_args = ArenaVec::new_in(ast);
                    q_args.push(Argument::from(
                        helper.string_lit(ast.allocator().alloc_str(selector_str)),
                    ));
                    let query_call = helper.call_expr(query_selector_all_member, q_args, false);
                    let empty_arr = helper.empty_array();
                    let return_expr = helper.nullish_coalescing(query_call, empty_arr);

                    let stmt = helper.define_getter(
                        target_expr.clone_in(ast.allocator()),
                        ast.allocator().alloc_str(prop_name),
                        return_expr,
                    );
                    lowered_stmts.push(stmt);
                }
                LitDecoratorKind::QueryAssignedElements | LitDecoratorKind::QueryAssignedNodes => {
                    let (slot_name, flatten, selector) =
                        crate::decorators::query_assigned::extract_query_assigned_options(
                            &Expression::CallExpression(dec_call.clone_in(ast.allocator())),
                        );
                    let method = if kind == LitDecoratorKind::QueryAssignedElements {
                        "assignedElements"
                    } else {
                        "assignedNodes"
                    };
                    let return_expr =
                        crate::decorators::query_assigned::build_query_assigned_return_expr(
                            method,
                            slot_name.as_deref(),
                            flatten,
                            selector.as_deref(),
                            ast,
                        );

                    let stmt = helper.define_getter(
                        target_expr.clone_in(ast.allocator()),
                        ast.allocator().alloc_str(prop_name),
                        return_expr,
                    );
                    lowered_stmts.push(stmt);
                }
                _ => return None,
            }
        }

        if lowered_stmts.is_empty() {
            None
        } else {
            Some(lowered_stmts)
        }
    } else {
        // Case 2: Class decorator (__decorate([customElement("tag")], Target))
        let mut lowered_stmts = Vec::new();

        for elem in &arr.elements {
            let Some(Expression::CallExpression(dec_call)) = elem.as_expression() else {
                return None; // Non-call or unknown -> bail all-or-nothing
            };

            let dec_name = match &dec_call.callee {
                Expression::Identifier(id) => id.name.as_str(),
                Expression::StaticMemberExpression(mem) => mem.property.name.as_str(),
                _ => return None,
            };

            if dec_name == "__metadata" || dec_name == "metadata" {
                continue;
            }

            let Some(kind) = import_ctx.get_decorator_kind(dec_name) else {
                return None; // Unknown or unimported decorator -> bail all-or-nothing (N8)
            };

            match kind {
                LitDecoratorKind::CustomElement => {
                    let tag_arg = dec_call.arguments.first()?;
                    let tag_str = match tag_arg.as_expression()? {
                        Expression::StringLiteral(str_lit) => str_lit.value.as_str(),
                        Expression::TemplateLiteral(tmpl)
                            if tmpl.expressions.is_empty() && !tmpl.quasis.is_empty() =>
                        {
                            tmpl.quasis[0]
                                .value
                                .cooked
                                .as_ref()
                                .map(|s| s.as_str())
                                .unwrap_or(tmpl.quasis[0].value.raw.as_str())
                        }
                        _ => return None,
                    };

                    let stmt = helper.custom_elements_define(
                        ast.allocator().alloc_str(tag_str),
                        target_expr.clone_in(ast.allocator()),
                    );
                    lowered_stmts.push(stmt);
                }
                _ => return None, // Non-class decorator on class target -> bail
            }
        }

        if lowered_stmts.is_empty() {
            None
        } else {
            Some(lowered_stmts)
        }
    }
}
