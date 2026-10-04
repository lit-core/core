use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub fn build_alias_statement<'a>(
    param: Option<&str>,
    ast: &AstBuilder<'a>,
) -> Option<Statement<'a>> {
    let param = param?;
    if param == "changedProperties" {
        return None;
    }
    let cp_binding = BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast);
    let param_expr = if param.is_empty() {
        let args_ident = Expression::new_identifier(SPAN, "arguments", ast);
        let zero = Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast);
        Expression::new_computed_member_expression(SPAN, args_ident, zero, false, ast)
    } else {
        Expression::new_identifier(SPAN, ast.allocator().alloc_str(param), ast)
    };
    let new_map = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Map", ast),
        None,
        ArenaVec::new_in(ast),
        ast,
    );
    let logical_or =
        Expression::new_logical_expression(SPAN, param_expr, LogicalOperator::Or, new_map, ast);
    let declarator = VariableDeclarator::new(SPAN, cp_binding, None, Some(logical_or), false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(declarator);
    Some(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls,
        false,
        ast,
    ))
}

pub fn build_mask_calc_statements<'a>(
    sorted_props: &[(String, usize)],
    ast: &AstBuilder<'a>,
) -> ArenaVec<'a, Statement<'a>> {
    let mut stmts = ArenaVec::new_in(ast);

    let mask_binding = BindingPattern::new_binding_identifier(SPAN, "mask", ast);
    let zero = Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast);
    let declarator = VariableDeclarator::new(SPAN, mask_binding, None, Some(zero), false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(declarator);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        decls,
        false,
        ast,
    ));

    let mut if_stmts = ArenaVec::new_in(ast);
    for (prop_name, idx) in sorted_props {
        let bit = 1u32 << idx;

        let cp_ident = Expression::new_identifier(SPAN, "changedProperties", ast);
        let has_prop = IdentifierName::new(SPAN, "has", ast);
        let has_member =
            Expression::new_static_member_expression(SPAN, cp_ident, has_prop, false, ast);
        let mut has_args = ArenaVec::new_in(ast);
        has_args.push(Argument::from(Expression::new_string_literal(
            SPAN,
            ast.allocator().alloc_str(prop_name.as_str()),
            None,
            ast,
        )));
        let has_call =
            Expression::new_call_expression(SPAN, has_member, None, has_args, false, ast);

        let mask_target = AssignmentTarget::new_assignment_target_identifier(SPAN, "mask", ast);
        let bit_num =
            Expression::new_numeric_literal(SPAN, bit as f64, None, NumberBase::Decimal, ast);
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::BitwiseOR,
            mask_target,
            bit_num,
            ast,
        );
        let assign_stmt = Statement::new_expression_statement(SPAN, assign, ast);

        if_stmts.push(Statement::new_if_statement(
            SPAN,
            has_call,
            assign_stmt,
            None,
            ast,
        ));
    }

    let if_block = Statement::new_block_statement(SPAN, if_stmts, ast);

    let mask_target = AssignmentTarget::new_assignment_target_identifier(SPAN, "mask", ast);
    let neg_one = Expression::new_numeric_literal(SPAN, -1.0, None, NumberBase::Decimal, ast);
    let neg_one_assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        mask_target,
        neg_one,
        ast,
    );
    let neg_one_stmt = Statement::new_expression_statement(SPAN, neg_one_assign, ast);
    let mut else_stmts = ArenaVec::new_in(ast);
    else_stmts.push(neg_one_stmt);
    let else_block = Statement::new_block_statement(SPAN, else_stmts, ast);

    let this_expr = Expression::new_this_expression(SPAN, ast);
    let has_updated_prop = IdentifierName::new(SPAN, "hasUpdated", ast);
    let has_updated =
        Expression::new_static_member_expression(SPAN, this_expr, has_updated_prop, false, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        has_updated,
        if_block,
        Some(else_block),
        ast,
    ));

    let this_expr2 = Expression::new_this_expression(SPAN, ast);
    let member_prop = IdentifierName::new(SPAN, "__litDirtyMask", ast);
    let target_member =
        AssignmentTarget::new_static_member_expression(SPAN, this_expr2, member_prop, false, ast);
    let assign_mask = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target_member,
        Expression::new_identifier(SPAN, "mask", ast),
        ast,
    );
    stmts.push(Statement::new_expression_statement(SPAN, assign_mask, ast));

    stmts
}

pub fn build_super_update_statement<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let super_expr = Expression::new_super(SPAN, ast);
    let update_prop = IdentifierName::new(SPAN, "update", ast);
    let super_member =
        Expression::new_static_member_expression(SPAN, super_expr, update_prop, false, ast);
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "changedProperties",
        ast,
    )));
    let super_call = Expression::new_call_expression(SPAN, super_member, None, args, false, ast);
    Statement::new_expression_statement(SPAN, super_call, ast)
}

pub fn build_update_method<'a>(
    sorted_props: &[(String, usize)],
    ast: &AstBuilder<'a>,
) -> ClassElement<'a> {
    let mut statements = build_mask_calc_statements(sorted_props, ast);
    statements.push(build_super_update_statement(ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), statements, ast);
    let param_pat = BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast);
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(FormalParameter::new_plain(SPAN, param_pat, ast));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        params_vec,
        None,
        ast,
    );

    let func = Function::boxed(
        SPAN,
        FunctionType::FunctionExpression,
        None,
        false,
        false,
        false,
        None,
        None,
        params,
        None,
        Some(body),
        ast,
    );

    let method_key = PropertyKey::new_static_identifier(SPAN, "update", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        method_key,
        func,
        MethodDefinitionKind::Method,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}
