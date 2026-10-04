use oxc_allocator::{Allocator, GetAllocator, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::{GetSpan, SPAN};

use crate::finder::CandidateItem;

pub fn build_memo_block<'a>(
    var_name: &str,
    val_slot: &str,
    dependencies: &[String],
    expr: Expression<'a>,
    ast: &AstBuilder<'a>,
) -> ArenaVec<'a, Statement<'a>> {
    let mut stmts = ArenaVec::new_in(ast);

    // let {var_name};
    let var_ident = ast.allocator().alloc_str(var_name);
    let binding = BindingPattern::new_binding_identifier(SPAN, var_ident, ast);
    let declarator = VariableDeclarator::new(SPAN, binding, None, None, false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(declarator);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        decls,
        false,
        ast,
    ));

    // Guard expression: this.__memo_{dep}_ref === this.{dep}
    let mut guard_opt: Option<Expression<'a>> = None;
    for dep in dependencies {
        let this_l = Expression::new_this_expression(SPAN, ast);
        let prop_l = ast.allocator().alloc_str(&format!("__memo_{}_ref", dep));
        let left = Expression::new_static_member_expression(
            SPAN,
            this_l,
            IdentifierName::new(SPAN, prop_l, ast),
            false,
            ast,
        );

        let this_r = Expression::new_this_expression(SPAN, ast);
        let prop_r = ast.allocator().alloc_str(dep);
        let right = Expression::new_static_member_expression(
            SPAN,
            this_r,
            IdentifierName::new(SPAN, prop_r, ast),
            false,
            ast,
        );

        let eq = Expression::new_binary_expression(
            SPAN,
            left,
            BinaryOperator::StrictEquality,
            right,
            ast,
        );

        guard_opt = match guard_opt {
            None => Some(eq),
            Some(prev) => Some(Expression::new_logical_expression(
                SPAN,
                prev,
                LogicalOperator::And,
                eq,
                ast,
            )),
        };
    }
    let guard = guard_opt.unwrap_or_else(|| Expression::new_boolean_literal(SPAN, false, ast));

    // Consequent block: {var_name} = this.__memo_{val_slot}_val;
    let target = AssignmentTarget::new_assignment_target_identifier(SPAN, var_ident, ast);
    let this_val = Expression::new_this_expression(SPAN, ast);
    let slot_prop = ast
        .allocator()
        .alloc_str(&format!("__memo_{}_val", val_slot));
    let val_member = Expression::new_static_member_expression(
        SPAN,
        this_val,
        IdentifierName::new(SPAN, slot_prop, ast),
        false,
        ast,
    );
    let assign_then = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target,
        val_member,
        ast,
    );
    let mut then_stmts = ArenaVec::new_in(ast);
    then_stmts.push(Statement::new_expression_statement(SPAN, assign_then, ast));
    let then_block = Statement::new_block_statement(SPAN, then_stmts, ast);

    // Alternate block:
    // saves: this.__memo_{dep}_ref = this.{dep};
    let mut else_stmts = ArenaVec::new_in(ast);
    for dep in dependencies {
        let this_l = Expression::new_this_expression(SPAN, ast);
        let prop_l = ast.allocator().alloc_str(&format!("__memo_{}_ref", dep));
        let target = AssignmentTarget::new_static_member_expression(
            SPAN,
            this_l,
            IdentifierName::new(SPAN, prop_l, ast),
            false,
            ast,
        );

        let this_r = Expression::new_this_expression(SPAN, ast);
        let prop_r = ast.allocator().alloc_str(dep);
        let val = Expression::new_static_member_expression(
            SPAN,
            this_r,
            IdentifierName::new(SPAN, prop_r, ast),
            false,
            ast,
        );

        let save_assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::Assign,
            target,
            val,
            ast,
        );
        else_stmts.push(Statement::new_expression_statement(SPAN, save_assign, ast));
    }

    // {var_name} = this.__memo_{val_slot}_val = {expr};
    let this_slot = Expression::new_this_expression(SPAN, ast);
    let slot_target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_slot,
        IdentifierName::new(SPAN, slot_prop, ast),
        false,
        ast,
    );
    let inner_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        slot_target,
        expr,
        ast,
    );
    let outer_target = AssignmentTarget::new_assignment_target_identifier(SPAN, var_ident, ast);
    let outer_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        outer_target,
        inner_assign,
        ast,
    );
    else_stmts.push(Statement::new_expression_statement(SPAN, outer_assign, ast));

    let else_block = Statement::new_block_statement(SPAN, else_stmts, ast);

    // if statement
    stmts.push(Statement::new_if_statement(
        SPAN,
        guard,
        then_block,
        Some(else_block),
        ast,
    ));

    stmts
}

pub fn replace_candidate_exprs<'a>(
    expr: &mut Expression<'a>,
    candidates: &[CandidateItem<'a>],
    allocator: &'a Allocator,
) {
    let start = expr.span().start as usize;
    let end = expr.span().end as usize;
    for cand in candidates {
        if start == cand.expr_start && end == cand.expr_end {
            let ast = AstBuilder::new(allocator);
            let ident = ast.allocator().alloc_str(&cand.var_name);
            *expr = Expression::new_identifier(SPAN, ident, &ast);
            return;
        }
    }

    match expr {
        Expression::TaggedTemplateExpression(tagged) => {
            for quasi_expr in &mut tagged.quasi.expressions {
                replace_candidate_exprs(quasi_expr, candidates, allocator);
            }
        }
        Expression::ParenthesizedExpression(p) => {
            replace_candidate_exprs(&mut p.expression, candidates, allocator);
        }
        Expression::ConditionalExpression(c) => {
            replace_candidate_exprs(&mut c.test, candidates, allocator);
            replace_candidate_exprs(&mut c.consequent, candidates, allocator);
            replace_candidate_exprs(&mut c.alternate, candidates, allocator);
        }
        Expression::CallExpression(c) => {
            replace_candidate_exprs(&mut c.callee, candidates, allocator);
            for arg in &mut c.arguments {
                if let Some(e) = arg.as_expression_mut() {
                    replace_candidate_exprs(e, candidates, allocator);
                }
            }
        }
        Expression::ArrowFunctionExpression(arrow) => match &mut arrow.body {
            ArrowFunctionBody::FunctionBody(body) => {
                for s in &mut body.statements {
                    replace_candidates_in_stmt(s, candidates, allocator);
                }
            }
            _ => {
                if let Some(e) = arrow.body.as_expression_mut() {
                    replace_candidate_exprs(e, candidates, allocator);
                }
            }
        },
        Expression::FunctionExpression(func) => {
            if let Some(ref mut body) = func.body {
                for s in &mut body.statements {
                    replace_candidates_in_stmt(s, candidates, allocator);
                }
            }
        }
        Expression::ArrayExpression(arr) => {
            for el in &mut arr.elements {
                if let Some(e) = el.as_expression_mut() {
                    replace_candidate_exprs(e, candidates, allocator);
                }
            }
        }
        Expression::ObjectExpression(obj) => {
            for prop in &mut obj.properties {
                if let ObjectPropertyKind::ObjectProperty(p) = prop {
                    replace_candidate_exprs(&mut p.value, candidates, allocator);
                }
            }
        }
        _ => {}
    }
}

pub fn replace_candidates_in_stmt<'a>(
    stmt: &mut Statement<'a>,
    candidates: &[CandidateItem<'a>],
    allocator: &'a Allocator,
) {
    match stmt {
        Statement::ReturnStatement(ret) => {
            if let Some(ref mut arg) = ret.argument {
                replace_candidate_exprs(arg, candidates, allocator);
            }
        }
        Statement::ExpressionStatement(expr_stmt) => {
            replace_candidate_exprs(&mut expr_stmt.expression, candidates, allocator);
        }
        Statement::VariableDeclaration(var_decl) => {
            for decl in &mut var_decl.declarations {
                if let Some(ref mut init) = decl.init {
                    replace_candidate_exprs(init, candidates, allocator);
                }
            }
        }
        Statement::BlockStatement(block) => {
            for s in &mut block.body {
                replace_candidates_in_stmt(s, candidates, allocator);
            }
        }
        Statement::IfStatement(if_stmt) => {
            replace_candidate_exprs(&mut if_stmt.test, candidates, allocator);
            replace_candidates_in_stmt(&mut if_stmt.consequent, candidates, allocator);
            if let Some(ref mut alt) = if_stmt.alternate {
                replace_candidates_in_stmt(alt, candidates, allocator);
            }
        }
        _ => {}
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
