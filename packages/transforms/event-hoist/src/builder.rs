use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::SPAN;

pub fn build_reset_lh_actions<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__lhActions", ast),
        false,
        ast,
    );
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target,
        empty_arr,
        ast,
    );
    Statement::new_expression_statement(SPAN, assign, ast)
}

pub fn build_call_init_event_hoist<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let callee = Expression::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__initLitEventHoist", ast),
        false,
        ast,
    );
    let call =
        Expression::new_call_expression(SPAN, callee, None, ArenaVec::new_in(ast), false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

pub fn build_add_listener_statement<'a>(evt: &str, ast: &AstBuilder<'a>) -> Statement<'a> {
    let root_ident = Expression::new_identifier(SPAN, "root", ast);
    let add_event_listener = IdentifierName::new(SPAN, "addEventListener", ast);
    let callee =
        Expression::new_static_member_expression(SPAN, root_ident, add_event_listener, false, ast);

    let mut args = ArenaVec::new_in(ast);
    let evt_str = ast.allocator().alloc_str(evt);
    args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));

    let e_binding = BindingPattern::new_binding_identifier(SPAN, "e", ast);
    let param = FormalParameter::new_plain(SPAN, e_binding, ast);
    let mut params_vec = ArenaVec::new_in(ast);
    params_vec.push(param);
    let formal_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        params_vec,
        None,
        ast,
    );

    let this_expr = Expression::new_this_expression(SPAN, ast);
    let dispatch_prop = IdentifierName::new(SPAN, "__lhDispatch", ast);
    let dispatch_callee =
        Expression::new_static_member_expression(SPAN, this_expr, dispatch_prop, false, ast);

    let mut dispatch_args = ArenaVec::new_in(ast);
    dispatch_args.push(Argument::from(Expression::new_string_literal(
        SPAN, evt_str, None, ast,
    )));
    dispatch_args.push(Argument::from(Expression::new_identifier(SPAN, "e", ast)));

    let dispatch_call =
        Expression::new_call_expression(SPAN, dispatch_callee, None, dispatch_args, false, ast);
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        formal_params,
        None,
        ArrowFunctionBody::from(dispatch_call),
        ast,
    );
    args.push(Argument::from(arrow));

    let call = Expression::new_call_expression(SPAN, callee, None, args, false, ast);
    Statement::new_expression_statement(SPAN, call, ast)
}

pub fn build_connected_callback_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // super.connectedCallback?.();
    let super_expr = Expression::new_super(SPAN, ast);
    let member = MemberExpression::new_static_member_expression(
        SPAN,
        super_expr,
        IdentifierName::new(SPAN, "connectedCallback", ast),
        false,
        ast,
    );
    let call = CallExpression::boxed(
        SPAN,
        Expression::from(member),
        None,
        ArenaVec::new_in(ast),
        true,
        ast,
    );
    let chain = Expression::new_chain_expression(SPAN, ChainElement::CallExpression(call), ast);
    stmts.push(Statement::new_expression_statement(SPAN, chain, ast));

    // this.__initLitEventHoist();
    stmts.push(build_call_init_event_hoist(ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
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
    let key = PropertyKey::new_static_identifier(SPAN, "connectedCallback", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

pub fn build_first_updated_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // super.firstUpdated?.(changedProperties);
    let super_expr = Expression::new_super(SPAN, ast);
    let member = MemberExpression::new_static_member_expression(
        SPAN,
        super_expr,
        IdentifierName::new(SPAN, "firstUpdated", ast),
        false,
        ast,
    );
    let mut call_args = ArenaVec::new_in(ast);
    call_args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "changedProperties",
        ast,
    )));
    let call = CallExpression::boxed(SPAN, Expression::from(member), None, call_args, true, ast);
    let chain = Expression::new_chain_expression(SPAN, ChainElement::CallExpression(call), ast);
    stmts.push(Statement::new_expression_statement(SPAN, chain, ast));

    // this.__initLitEventHoist();
    stmts.push(build_call_init_event_hoist(ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        param_vec,
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
    let key = PropertyKey::new_static_identifier(SPAN, "firstUpdated", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

pub fn build_will_update_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // this.__lhActions = [];
    stmts.push(build_reset_lh_actions(ast));

    // super.willUpdate?.(changedProperties);
    let super_expr = Expression::new_super(SPAN, ast);
    let member = MemberExpression::new_static_member_expression(
        SPAN,
        super_expr,
        IdentifierName::new(SPAN, "willUpdate", ast),
        false,
        ast,
    );
    let mut call_args = ArenaVec::new_in(ast);
    call_args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "changedProperties",
        ast,
    )));
    let call = CallExpression::boxed(SPAN, Expression::from(member), None, call_args, true, ast);
    let chain = Expression::new_chain_expression(SPAN, ChainElement::CallExpression(call), ast);
    stmts.push(Statement::new_expression_statement(SPAN, chain, ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "changedProperties", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        param_vec,
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
    let key = PropertyKey::new_static_identifier(SPAN, "willUpdate", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

pub fn build_lh_actions_property<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let key = PropertyKey::new_static_identifier(SPAN, "__lhActions", ast);
    ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        key,
        None,
        Some(empty_arr),
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

pub fn build_lh_initialized_property<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let false_val = Expression::new_boolean_literal(SPAN, false, ast);
    let key = PropertyKey::new_static_identifier(SPAN, "__lhInitialized", ast);
    ClassElement::new_property_definition(
        SPAN,
        PropertyDefinitionType::PropertyDefinition,
        ArenaVec::new_in(ast),
        key,
        None,
        Some(false_val),
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        None,
        ast,
    )
}

pub fn build_init_lit_event_hoist_method<'a>(
    ast: &AstBuilder<'a>,
    sorted_events: &[String],
) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // if (this.__lhInitialized) return;
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let init_prop = Expression::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__lhInitialized", ast),
        false,
        ast,
    );
    let ret_stmt = Statement::new_return_statement(SPAN, None, ast);
    stmts.push(Statement::new_if_statement(
        SPAN, init_prop, ret_stmt, None, ast,
    ));

    // this.__lhInitialized = true;
    let this_expr2 = Expression::new_this_expression(SPAN, ast);
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_expr2,
        IdentifierName::new(SPAN, "__lhInitialized", ast),
        false,
        ast,
    );
    let true_val = Expression::new_boolean_literal(SPAN, true, ast);
    let assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target,
        true_val,
        ast,
    );
    stmts.push(Statement::new_expression_statement(SPAN, assign, ast));

    // const root = this.shadowRoot || this;
    let this_expr3 = Expression::new_this_expression(SPAN, ast);
    let shadow_root = Expression::new_static_member_expression(
        SPAN,
        this_expr3,
        IdentifierName::new(SPAN, "shadowRoot", ast),
        false,
        ast,
    );
    let this_expr4 = Expression::new_this_expression(SPAN, ast);
    let or_expr =
        Expression::new_logical_expression(SPAN, shadow_root, LogicalOperator::Or, this_expr4, ast);
    let root_pat = BindingPattern::new_binding_identifier(SPAN, "root", ast);
    let decl = VariableDeclarator::new(SPAN, root_pat, None, Some(or_expr), false, ast);
    let mut decls = ArenaVec::new_in(ast);
    decls.push(decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls,
        false,
        ast,
    ));

    // for each event: root.addEventListener(...)
    for evt in sorted_events {
        stmts.push(build_add_listener_statement(evt, ast));
    }

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        ArenaVec::new_in(ast),
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
    let key = PropertyKey::new_static_identifier(SPAN, "__initLitEventHoist", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

pub fn build_lh_action_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // return (this.__lhActions ||= []).push(handler) - 1;
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        Expression::new_this_expression(SPAN, ast),
        IdentifierName::new(SPAN, "__lhActions", ast),
        false,
        ast,
    );
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let assign = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::LogicalOr,
        target,
        empty_arr,
        ast,
    );
    let paren_or = Expression::new_parenthesized_expression(SPAN, assign, ast);
    let push_member = Expression::new_static_member_expression(
        SPAN,
        paren_or,
        IdentifierName::new(SPAN, "push", ast),
        false,
        ast,
    );
    let mut push_args = ArenaVec::new_in(ast);
    push_args.push(Argument::from(Expression::new_identifier(
        SPAN, "handler", ast,
    )));
    let push_call = Expression::new_call_expression(SPAN, push_member, None, push_args, false, ast);
    let one_lit =
        Expression::new_numeric_literal(SPAN, 1.0, Some("1".into()), NumberBase::Decimal, ast);
    let sub_one = Expression::new_binary_expression(
        SPAN,
        push_call,
        BinaryOperator::Subtraction,
        one_lit,
        ast,
    );
    stmts.push(Statement::new_return_statement(SPAN, Some(sub_one), ast));

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "handler", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        param_vec,
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
    let key = PropertyKey::new_static_identifier(SPAN, "__lhAction", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

fn build_dispatch_body_stmts<'a>(
    ast: &AstBuilder<'a>,
    use_this: bool,
) -> ArenaVec<'a, Statement<'a>> {
    let make_host = || {
        if use_this {
            Expression::new_this_expression(SPAN, ast)
        } else {
            Expression::new_identifier(SPAN, "h", ast)
        }
    };
    let mut stmts = ArenaVec::new_in(ast);

    // const a = `data-lh-${eventName}`, r = <host>.shadowRoot || <host>, p = event.composedPath ? event.composedPath() : [];
    let mut quasis = ArenaVec::new_in(ast);
    quasis.push(TemplateElement::new(
        SPAN,
        TemplateElementValue {
            raw: ast.allocator().alloc_str("data-lh-").into(),
            cooked: Some(ast.allocator().alloc_str("data-lh-").into()),
        },
        false,
        ast,
    ));
    quasis.push(TemplateElement::new(
        SPAN,
        TemplateElementValue {
            raw: ast.allocator().alloc_str("").into(),
            cooked: Some(ast.allocator().alloc_str("").into()),
        },
        true,
        ast,
    ));
    let mut exprs = ArenaVec::new_in(ast);
    exprs.push(Expression::new_identifier(SPAN, "eventName", ast));
    let tmpl = Expression::new_template_literal(SPAN, quasis, exprs, ast);

    let shadow = Expression::new_static_member_expression(
        SPAN,
        make_host(),
        IdentifierName::new(SPAN, "shadowRoot", ast),
        false,
        ast,
    );
    let root_init =
        Expression::new_logical_expression(SPAN, shadow, LogicalOperator::Or, make_host(), ast);

    let call_composed = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "event", ast),
            IdentifierName::new(SPAN, "composedPath", ast),
            false,
            ast,
        ),
        None,
        ArenaVec::new_in(ast),
        false,
        ast,
    );
    let empty_path_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let path_cond = Expression::new_conditional_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "event", ast),
            IdentifierName::new(SPAN, "composedPath", ast),
            false,
            ast,
        ),
        call_composed,
        empty_path_arr,
        ast,
    );

    let mut decls = ArenaVec::new_in(ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "a", ast),
        None,
        Some(tmpl),
        false,
        ast,
    ));
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "r", ast),
        None,
        Some(root_init),
        false,
        ast,
    ));
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "p", ast),
        None,
        Some(path_cond),
        false,
        ast,
    ));
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls,
        false,
        ast,
    ));

    // if (!p.length) for (let t = event.target; t && t !== r; t = t.parentElement) p.push(t);
    let mut decls_tgt = ArenaVec::new_in(ast);
    decls_tgt.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "t", ast),
        None,
        Some(Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "event", ast),
            IdentifierName::new(SPAN, "target", ast),
            false,
            ast,
        )),
        false,
        ast,
    ));
    let for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Let,
        decls_tgt,
        false,
        ast,
    ));
    let while_cond = Expression::new_logical_expression(
        SPAN,
        Expression::new_identifier(SPAN, "t", ast),
        LogicalOperator::And,
        Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, "t", ast),
            BinaryOperator::StrictInequality,
            Expression::new_identifier(SPAN, "r", ast),
            ast,
        ),
        ast,
    );
    let assign_target = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_assignment_target_identifier(SPAN, "t", ast),
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "t", ast),
            IdentifierName::new(SPAN, "parentElement", ast),
            false,
            ast,
        ),
        ast,
    );
    let mut push_args = ArenaVec::new_in(ast);
    push_args.push(Argument::from(Expression::new_identifier(SPAN, "t", ast)));
    let push_call = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "p", ast),
            IdentifierName::new(SPAN, "push", ast),
            false,
            ast,
        ),
        None,
        push_args,
        false,
        ast,
    );
    let loop_stmt = Statement::new_for_statement(
        SPAN,
        Some(for_init),
        Some(while_cond),
        Some(assign_target),
        Statement::new_expression_statement(SPAN, push_call, ast),
        ast,
    );
    let no_path = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "p", ast),
            IdentifierName::new(SPAN, "length", ast),
            false,
            ast,
        ),
        ast,
    );
    stmts.push(Statement::new_if_statement(
        SPAN, no_path, loop_stmt, None, ast,
    ));

    // for (const d of p) {
    //   if (d === r) break;
    //   if (d.nodeType === 1 && d.hasAttribute?.(a)) {
    //     if (r !== <host> ? d.getRootNode?.() !== r : !r.contains(d)) continue;
    //     <host>.__lhActions?.[+d.getAttribute(a)]?.call?.(<host>, event);
    //     if (event.cancelBubble) break;
    //   }
    // }
    let mut for_body_stmts = ArenaVec::new_in(ast);
    for_body_stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, "d", ast),
            BinaryOperator::StrictEquality,
            Expression::new_identifier(SPAN, "r", ast),
            ast,
        ),
        Statement::new_break_statement(SPAN, None, ast),
        None,
        ast,
    ));

    let is_elem = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "d", ast),
            IdentifierName::new(SPAN, "nodeType", ast),
            false,
            ast,
        ),
        BinaryOperator::StrictEquality,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let mut has_attr_args = ArenaVec::new_in(ast);
    has_attr_args.push(Argument::from(Expression::new_identifier(SPAN, "a", ast)));
    let call_has_attr = Expression::new_chain_expression(
        SPAN,
        ChainElement::CallExpression(CallExpression::boxed(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "d", ast),
                IdentifierName::new(SPAN, "hasAttribute", ast),
                false,
                ast,
            ),
            None,
            has_attr_args,
            true,
            ast,
        )),
        ast,
    );
    let cond_all =
        Expression::new_logical_expression(SPAN, is_elem, LogicalOperator::And, call_has_attr, ast);

    let mut inner_stmts = ArenaVec::new_in(ast);
    let is_shadow_root = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "r", ast),
        BinaryOperator::StrictInequality,
        make_host(),
        ast,
    );
    let call_get_root = Expression::new_chain_expression(
        SPAN,
        ChainElement::CallExpression(CallExpression::boxed(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "d", ast),
                IdentifierName::new(SPAN, "getRootNode", ast),
                false,
                ast,
            ),
            None,
            ArenaVec::new_in(ast),
            true,
            ast,
        )),
        ast,
    );
    let neq_root = Expression::new_binary_expression(
        SPAN,
        call_get_root,
        BinaryOperator::StrictInequality,
        Expression::new_identifier(SPAN, "r", ast),
        ast,
    );
    let mut contains_args = ArenaVec::new_in(ast);
    contains_args.push(Argument::from(Expression::new_identifier(SPAN, "d", ast)));
    let not_contains = Expression::new_unary_expression(
        SPAN,
        UnaryOperator::LogicalNot,
        Expression::new_call_expression(
            SPAN,
            Expression::new_static_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "r", ast),
                IdentifierName::new(SPAN, "contains", ast),
                false,
                ast,
            ),
            None,
            contains_args,
            false,
            ast,
        ),
        ast,
    );
    let root_cond =
        Expression::new_conditional_expression(SPAN, is_shadow_root, neq_root, not_contains, ast);
    inner_stmts.push(Statement::new_if_statement(
        SPAN,
        root_cond,
        Statement::new_continue_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // <host>.__lhActions?.[+d.getAttribute(a)]?.call?.(<host>, event);
    let mut get_attr_args = ArenaVec::new_in(ast);
    get_attr_args.push(Argument::from(Expression::new_identifier(SPAN, "a", ast)));
    let call_get_attr = Expression::new_call_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "d", ast),
            IdentifierName::new(SPAN, "getAttribute", ast),
            false,
            ast,
        ),
        None,
        get_attr_args,
        false,
        ast,
    );
    let unary_plus =
        Expression::new_unary_expression(SPAN, UnaryOperator::UnaryPlus, call_get_attr, ast);
    let actions_elem = ChainElement::ComputedMemberExpression(ComputedMemberExpression::boxed(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            make_host(),
            IdentifierName::new(SPAN, "__lhActions", ast),
            false,
            ast,
        ),
        unary_plus,
        true,
        ast,
    ));
    let call_prop = ChainElement::StaticMemberExpression(StaticMemberExpression::boxed(
        SPAN,
        Expression::from(actions_elem),
        IdentifierName::new(SPAN, "call", ast),
        true,
        ast,
    ));
    let mut call_args = ArenaVec::new_in(ast);
    call_args.push(Argument::from(make_host()));
    call_args.push(Argument::from(Expression::new_identifier(
        SPAN, "event", ast,
    )));
    let call_chain = Expression::new_chain_expression(
        SPAN,
        ChainElement::CallExpression(CallExpression::boxed(
            SPAN,
            Expression::from(call_prop),
            None,
            call_args,
            true,
            ast,
        )),
        ast,
    );
    inner_stmts.push(Statement::new_expression_statement(SPAN, call_chain, ast));

    // if (event.cancelBubble) break;
    inner_stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "event", ast),
            IdentifierName::new(SPAN, "cancelBubble", ast),
            false,
            ast,
        ),
        Statement::new_break_statement(SPAN, None, ast),
        None,
        ast,
    ));

    for_body_stmts.push(Statement::new_if_statement(
        SPAN,
        cond_all,
        Statement::new_block_statement(SPAN, inner_stmts, ast),
        None,
        ast,
    ));

    let mut decls_node = ArenaVec::new_in(ast);
    decls_node.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "d", ast),
        None,
        None,
        false,
        ast,
    ));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        decls_node,
        false,
        ast,
    ));
    stmts.push(Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        Expression::new_identifier(SPAN, "p", ast),
        Statement::new_block_statement(SPAN, for_body_stmts, ast),
        ast,
    ));

    stmts
}

pub fn build_lh_dispatch_helper_function<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let stmts = build_dispatch_body_stmts(ast, false);
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "h", ast),
        ast,
    ));
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "eventName", ast),
        ast,
    ));
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "event", ast),
        ast,
    ));
    Statement::new_function_declaration(
        SPAN,
        FunctionType::FunctionDeclaration,
        Some(BindingIdentifier::new(SPAN, "__lhDisp", ast)),
        false,
        false,
        false,
        None,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::FormalParameter,
            param_vec,
            None,
            ast,
        ),
        None,
        Some(body),
        ast,
    )
}

pub fn build_lh_dispatch_delegating_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);
    let mut args = ArenaVec::new_in(ast);
    args.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
    args.push(Argument::from(Expression::new_identifier(
        SPAN,
        "eventName",
        ast,
    )));
    args.push(Argument::from(Expression::new_identifier(
        SPAN, "event", ast,
    )));
    let call = Expression::new_call_expression(
        SPAN,
        Expression::new_identifier(SPAN, "__lhDisp", ast),
        None,
        args,
        false,
        ast,
    );
    stmts.push(Statement::new_expression_statement(SPAN, call, ast));
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "eventName", ast),
        ast,
    ));
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "event", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        param_vec,
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
    let key = PropertyKey::new_static_identifier(SPAN, "__lhDispatch", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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

pub fn build_lh_dispatch_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let stmts = build_dispatch_body_stmts(ast, true);
    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "eventName", ast),
        ast,
    ));
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "event", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::FormalParameter,
        param_vec,
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
    let key = PropertyKey::new_static_identifier(SPAN, "__lhDispatch", ast);
    ClassElement::new_method_definition(
        SPAN,
        MethodDefinitionType::MethodDefinition,
        ArenaVec::new_in(ast),
        key,
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
