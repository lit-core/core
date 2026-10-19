use oxc_allocator::{Allocator, GetAllocator, Vec as ArenaVec};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

use crate::finder::CandidateItem;

pub fn memo_ref_prop_name(dep: &str) -> String {
    let mut s = String::with_capacity(7 + dep.len() + 4);
    s.push_str("__memo_");
    s.push_str(dep);
    s.push_str("_ref");
    s
}

pub fn memo_val_prop_name(val_slot: &str) -> String {
    let mut s = String::with_capacity(7 + val_slot.len() + 4);
    s.push_str("__memo_");
    s.push_str(val_slot);
    s.push_str("_val");
    s
}

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
        let prop_name = memo_ref_prop_name(dep);
        let prop_l = ast.allocator().alloc_str(&prop_name);
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
    let val_slot_name = memo_val_prop_name(val_slot);
    let slot_prop = ast.allocator().alloc_str(&val_slot_name);
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
        let dep_ref_name = memo_ref_prop_name(dep);
        let prop_l = ast.allocator().alloc_str(&dep_ref_name);
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

pub fn expr_structurally_equal(a: &Expression, b: &Expression) -> bool {
    match (a, b) {
        (Expression::CallExpression(c1), Expression::CallExpression(c2)) => {
            if c1.arguments.len() != c2.arguments.len() {
                return false;
            }
            if !expr_structurally_equal(&c1.callee, &c2.callee) {
                return false;
            }
            for (arg1, arg2) in c1.arguments.iter().zip(c2.arguments.iter()) {
                match (arg1, arg2) {
                    (Argument::SpreadElement(s1), Argument::SpreadElement(s2)) => {
                        if !expr_structurally_equal(&s1.argument, &s2.argument) {
                            return false;
                        }
                    }
                    _ => match (arg1.as_expression(), arg2.as_expression()) {
                        (Some(e1), Some(e2)) => {
                            if !expr_structurally_equal(e1, e2) {
                                return false;
                            }
                        }
                        _ => return false,
                    },
                }
            }
            true
        }
        (Expression::StaticMemberExpression(m1), Expression::StaticMemberExpression(m2)) => {
            m1.property.name == m2.property.name && expr_structurally_equal(&m1.object, &m2.object)
        }
        (Expression::ComputedMemberExpression(m1), Expression::ComputedMemberExpression(m2)) => {
            expr_structurally_equal(&m1.object, &m2.object)
                && expr_structurally_equal(&m1.expression, &m2.expression)
        }
        (Expression::Identifier(i1), Expression::Identifier(i2)) => i1.name == i2.name,
        (Expression::ThisExpression(_), Expression::ThisExpression(_)) => true,
        (Expression::NumericLiteral(n1), Expression::NumericLiteral(n2)) => n1.value == n2.value,
        (Expression::StringLiteral(s1), Expression::StringLiteral(s2)) => s1.value == s2.value,
        (Expression::BooleanLiteral(b1), Expression::BooleanLiteral(b2)) => b1.value == b2.value,
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::BinaryExpression(b1), Expression::BinaryExpression(b2)) => {
            b1.operator == b2.operator
                && expr_structurally_equal(&b1.left, &b2.left)
                && expr_structurally_equal(&b1.right, &b2.right)
        }
        (Expression::UnaryExpression(u1), Expression::UnaryExpression(u2)) => {
            u1.operator == u2.operator && expr_structurally_equal(&u1.argument, &u2.argument)
        }
        (Expression::ArrayExpression(a1), Expression::ArrayExpression(a2)) => {
            if a1.elements.len() != a2.elements.len() {
                return false;
            }
            for (el1, el2) in a1.elements.iter().zip(a2.elements.iter()) {
                match (el1, el2) {
                    (
                        ArrayExpressionElement::SpreadElement(s1),
                        ArrayExpressionElement::SpreadElement(s2),
                    ) => {
                        if !expr_structurally_equal(&s1.argument, &s2.argument) {
                            return false;
                        }
                    }
                    _ => match (el1.as_expression(), el2.as_expression()) {
                        (Some(e1), Some(e2)) => {
                            if !expr_structurally_equal(e1, e2) {
                                return false;
                            }
                        }
                        _ => return false,
                    },
                }
            }
            true
        }
        (Expression::ArrowFunctionExpression(a1), Expression::ArrowFunctionExpression(a2)) => {
            if a1.params.parameters_count() != a2.params.parameters_count() {
                return false;
            }
            for (p1, p2) in a1.params.items.iter().zip(a2.params.items.iter()) {
                let name1 = match &p1.pattern {
                    BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
                    _ => None,
                };
                let name2 = match &p2.pattern {
                    BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
                    _ => None,
                };
                if name1 != name2 {
                    return false;
                }
            }
            match (&a1.body, &a2.body) {
                (ArrowFunctionBody::FunctionBody(b1), ArrowFunctionBody::FunctionBody(b2)) => {
                    b1.statements.len() == b2.statements.len()
                }
                _ => match (a1.body.as_expression(), a2.body.as_expression()) {
                    (Some(e1), Some(e2)) => expr_structurally_equal(e1, e2),
                    _ => false,
                },
            }
        }
        (Expression::ParenthesizedExpression(p1), Expression::ParenthesizedExpression(p2)) => {
            expr_structurally_equal(&p1.expression, &p2.expression)
        }
        (Expression::TaggedTemplateExpression(t1), Expression::TaggedTemplateExpression(t2)) => {
            if !expr_structurally_equal(&t1.tag, &t2.tag) {
                return false;
            }
            if t1.quasi.quasis.len() != t2.quasi.quasis.len() {
                return false;
            }
            for (q1, q2) in t1.quasi.quasis.iter().zip(t2.quasi.quasis.iter()) {
                if q1.value.raw != q2.value.raw {
                    return false;
                }
            }
            if t1.quasi.expressions.len() != t2.quasi.expressions.len() {
                return false;
            }
            for (e1, e2) in t1.quasi.expressions.iter().zip(t2.quasi.expressions.iter()) {
                if !expr_structurally_equal(e1, e2) {
                    return false;
                }
            }
            true
        }
        (Expression::LogicalExpression(l1), Expression::LogicalExpression(l2)) => {
            l1.operator == l2.operator
                && expr_structurally_equal(&l1.left, &l2.left)
                && expr_structurally_equal(&l1.right, &l2.right)
        }
        (Expression::ObjectExpression(o1), Expression::ObjectExpression(o2)) => {
            if o1.properties.len() != o2.properties.len() {
                return false;
            }
            for (p1, p2) in o1.properties.iter().zip(o2.properties.iter()) {
                match (p1, p2) {
                    (
                        ObjectPropertyKind::ObjectProperty(prop1),
                        ObjectPropertyKind::ObjectProperty(prop2),
                    ) => {
                        let name1 = match &prop1.key {
                            PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                            _ => None,
                        };
                        let name2 = match &prop2.key {
                            PropertyKey::StaticIdentifier(id) => Some(id.name.as_str()),
                            _ => None,
                        };
                        if name1 != name2 {
                            return false;
                        }
                        if !expr_structurally_equal(&prop1.value, &prop2.value) {
                            return false;
                        }
                    }
                    _ => return false,
                }
            }
            true
        }
        _ => false,
    }
}

pub fn replace_candidate_exprs<'a>(
    expr: &mut Expression<'a>,
    candidates: &[CandidateItem<'a>],
    allocator: &'a Allocator,
) {
    for cand in candidates {
        if expr_structurally_equal(expr, &cand.expr) {
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
