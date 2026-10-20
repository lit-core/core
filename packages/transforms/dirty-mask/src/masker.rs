use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_ast_visit::Visit;
use oxc_span::SPAN;
use std::collections::{HashMap, HashSet};

use crate::analyzer::compute_part_mask_with_locals;
use lit_analysis::symbol::SymbolProofContext;

fn collect_reassigned_vars(body: &FunctionBody) -> HashSet<String> {
    struct ReassignCollector {
        vars: HashSet<String>,
    }
    impl<'a> Visit<'a> for ReassignCollector {
        fn visit_simple_assignment_target(&mut self, target: &SimpleAssignmentTarget<'a>) {
            if let SimpleAssignmentTarget::AssignmentTargetIdentifier(ident) = target {
                self.vars.insert(ident.name.as_str().to_string());
            }
            oxc_ast_visit::walk::walk_simple_assignment_target(self, target);
        }
    }
    let mut collector = ReassignCollector {
        vars: HashSet::new(),
    };
    collector.visit_function_body(body);
    collector.vars
}

fn update_local_var_masks_from_decl(
    var_decl: &VariableDeclaration,
    reactive_props: &HashMap<String, usize>,
    reassigned_vars: &HashSet<String>,
    local_var_masks: &mut HashMap<String, i32>,
) {
    for decl in &var_decl.declarations {
        match &decl.id {
            BindingPattern::ObjectPattern(obj_pat) => {
                let is_this = decl.init.as_ref().is_some_and(|init| {
                    matches!(init.without_parentheses(), Expression::ThisExpression(_))
                });
                if is_this && obj_pat.rest.is_none() {
                    for prop in &obj_pat.properties {
                        if let (Some(prop_name), BindingPattern::BindingIdentifier(bind_id)) =
                            (prop.key.static_name(), &prop.value)
                        {
                            let local_name = bind_id.name.as_str();
                            if !reassigned_vars.contains(local_name) {
                                let mask = match reactive_props.get(prop_name.as_ref()) {
                                    Some(&idx) if idx < 30 => 1i32 << idx,
                                    _ => -1,
                                };
                                local_var_masks.insert(local_name.to_string(), mask);
                            }
                        }
                    }
                }
            }
            BindingPattern::BindingIdentifier(bind_id) => {
                let local_name = bind_id.name.as_str();
                if !reassigned_vars.contains(local_name) {
                    if let Some(init) = &decl.init {
                        let mask = compute_part_mask_with_locals(
                            init,
                            reactive_props,
                            Some(local_var_masks),
                        );
                        local_var_masks.insert(local_name.to_string(), mask);
                    }
                }
            }
            _ => {}
        }
    }
}

fn is_event_binding_quasi(quasi_raw: &str) -> bool {
    let trimmed = quasi_raw.trim_end();
    if trimmed.ends_with('<') || trimmed.ends_with("</") {
        return true;
    }
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

fn is_directive_expression(expr: &Expression, ctx: Option<&SymbolProofContext>) -> bool {
    match expr {
        Expression::CallExpression(call) => {
            if is_lh_action_call(call) {
                return true;
            }
            if let Some(c) = ctx {
                c.resolve_directive(call).is_some()
            } else {
                false
            }
        }
        _ => false,
    }
}

fn expr_has_positive_mask(
    expr: &Expression,
    reactive_props: &HashMap<String, usize>,
    local_var_masks: &HashMap<String, i32>,
    ctx: Option<&SymbolProofContext>,
) -> bool {
    let is_tag = |tag: &Expression| -> bool {
        if let Some(c) = ctx {
            c.is_lit_html_or_static_tag(tag) || c.is_lit_svg_tag(tag)
        } else {
            false
        }
    };

    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            if is_tag(&tagged.tag) {
                for expr_idx in 0..tagged.quasi.expressions.len() {
                    let quasi_expr = &tagged.quasi.expressions[expr_idx];
                    if expr_idx < tagged.quasi.quasis.len() {
                        let raw = tagged.quasi.quasis[expr_idx].value.raw.as_str();
                        if is_event_binding_quasi(raw) {
                            continue;
                        }
                    }
                    if is_directive_expression(quasi_expr, ctx) {
                        continue;
                    }
                    if compute_part_mask_with_locals(
                        quasi_expr,
                        reactive_props,
                        Some(local_var_masks),
                    ) > 0
                    {
                        return true;
                    }
                }
                false
            } else {
                tagged
                    .quasi
                    .expressions
                    .iter()
                    .any(|e| expr_has_positive_mask(e, reactive_props, local_var_masks, ctx))
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            expr_has_positive_mask(&paren.expression, reactive_props, local_var_masks, ctx)
        }
        Expression::ConditionalExpression(cond) => {
            expr_has_positive_mask(&cond.test, reactive_props, local_var_masks, ctx)
                || expr_has_positive_mask(&cond.consequent, reactive_props, local_var_masks, ctx)
                || expr_has_positive_mask(&cond.alternate, reactive_props, local_var_masks, ctx)
        }
        Expression::LogicalExpression(log) => {
            expr_has_positive_mask(&log.left, reactive_props, local_var_masks, ctx)
                || expr_has_positive_mask(&log.right, reactive_props, local_var_masks, ctx)
        }
        _ => false,
    }
}

fn stmt_has_positive_mask(
    stmt: &Statement,
    reactive_props: &HashMap<String, usize>,
    reassigned_vars: &HashSet<String>,
    local_var_masks: &mut HashMap<String, i32>,
    ctx: Option<&SymbolProofContext>,
) -> bool {
    match stmt {
        Statement::ReturnStatement(ret) => ret
            .argument
            .as_ref()
            .is_some_and(|arg| expr_has_positive_mask(arg, reactive_props, local_var_masks, ctx)),
        Statement::ExpressionStatement(expr_stmt) => {
            expr_has_positive_mask(&expr_stmt.expression, reactive_props, local_var_masks, ctx)
        }
        Statement::VariableDeclaration(var_decl) => {
            update_local_var_masks_from_decl(
                var_decl,
                reactive_props,
                reassigned_vars,
                local_var_masks,
            );
            var_decl.declarations.iter().any(|decl| {
                decl.init.as_ref().is_some_and(|init| {
                    expr_has_positive_mask(init, reactive_props, local_var_masks, ctx)
                })
            })
        }
        Statement::BlockStatement(block) => block.body.iter().any(|s| {
            stmt_has_positive_mask(s, reactive_props, reassigned_vars, local_var_masks, ctx)
        }),
        Statement::IfStatement(if_stmt) => {
            expr_has_positive_mask(&if_stmt.test, reactive_props, local_var_masks, ctx)
                || stmt_has_positive_mask(
                    &if_stmt.consequent,
                    reactive_props,
                    reassigned_vars,
                    local_var_masks,
                    ctx,
                )
                || if_stmt.alternate.as_ref().is_some_and(|alt| {
                    stmt_has_positive_mask(
                        alt,
                        reactive_props,
                        reassigned_vars,
                        local_var_masks,
                        ctx,
                    )
                })
        }
        _ => false,
    }
}

pub fn mask_expressions_in_expr<'a>(
    expr: &mut Expression<'a>,
    reactive_props: &HashMap<String, usize>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&SymbolProofContext>,
    no_change_ident: &str,
) {
    mask_expressions_in_expr_with_locals(
        expr,
        reactive_props,
        None,
        allocator,
        masked_count,
        ctx,
        no_change_ident,
    );
}

fn mask_expressions_in_expr_with_locals<'a>(
    expr: &mut Expression<'a>,
    reactive_props: &HashMap<String, usize>,
    local_var_masks: Option<&HashMap<String, i32>>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&SymbolProofContext>,
    no_change_ident: &str,
) {
    let is_tag = |tag: &Expression| -> bool {
        if let Some(c) = ctx {
            c.is_lit_html_or_static_tag(tag) || c.is_lit_svg_tag(tag)
        } else {
            false
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
                    let mask =
                        compute_part_mask_with_locals(quasi_expr, reactive_props, local_var_masks);
                    if mask <= 0 {
                        mask_expressions_in_expr_with_locals(
                            quasi_expr,
                            reactive_props,
                            local_var_masks,
                            allocator,
                            masked_count,
                            ctx,
                            no_change_ident,
                        );
                        continue;
                    }
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
                    mask_expressions_in_expr_with_locals(
                        quasi_expr,
                        reactive_props,
                        local_var_masks,
                        allocator,
                        masked_count,
                        ctx,
                        no_change_ident,
                    );
                }
            }
        }
        Expression::ParenthesizedExpression(paren) => {
            mask_expressions_in_expr_with_locals(
                &mut paren.expression,
                reactive_props,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        Expression::ConditionalExpression(cond) => {
            mask_expressions_in_expr_with_locals(
                &mut cond.test,
                reactive_props,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_expr_with_locals(
                &mut cond.consequent,
                reactive_props,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_expr_with_locals(
                &mut cond.alternate,
                reactive_props,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        Expression::LogicalExpression(log) => {
            mask_expressions_in_expr_with_locals(
                &mut log.left,
                reactive_props,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_expr_with_locals(
                &mut log.right,
                reactive_props,
                local_var_masks,
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
    ctx: Option<&SymbolProofContext>,
    no_change_ident: &str,
) {
    let reassigned = HashSet::new();
    let mut locals = HashMap::new();
    mask_expressions_in_stmt_with_locals(
        stmt,
        reactive_props,
        &reassigned,
        &mut locals,
        allocator,
        masked_count,
        ctx,
        no_change_ident,
    );
}

#[allow(clippy::too_many_arguments)]
fn mask_expressions_in_stmt_with_locals<'a>(
    stmt: &mut Statement<'a>,
    reactive_props: &HashMap<String, usize>,
    reassigned_vars: &HashSet<String>,
    local_var_masks: &mut HashMap<String, i32>,
    allocator: &'a Allocator,
    masked_count: &mut u32,
    ctx: Option<&SymbolProofContext>,
    no_change_ident: &str,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                mask_expressions_in_expr_with_locals(
                    arg,
                    reactive_props,
                    Some(local_var_masks),
                    allocator,
                    masked_count,
                    ctx,
                    no_change_ident,
                );
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            mask_expressions_in_expr_with_locals(
                &mut expr_stmt.expression,
                reactive_props,
                Some(local_var_masks),
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
        }
        Statement::VariableDeclaration(var_decl) => {
            update_local_var_masks_from_decl(
                var_decl,
                reactive_props,
                reassigned_vars,
                local_var_masks,
            );
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    mask_expressions_in_expr_with_locals(
                        init,
                        reactive_props,
                        Some(local_var_masks),
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
                mask_expressions_in_stmt_with_locals(
                    s,
                    reactive_props,
                    reassigned_vars,
                    local_var_masks,
                    allocator,
                    masked_count,
                    ctx,
                    no_change_ident,
                );
            }
        }
        Statement::IfStatement(if_stmt) => {
            mask_expressions_in_expr_with_locals(
                &mut if_stmt.test,
                reactive_props,
                Some(local_var_masks),
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            mask_expressions_in_stmt_with_locals(
                &mut if_stmt.consequent,
                reactive_props,
                reassigned_vars,
                local_var_masks,
                allocator,
                masked_count,
                ctx,
                no_change_ident,
            );
            if let Some(ref mut alt) = if_stmt.alternate {
                mask_expressions_in_stmt_with_locals(
                    alt,
                    reactive_props,
                    reassigned_vars,
                    local_var_masks,
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
    ctx: Option<&SymbolProofContext>,
    no_change_ident: &str,
) {
    let reassigned_vars = collect_reassigned_vars(body);
    let mut precheck_locals = HashMap::new();
    let has_positive = body.statements.iter().any(|stmt| {
        stmt_has_positive_mask(
            stmt,
            reactive_props,
            &reassigned_vars,
            &mut precheck_locals,
            ctx,
        )
    });
    if !has_positive {
        return;
    }

    let mut local_var_masks = HashMap::new();
    for stmt in &mut body.statements {
        mask_expressions_in_stmt_with_locals(
            stmt,
            reactive_props,
            &reassigned_vars,
            &mut local_var_masks,
            allocator,
            masked_count,
            ctx,
            no_change_ident,
        );
    }
}
