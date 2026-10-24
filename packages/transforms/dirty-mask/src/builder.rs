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
    _class_name: Option<&str>,
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
    let is_consecutive = sorted_props
        .iter()
        .enumerate()
        .all(|(i, (_, idx))| i == *idx && *idx < 32);

    if sorted_props.len() >= 4 && is_consecutive {
        let mut elems = ArenaVec::new_in(ast);
        for (prop_name, _) in sorted_props {
            elems.push(ArrayExpressionElement::from(
                Expression::new_string_literal(
                    SPAN,
                    ast.allocator().alloc_str(prop_name.as_str()),
                    None,
                    ast,
                ),
            ));
        }
        let arr_expr = Expression::new_array_expression(SPAN, elems, ast);
        let for_each_member = Expression::new_static_member_expression(
            SPAN,
            arr_expr,
            IdentifierName::new(SPAN, "forEach", ast),
            false,
            ast,
        );

        let cp_ident = Expression::new_identifier(SPAN, "changedProperties", ast);
        let has_member = Expression::new_static_member_expression(
            SPAN,
            cp_ident,
            IdentifierName::new(SPAN, "has", ast),
            false,
            ast,
        );
        let mut has_args = ArenaVec::new_in(ast);
        has_args.push(Argument::from(Expression::new_identifier(SPAN, "p", ast)));
        let has_call =
            Expression::new_call_expression(SPAN, has_member, None, has_args, false, ast);

        let mask_target = AssignmentTarget::new_assignment_target_identifier(SPAN, "mask", ast);
        let shift_expr = Expression::new_binary_expression(
            SPAN,
            Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
            BinaryOperator::ShiftLeft,
            Expression::new_identifier(SPAN, "i", ast),
            ast,
        );
        let assign = Expression::new_assignment_expression(
            SPAN,
            AssignmentOperator::BitwiseOR,
            mask_target,
            shift_expr,
            ast,
        );
        let assign_stmt = Statement::new_expression_statement(SPAN, assign, ast);
        let inner_if = Statement::new_if_statement(SPAN, has_call, assign_stmt, None, ast);

        let mut arrow_stmts = ArenaVec::new_in(ast);
        arrow_stmts.push(inner_if);
        let arrow_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), arrow_stmts, ast);

        let mut params_vec = ArenaVec::new_in(ast);
        params_vec.push(FormalParameter::new_plain(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "p", ast),
            ast,
        ));
        params_vec.push(FormalParameter::new_plain(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "i", ast),
            ast,
        ));
        let arrow_params = FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            params_vec,
            None,
            ast,
        );
        let arrow_fn = Expression::new_arrow_function_expression(
            SPAN,
            false,
            None,
            arrow_params,
            None,
            ArrowFunctionBody::FunctionBody(arrow_body),
            ast,
        );

        let mut for_each_args = ArenaVec::new_in(ast);
        for_each_args.push(Argument::from(arrow_fn));
        let for_each_call =
            Expression::new_call_expression(SPAN, for_each_member, None, for_each_args, false, ast);
        if_stmts.push(Statement::new_expression_statement(
            SPAN,
            for_each_call,
            ast,
        ));
    } else {
        for (prop_name, idx) in sorted_props {
            if *idx >= 32 {
                continue;
            }
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
    let assign_stmt = Statement::new_expression_statement(SPAN, assign_mask, ast);

    let this_expr3 = Expression::new_this_expression(SPAN, ast);
    let calc_prop = IdentifierName::new(SPAN, "__litMaskCalculated", ast);
    let this_calc =
        Expression::new_static_member_expression(SPAN, this_expr3, calc_prop, false, ast);
    let cp_ident = Expression::new_identifier(SPAN, "changedProperties", ast);
    let cond = Expression::new_binary_expression(
        SPAN,
        this_calc,
        BinaryOperator::StrictInequality,
        cp_ident,
        ast,
    );

    let this_expr4 = Expression::new_this_expression(SPAN, ast);
    let calc_prop2 = IdentifierName::new(SPAN, "__litMaskCalculated", ast);
    let target_calc =
        AssignmentTarget::new_static_member_expression(SPAN, this_expr4, calc_prop2, false, ast);
    let assign_calc = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target_calc,
        Expression::new_identifier(SPAN, "changedProperties", ast),
        ast,
    );
    let assign_calc_stmt = Statement::new_expression_statement(SPAN, assign_calc, ast);

    let mut guard_body = ArenaVec::new_in(ast);
    guard_body.push(assign_stmt);
    guard_body.push(assign_calc_stmt);
    let guard_block = Statement::new_block_statement(SPAN, guard_body, ast);

    stmts.push(Statement::new_if_statement(
        SPAN,
        cond,
        guard_block,
        None,
        ast,
    ));

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
    has_super_class: bool,
    class_name: Option<&str>,
    ast: &AstBuilder<'a>,
) -> ClassElement<'a> {
    let mut statements = build_mask_calc_statements(sorted_props, class_name, ast);
    if has_super_class {
        statements.push(build_super_update_statement(ast));
    }

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
