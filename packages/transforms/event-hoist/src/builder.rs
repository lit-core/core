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

    // return (this.__lhActions || (this.__lhActions = [])).push(handler) - 1;
    let this_expr = Expression::new_this_expression(SPAN, ast);
    let actions_expr = Expression::new_static_member_expression(
        SPAN,
        this_expr,
        IdentifierName::new(SPAN, "__lhActions", ast),
        false,
        ast,
    );
    let this_expr2 = Expression::new_this_expression(SPAN, ast);
    let target = AssignmentTarget::new_static_member_expression(
        SPAN,
        this_expr2,
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
    let or_expr =
        Expression::new_logical_expression(SPAN, actions_expr, LogicalOperator::Or, assign, ast);
    let paren_or = Expression::new_parenthesized_expression(SPAN, or_expr, ast);
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

pub fn build_lh_dispatch_method<'a>(ast: &AstBuilder<'a>) -> ClassElement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // const attr = `data-lh-${eventName}`;
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
    let attr_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "attr", ast),
        None,
        Some(tmpl),
        false,
        ast,
    );
    let mut decls1 = ArenaVec::new_in(ast);
    decls1.push(attr_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls1,
        false,
        ast,
    ));

    // const root = this.shadowRoot || this;
    let this1 = Expression::new_this_expression(SPAN, ast);
    let shadow = Expression::new_static_member_expression(
        SPAN,
        this1,
        IdentifierName::new(SPAN, "shadowRoot", ast),
        false,
        ast,
    );
    let this2 = Expression::new_this_expression(SPAN, ast);
    let root_init =
        Expression::new_logical_expression(SPAN, shadow, LogicalOperator::Or, this2, ast);
    let root_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "root", ast),
        None,
        Some(root_init),
        false,
        ast,
    );
    let mut decls2 = ArenaVec::new_in(ast);
    decls2.push(root_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls2,
        false,
        ast,
    ));

    // const path = event.composedPath ? event.composedPath() : [];
    let composed_path_test = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "event", ast),
        IdentifierName::new(SPAN, "composedPath", ast),
        false,
        ast,
    );
    let call_composed = Expression::new_call_expression(
        SPAN,
        composed_path_test,
        None,
        ArenaVec::new_in(ast),
        false,
        ast,
    );
    let empty_path_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let composed_path_member = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "event", ast),
        IdentifierName::new(SPAN, "composedPath", ast),
        false,
        ast,
    );
    let path_cond = Expression::new_conditional_expression(
        SPAN,
        composed_path_member,
        call_composed,
        empty_path_arr,
        ast,
    );
    let path_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "path", ast),
        None,
        Some(path_cond),
        false,
        ast,
    );
    let mut decls5 = ArenaVec::new_in(ast);
    decls5.push(path_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        decls5,
        false,
        ast,
    ));

    // Dispatch loop helper closure statements:
    // Handler execution block:
    //   if (root.nodeType === 11 ? (node.getRootNode && node.getRootNode() !== root) : !root.contains(node)) continue;
    //   const actionId = Number(node.getAttribute(attr));
    //   const handler = this.__lhActions && this.__lhActions[actionId];
    //   if (typeof handler === 'function') handler.call(this, event);
    //   if (event.cancelBubble || stopped) break;

    // Helper macro/closure for building handler invocation:
    let build_handler_execution = |node_name: &'static str,
                                   ast: &AstBuilder<'a>|
     -> ArenaVec<'a, Statement<'a>> {
        let mut blk = ArenaVec::new_in(ast);

        // if (root !== this ? (node.getRootNode && node.getRootNode() !== root) : !root.contains(node)) continue;
        let this_expr = Expression::new_this_expression(SPAN, ast);
        let is_shadow_root = Expression::new_binary_expression(
            SPAN,
            Expression::new_identifier(SPAN, "root", ast),
            BinaryOperator::StrictInequality,
            this_expr,
            ast,
        );

        let get_root = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, node_name, ast),
            IdentifierName::new(SPAN, "getRootNode", ast),
            false,
            ast,
        );
        let call_get_root = Expression::new_call_expression(
            SPAN,
            get_root,
            None,
            ArenaVec::new_in(ast),
            false,
            ast,
        );
        let neq_root = Expression::new_binary_expression(
            SPAN,
            call_get_root,
            BinaryOperator::StrictInequality,
            Expression::new_identifier(SPAN, "root", ast),
            ast,
        );
        let get_root_check = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, node_name, ast),
            IdentifierName::new(SPAN, "getRootNode", ast),
            false,
            ast,
        );
        let shadow_cond = Expression::new_logical_expression(
            SPAN,
            get_root_check,
            LogicalOperator::And,
            neq_root,
            ast,
        );

        let root_contains = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "root", ast),
            IdentifierName::new(SPAN, "contains", ast),
            false,
            ast,
        );
        let mut contains_args = ArenaVec::new_in(ast);
        contains_args.push(Argument::from(Expression::new_identifier(
            SPAN, node_name, ast,
        )));
        let call_contains =
            Expression::new_call_expression(SPAN, root_contains, None, contains_args, false, ast);
        let not_contains =
            Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, call_contains, ast);

        let root_cond = Expression::new_conditional_expression(
            SPAN,
            is_shadow_root,
            shadow_cond,
            not_contains,
            ast,
        );
        let mut cont_stmts = ArenaVec::new_in(ast);
        cont_stmts.push(Statement::new_continue_statement(SPAN, None, ast));
        blk.push(Statement::new_if_statement(
            SPAN,
            root_cond,
            Statement::new_block_statement(SPAN, cont_stmts, ast),
            None,
            ast,
        ));

        // const actionId = Number(node.getAttribute(attr));
        let get_attr = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, node_name, ast),
            IdentifierName::new(SPAN, "getAttribute", ast),
            false,
            ast,
        );
        let mut get_attr_args = ArenaVec::new_in(ast);
        get_attr_args.push(Argument::from(Expression::new_identifier(
            SPAN, "attr", ast,
        )));
        let call_get_attr =
            Expression::new_call_expression(SPAN, get_attr, None, get_attr_args, false, ast);
        let mut num_args = ArenaVec::new_in(ast);
        num_args.push(Argument::from(call_get_attr));
        let num_call = Expression::new_call_expression(
            SPAN,
            Expression::new_identifier(SPAN, "Number", ast),
            None,
            num_args,
            false,
            ast,
        );
        let action_id_decl = VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "actionId", ast),
            None,
            Some(num_call),
            false,
            ast,
        );
        let mut decls_act = ArenaVec::new_in(ast);
        decls_act.push(action_id_decl);
        blk.push(Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            decls_act,
            false,
            ast,
        ));

        // const handler = this.__lhActions && this.__lhActions[actionId];
        let this_actions = Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "__lhActions", ast),
            false,
            ast,
        );
        let this_actions2 = Expression::new_static_member_expression(
            SPAN,
            Expression::new_this_expression(SPAN, ast),
            IdentifierName::new(SPAN, "__lhActions", ast),
            false,
            ast,
        );
        let actions_access = Expression::new_computed_member_expression(
            SPAN,
            this_actions2,
            Expression::new_identifier(SPAN, "actionId", ast),
            false,
            ast,
        );
        let handler_val = Expression::new_logical_expression(
            SPAN,
            this_actions,
            LogicalOperator::And,
            actions_access,
            ast,
        );
        let handler_decl = VariableDeclarator::new(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, "handler", ast),
            None,
            Some(handler_val),
            false,
            ast,
        );
        let mut decls_h = ArenaVec::new_in(ast);
        decls_h.push(handler_decl);
        blk.push(Statement::new_variable_declaration(
            SPAN,
            VariableDeclarationKind::Const,
            decls_h,
            false,
            ast,
        ));

        // if (typeof handler === 'function') { handler.call(this, event); }
        let typeof_handler = Expression::new_unary_expression(
            SPAN,
            UnaryOperator::Typeof,
            Expression::new_identifier(SPAN, "handler", ast),
            ast,
        );
        let is_func = Expression::new_binary_expression(
            SPAN,
            typeof_handler,
            BinaryOperator::StrictEquality,
            Expression::new_string_literal(SPAN, "function", None, ast),
            ast,
        );
        let call_member = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "handler", ast),
            IdentifierName::new(SPAN, "call", ast),
            false,
            ast,
        );
        let mut call_member_args = ArenaVec::new_in(ast);
        call_member_args.push(Argument::from(Expression::new_this_expression(SPAN, ast)));
        call_member_args.push(Argument::from(Expression::new_identifier(
            SPAN, "event", ast,
        )));
        let call_handler =
            Expression::new_call_expression(SPAN, call_member, None, call_member_args, false, ast);
        let mut call_handler_stmts = ArenaVec::new_in(ast);
        call_handler_stmts.push(Statement::new_expression_statement(SPAN, call_handler, ast));
        blk.push(Statement::new_if_statement(
            SPAN,
            is_func,
            Statement::new_block_statement(SPAN, call_handler_stmts, ast),
            None,
            ast,
        ));

        // if (event.cancelBubble) break;
        let cancel_bubble = Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "event", ast),
            IdentifierName::new(SPAN, "cancelBubble", ast),
            false,
            ast,
        );
        let mut break_stmts = ArenaVec::new_in(ast);
        break_stmts.push(Statement::new_break_statement(SPAN, None, ast));
        blk.push(Statement::new_if_statement(
            SPAN,
            cancel_bubble,
            Statement::new_block_statement(SPAN, break_stmts, ast),
            None,
            ast,
        ));

        blk
    };

    // Construct path branch:
    // for (const node of path) {
    //   if (node === root) break;
    //   if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr)) { ... }
    // }
    let mut for_body_stmts = ArenaVec::new_in(ast);

    // if (node === root) break;
    let eq_root = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "node", ast),
        BinaryOperator::StrictEquality,
        Expression::new_identifier(SPAN, "root", ast),
        ast,
    );
    for_body_stmts.push(Statement::new_if_statement(
        SPAN,
        eq_root,
        Statement::new_break_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute(attr))
    let node_type = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "node", ast),
        IdentifierName::new(SPAN, "nodeType", ast),
        false,
        ast,
    );
    let is_elem = Expression::new_binary_expression(
        SPAN,
        node_type,
        BinaryOperator::StrictEquality,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let has_attr_fn = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "node", ast),
        IdentifierName::new(SPAN, "hasAttribute", ast),
        false,
        ast,
    );
    let has_attr_call_member = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "node", ast),
        IdentifierName::new(SPAN, "hasAttribute", ast),
        false,
        ast,
    );
    let mut has_attr_args = ArenaVec::new_in(ast);
    has_attr_args.push(Argument::from(Expression::new_identifier(
        SPAN, "attr", ast,
    )));
    let call_has_attr = Expression::new_call_expression(
        SPAN,
        has_attr_call_member,
        None,
        has_attr_args,
        false,
        ast,
    );
    let cond_elem =
        Expression::new_logical_expression(SPAN, is_elem, LogicalOperator::And, has_attr_fn, ast);
    let cond_all = Expression::new_logical_expression(
        SPAN,
        cond_elem,
        LogicalOperator::And,
        call_has_attr,
        ast,
    );

    let inner_handler_stmts = build_handler_execution("node", ast);
    for_body_stmts.push(Statement::new_if_statement(
        SPAN,
        cond_all,
        Statement::new_block_statement(SPAN, inner_handler_stmts, ast),
        None,
        ast,
    ));

    let for_body = Statement::new_block_statement(SPAN, for_body_stmts, ast);
    let node_pat = BindingPattern::new_binding_identifier(SPAN, "node", ast);
    let node_decl = VariableDeclarator::new(SPAN, node_pat, None, None, false, ast);
    let mut decls_node = ArenaVec::new_in(ast);
    decls_node.push(node_decl);
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        decls_node,
        false,
        ast,
    ));
    let for_of = Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        Expression::new_identifier(SPAN, "path", ast),
        for_body,
        ast,
    );

    // If path is empty, populate it from event.target parent chain:
    // if (!path.length) {
    //   for (let target = event.target; target && target !== root; target = target.parentElement) {
    //     path.push(target);
    //   }
    // }
    let mut fallback_stmts = ArenaVec::new_in(ast);
    let target_init = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "event", ast),
        IdentifierName::new(SPAN, "target", ast),
        false,
        ast,
    );
    let target_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "target", ast),
        None,
        Some(target_init),
        false,
        ast,
    );
    let mut decls_tgt = ArenaVec::new_in(ast);
    decls_tgt.push(target_decl);
    let for_init = ForStatementInit::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Let,
        decls_tgt,
        false,
        ast,
    ));

    let target_ident = Expression::new_identifier(SPAN, "target", ast);
    let neq_root_target = Expression::new_binary_expression(
        SPAN,
        Expression::new_identifier(SPAN, "target", ast),
        BinaryOperator::StrictInequality,
        Expression::new_identifier(SPAN, "root", ast),
        ast,
    );
    let while_cond = Expression::new_logical_expression(
        SPAN,
        target_ident,
        LogicalOperator::And,
        neq_root_target,
        ast,
    );

    let parent_elem = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "target", ast),
        IdentifierName::new(SPAN, "parentElement", ast),
        false,
        ast,
    );
    let target_assign_target =
        AssignmentTarget::new_assignment_target_identifier(SPAN, "target", ast);
    let assign_target = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        target_assign_target,
        parent_elem,
        ast,
    );

    let path_push_member = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "path", ast),
        IdentifierName::new(SPAN, "push", ast),
        false,
        ast,
    );
    let mut push_args = ArenaVec::new_in(ast);
    push_args.push(Argument::from(Expression::new_identifier(
        SPAN, "target", ast,
    )));
    let push_call =
        Expression::new_call_expression(SPAN, path_push_member, None, push_args, false, ast);

    let loop_stmt = Statement::new_for_statement(
        SPAN,
        Some(for_init),
        Some(while_cond),
        Some(assign_target),
        Statement::new_expression_statement(SPAN, push_call, ast),
        ast,
    );
    fallback_stmts.push(loop_stmt);

    let path_len = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "path", ast),
        IdentifierName::new(SPAN, "length", ast),
        false,
        ast,
    );
    let no_path = Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, path_len, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        no_path,
        Statement::new_block_statement(SPAN, fallback_stmts, ast),
        None,
        ast,
    ));
    stmts.push(for_of);

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
