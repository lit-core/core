use oxc_allocator::{ArenaVec, GetAllocator};
use oxc_ast::ast::*;
use oxc_ast::builder::AstBuilder;
use oxc_span::{SPAN, SourceType};
use std::collections::HashMap;

pub fn build_loader_program<'a>(
    ast: &AstBuilder<'a>,
    manifest: &HashMap<String, String>,
    events: &[String],
    idle_hydration: bool,
    idle_timeout: u32,
) -> Program<'a> {
    let mut iife_stmts = ArenaVec::new_in(ast);

    // Statement 1: const W = window, D = document, C = customElements, R = '__lit_resumed__';
    iife_stmts.push(build_globals_decl(ast));

    // Statement 2: const M = W.__LIT_RESUMABLE_MANIFEST__ || { ... }, B = [], L = {};
    iife_stmts.push(build_state_decl(ast, manifest));

    // Statement 3: const uG = (t) => ...;
    iife_stmts.push(build_ug_decl(ast));

    // Statement 4: const iT = (e) => ...;
    iife_stmts.push(build_it_decl(ast));

    // Statement 5: const hI = async (e) => { ... };
    iife_stmts.push(build_hi_decl(ast));

    // Statement 6: events.forEach((t) => { W.addEventListener(t, hI, true); });
    iife_stmts.push(build_events_listener_stmt(ast, events));

    // Statement 7: idle hydration (only if idle_hydration == true)
    if idle_hydration {
        iife_stmts.push(build_idle_hydration_stmt(ast, idle_timeout));
    }

    let iife_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), iife_stmts, ast);
    let arrow_params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        ArenaVec::new_in(ast),
        None,
        ast,
    );
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        arrow_params,
        None,
        ArrowFunctionBody::FunctionBody(iife_body),
        ast,
    );
    let paren = Expression::new_parenthesized_expression(SPAN, arrow, ast);
    let iife_call =
        Expression::new_call_expression(SPAN, paren, None, ArenaVec::new_in(ast), false, ast);
    let top_stmt = Statement::new_expression_statement(SPAN, iife_call, ast);

    let mut body = ArenaVec::new_in(ast);
    body.push(top_stmt);

    Program::new(
        SPAN,
        SourceType::mjs(),
        "",
        ArenaVec::new_in(ast),
        None,
        ArenaVec::new_in(ast),
        body,
        ast,
    )
}

fn build_globals_decl<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let mut decls = ArenaVec::new_in(ast);

    // W = window
    let w_init = Expression::new_identifier(SPAN, "window", ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "W", ast),
        None,
        Some(w_init),
        false,
        ast,
    ));

    // D = document
    let d_init = Expression::new_identifier(SPAN, "document", ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "D", ast),
        None,
        Some(d_init),
        false,
        ast,
    ));

    // C = customElements
    let c_init = Expression::new_identifier(SPAN, "customElements", ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "C", ast),
        None,
        Some(c_init),
        false,
        ast,
    ));

    // R = '__lit_resumed__'
    let r_init = Expression::new_string_literal(SPAN, "__lit_resumed__", None, ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "R", ast),
        None,
        Some(r_init),
        false,
        ast,
    ));

    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

fn build_state_decl<'a>(ast: &AstBuilder<'a>, manifest: &HashMap<String, String>) -> Statement<'a> {
    let mut decls = ArenaVec::new_in(ast);

    // M = W.__LIT_RESUMABLE_MANIFEST__ || { ... }
    let w_manifest = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "W", ast),
        IdentifierName::new(SPAN, "__LIT_RESUMABLE_MANIFEST__", ast),
        false,
        ast,
    );
    let mut manifest_props = ArenaVec::new_in(ast);
    for (tag, url) in manifest {
        let key = PropertyKey::new_string_literal(SPAN, ast.allocator().alloc_str(tag), None, ast);
        let val = Expression::new_string_literal(SPAN, ast.allocator().alloc_str(url), None, ast);
        let prop = ObjectPropertyKind::new_object_property(
            SPAN,
            PropertyKind::Init,
            key,
            val,
            false,
            false,
            false,
            ast,
        );
        manifest_props.push(prop);
    }
    let manifest_obj = Expression::new_object_expression(SPAN, manifest_props, ast);
    let m_init = Expression::new_logical_expression(
        SPAN,
        w_manifest,
        LogicalOperator::Or,
        manifest_obj,
        ast,
    );
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "M", ast),
        None,
        Some(m_init),
        false,
        ast,
    ));

    // B = []
    let b_init = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "B", ast),
        None,
        Some(b_init),
        false,
        ast,
    ));

    // L = {}
    let l_init = Expression::new_object_expression(SPAN, ArenaVec::new_in(ast), ast);
    decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "L", ast),
        None,
        Some(l_init),
        false,
        ast,
    ));

    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

// const uG = (t) => M[t] ? (L[t] ||= import(M[t]).catch((e) => (console.error("[lit-resumable] chunk failed to load:", t, e), L[t] = 0))) : Promise.resolve();
// L maps tag -> in-flight import promise; 0 marks a failed attempt (retried on interaction, skipped by idle).
fn build_ug_decl<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let test = computed(ast, ident(ast, "M"), ident(ast, "t"));

    let import_call = Expression::new_import_expression(
        SPAN,
        computed(ast, ident(ast, "M"), ident(ast, "t")),
        None,
        None,
        ast,
    );
    let reset = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_computed_member_expression(
            SPAN,
            ident(ast, "L"),
            ident(ast, "t"),
            false,
            ast,
        ),
        Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
        ast,
    );
    let report = call(
        ast,
        member(ast, ident(ast, "console"), "error"),
        vec![
            Expression::new_string_literal(
                SPAN,
                "[lit-resumable] chunk failed to load:",
                None,
                ast,
            ),
            ident(ast, "t"),
            ident(ast, "e"),
        ],
    );
    let mut steps = ArenaVec::new_in(ast);
    steps.push(report);
    steps.push(reset);
    let handler_body = Expression::new_sequence_expression(SPAN, steps, ast);
    let catch_call = call(
        ast,
        member(ast, import_call, "catch"),
        vec![arrow(ast, &["e"], handler_body)],
    );
    let cached = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::LogicalOr,
        AssignmentTarget::new_computed_member_expression(
            SPAN,
            ident(ast, "L"),
            ident(ast, "t"),
            false,
            ast,
        ),
        catch_call,
        ast,
    );
    let resolved = call(
        ast,
        member(ast, ident(ast, "Promise"), "resolve"),
        Vec::new(),
    );
    let body = Expression::new_conditional_expression(SPAN, test, cached, resolved, ast);
    let ug_fn = arrow(ast, &["t"], body);

    let decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "uG", ast),
        None,
        Some(ug_fn),
        false,
        ast,
    );
    let mut decls = ArenaVec::new_in(ast);
    decls.push(decl);
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

fn ident<'a>(ast: &AstBuilder<'a>, name: &'static str) -> Expression<'a> {
    Expression::new_identifier(SPAN, name, ast)
}

fn member<'a>(ast: &AstBuilder<'a>, object: Expression<'a>, prop: &'static str) -> Expression<'a> {
    Expression::new_static_member_expression(
        SPAN,
        object,
        IdentifierName::new(SPAN, prop, ast),
        false,
        ast,
    )
}

fn computed<'a>(
    ast: &AstBuilder<'a>,
    object: Expression<'a>,
    index: Expression<'a>,
) -> Expression<'a> {
    Expression::new_computed_member_expression(SPAN, object, index, false, ast)
}

fn call<'a>(
    ast: &AstBuilder<'a>,
    callee: Expression<'a>,
    args: Vec<Expression<'a>>,
) -> Expression<'a> {
    let mut out = ArenaVec::new_in(ast);
    for arg in args {
        out.push(Argument::from(arg));
    }
    Expression::new_call_expression(SPAN, callee, None, out, false, ast)
}

fn arrow<'a>(
    ast: &AstBuilder<'a>,
    params: &[&'static str],
    body: Expression<'a>,
) -> Expression<'a> {
    let mut list = ArenaVec::new_in(ast);
    for name in params {
        list.push(FormalParameter::new_plain(
            SPAN,
            BindingPattern::new_binding_identifier(SPAN, *name, ast),
            ast,
        ));
    }
    Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            list,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(body),
        ast,
    )
}

// const iT = (e) => e?.nodeType === 1 && (/^(BUTTON|INPUT|SELECT|A)$/i.test(e.tagName) || e.tabIndex >= 0 || e.localName?.includes('-') || /tabindex|data-resumable|resumes-/.test(e.getAttributeNames?.()));
fn build_it_decl<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    // e?.nodeType === 1
    let e_chain = Expression::new_chain_expression(
        SPAN,
        ChainElement::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "e", ast),
            IdentifierName::new(SPAN, "nodeType", ast),
            true,
            ast,
        ),
        ast,
    );
    let eq_1 = Expression::new_binary_expression(
        SPAN,
        e_chain,
        BinaryOperator::StrictEquality,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );

    // /^(BUTTON|INPUT|SELECT|A)$/i.test(e.tagName)
    let re1 = Expression::new_reg_exp_literal(
        SPAN,
        RegExp {
            pattern: RegExpPattern {
                text: ast
                    .allocator()
                    .alloc_str("^(BUTTON|INPUT|SELECT|A)$")
                    .into(),
                pattern: None,
            },
            flags: RegExpFlags::I,
        },
        None,
        ast,
    );
    let re1_test = Expression::new_static_member_expression(
        SPAN,
        re1,
        IdentifierName::new(SPAN, "test", ast),
        false,
        ast,
    );
    let mut re1_args = ArenaVec::new_in(ast);
    re1_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "tagName", ast),
        false,
        ast,
    )));
    let call_re1 = Expression::new_call_expression(SPAN, re1_test, None, re1_args, false, ast);

    // e.tabIndex >= 0
    let e_tabindex = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "tabIndex", ast),
        false,
        ast,
    );
    let tab_gte = Expression::new_binary_expression(
        SPAN,
        e_tabindex,
        BinaryOperator::GreaterEqualThan,
        Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
        ast,
    );

    // e.localName?.includes('-')
    let e_local_name = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "localName", ast),
        false,
        ast,
    );
    let includes_member = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::from(e_local_name),
        IdentifierName::new(SPAN, "includes", ast),
        true,
        ast,
    );
    let mut dash_args = ArenaVec::new_in(ast);
    dash_args.push(Argument::from(Expression::new_string_literal(
        SPAN, "-", None, ast,
    )));
    let includes_call = CallExpression::boxed(
        SPAN,
        Expression::from(includes_member),
        None,
        dash_args,
        false,
        ast,
    );
    let local_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(includes_call), ast);

    // /tabindex|data-resumable|resumes-/.test(e.getAttributeNames?.())
    let re2 = Expression::new_reg_exp_literal(
        SPAN,
        RegExp {
            pattern: RegExpPattern {
                text: ast
                    .allocator()
                    .alloc_str("tabindex|data-resumable|resumes-")
                    .into(),
                pattern: None,
            },
            flags: RegExpFlags::empty(),
        },
        None,
        ast,
    );
    let re2_test = Expression::new_static_member_expression(
        SPAN,
        re2,
        IdentifierName::new(SPAN, "test", ast),
        false,
        ast,
    );
    let get_attr_names = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "getAttributeNames", ast),
        false,
        ast,
    );
    let get_attr_call = CallExpression::boxed(
        SPAN,
        Expression::from(get_attr_names),
        None,
        ArenaVec::new_in(ast),
        true,
        ast,
    );
    let get_attr_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(get_attr_call), ast);
    let mut re2_args = ArenaVec::new_in(ast);
    re2_args.push(Argument::from(get_attr_chain));
    let call_re2 = Expression::new_call_expression(SPAN, re2_test, None, re2_args, false, ast);

    // Compound OR
    let or1 = Expression::new_logical_expression(SPAN, call_re1, LogicalOperator::Or, tab_gte, ast);
    let or2 = Expression::new_logical_expression(SPAN, or1, LogicalOperator::Or, local_chain, ast);
    let or3 = Expression::new_logical_expression(SPAN, or2, LogicalOperator::Or, call_re2, ast);

    let and_all = Expression::new_logical_expression(SPAN, eq_1, LogicalOperator::And, or3, ast);

    let mut param_vec = ArenaVec::new_in(ast);
    param_vec.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "e", ast),
        ast,
    ));
    let params = FormalParameters::boxed(
        SPAN,
        FormalParameterKind::ArrowFormalParameters,
        param_vec,
        None,
        ast,
    );
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        params,
        None,
        ArrowFunctionBody::from(and_all),
        ast,
    );

    let decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "iT", ast),
        None,
        Some(arrow),
        false,
        ast,
    );
    let mut decls = ArenaVec::new_in(ast);
    decls.push(decl);
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

// const hI = async (e) => { ... };
fn build_hi_decl<'a>(ast: &AstBuilder<'a>) -> Statement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // 1. if (e[R]) return;
    let e_r = Expression::new_computed_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        Expression::new_identifier(SPAN, "R", ast),
        false,
        ast,
    );
    stmts.push(Statement::new_if_statement(
        SPAN,
        e_r,
        Statement::new_return_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // 2. const p = e.composedPath?.() || [];
    let comp_path_call = CallExpression::boxed(
        SPAN,
        Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "e", ast),
            IdentifierName::new(SPAN, "composedPath", ast),
            false,
            ast,
        )),
        None,
        ArenaVec::new_in(ast),
        true,
        ast,
    );
    let comp_path_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(comp_path_call), ast);
    let empty_arr = Expression::new_array_expression(SPAN, ArenaVec::new_in(ast), ast);
    let p_init = Expression::new_logical_expression(
        SPAN,
        comp_path_chain,
        LogicalOperator::Or,
        empty_arr,
        ast,
    );
    let p_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "p", ast),
        None,
        Some(p_init),
        false,
        ast,
    );
    let mut p_decls = ArenaVec::new_in(ast);
    p_decls.push(p_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        p_decls,
        false,
        ast,
    ));

    // 3. if (!p.some(iT)) return;
    let p_some = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "p", ast),
        IdentifierName::new(SPAN, "some", ast),
        false,
        ast,
    );
    let mut some_args = ArenaVec::new_in(ast);
    some_args.push(Argument::from(Expression::new_identifier(SPAN, "iT", ast)));
    let call_some = Expression::new_call_expression(SPAN, p_some, None, some_args, false, ast);
    let not_some =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, call_some, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        not_some,
        Statement::new_return_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // 4. const u = [...new Set(p.map((l) => l.localName).filter((n) => n?.includes('-') && !C.get(n)))];
    // Arrow 1: (l) => l.localName
    let mut l_params = ArenaVec::new_in(ast);
    l_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "l", ast),
        ast,
    ));
    let l_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            l_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "l", ast),
            IdentifierName::new(SPAN, "localName", ast),
            false,
            ast,
        )),
        ast,
    );
    let p_map = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "p", ast),
        IdentifierName::new(SPAN, "map", ast),
        false,
        ast,
    );
    let mut map_args = ArenaVec::new_in(ast);
    map_args.push(Argument::from(l_arrow));
    let call_map = Expression::new_call_expression(SPAN, p_map, None, map_args, false, ast);

    // Arrow 2: (n) => n?.includes('-') && !C.get(n)
    let n_inc_call = CallExpression::boxed(
        SPAN,
        Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "n", ast),
            IdentifierName::new(SPAN, "includes", ast),
            true,
            ast,
        )),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(Expression::new_string_literal(
                SPAN, "-", None, ast,
            )));
            a
        },
        false,
        ast,
    );
    let n_inc_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(n_inc_call), ast);
    let c_get = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "C", ast),
        IdentifierName::new(SPAN, "get", ast),
        false,
        ast,
    );
    let mut c_get_args = ArenaVec::new_in(ast);
    c_get_args.push(Argument::from(Expression::new_identifier(SPAN, "n", ast)));
    let call_c_get = Expression::new_call_expression(SPAN, c_get, None, c_get_args, false, ast);
    let not_c_get =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, call_c_get, ast);
    let filter_test =
        Expression::new_logical_expression(SPAN, n_inc_chain, LogicalOperator::And, not_c_get, ast);
    // && M[n]
    let filter_test = Expression::new_logical_expression(
        SPAN,
        filter_test,
        LogicalOperator::And,
        computed(ast, ident(ast, "M"), ident(ast, "n")),
        ast,
    );

    let mut n_params = ArenaVec::new_in(ast);
    n_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "n", ast),
        ast,
    ));
    let n_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            n_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(filter_test),
        ast,
    );

    let map_filter = Expression::new_static_member_expression(
        SPAN,
        call_map,
        IdentifierName::new(SPAN, "filter", ast),
        false,
        ast,
    );
    let mut filter_args = ArenaVec::new_in(ast);
    filter_args.push(Argument::from(n_arrow));
    let call_filter =
        Expression::new_call_expression(SPAN, map_filter, None, filter_args, false, ast);

    let mut new_set_args = ArenaVec::new_in(ast);
    new_set_args.push(Argument::from(call_filter));
    let new_set = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Set", ast),
        None,
        new_set_args,
        ast,
    );

    let mut u_elements = ArenaVec::new_in(ast);
    u_elements.push(ArrayExpressionElement::SpreadElement(SpreadElement::boxed(
        SPAN, new_set, ast,
    )));
    let u_arr = Expression::new_array_expression(SPAN, u_elements, ast);
    let u_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "u", ast),
        None,
        Some(u_arr),
        false,
        ast,
    );
    let mut u_decls = ArenaVec::new_in(ast);
    u_decls.push(u_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        u_decls,
        false,
        ast,
    ));

    // 5. if (!u.length) return;
    let u_len = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "u", ast),
        IdentifierName::new(SPAN, "length", ast),
        false,
        ast,
    );
    let not_u_len = Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, u_len, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        not_u_len,
        Statement::new_return_statement(SPAN, None, ast),
        None,
        ast,
    ));

    // 6. if (e.type === 'pointerover' || (/^p.*d|f.*n$/.test(e.type) && !p.some((l) => l.hasAttribute?.(`resumes-on-${e.type}`)))) return u.forEach(uG);
    let e_type_po = Expression::new_binary_expression(
        SPAN,
        Expression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "e", ast),
            IdentifierName::new(SPAN, "type", ast),
            false,
            ast,
        ),
        BinaryOperator::StrictEquality,
        Expression::new_string_literal(SPAN, "pointerover", None, ast),
        ast,
    );
    let re3 = Expression::new_reg_exp_literal(
        SPAN,
        RegExp {
            pattern: RegExpPattern {
                text: ast.allocator().alloc_str("^p.*d|f.*n$").into(),
                pattern: None,
            },
            flags: RegExpFlags::empty(),
        },
        None,
        ast,
    );
    let re3_test = Expression::new_static_member_expression(
        SPAN,
        re3,
        IdentifierName::new(SPAN, "test", ast),
        false,
        ast,
    );
    let mut re3_args = ArenaVec::new_in(ast);
    re3_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "type", ast),
        false,
        ast,
    )));
    let call_re3 = Expression::new_call_expression(SPAN, re3_test, None, re3_args, false, ast);

    // (l) => l.hasAttribute?.(`resumes-on-${e.type}`)
    let mut quasis_res = ArenaVec::new_in(ast);
    quasis_res.push(TemplateElement::new(
        SPAN,
        TemplateElementValue {
            raw: ast.allocator().alloc_str("resumes-on-").into(),
            cooked: Some(ast.allocator().alloc_str("resumes-on-").into()),
        },
        false,
        ast,
    ));
    quasis_res.push(TemplateElement::new(
        SPAN,
        TemplateElementValue {
            raw: ast.allocator().alloc_str("").into(),
            cooked: Some(ast.allocator().alloc_str("").into()),
        },
        true,
        ast,
    ));
    let mut exprs_res = ArenaVec::new_in(ast);
    exprs_res.push(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "type", ast),
        false,
        ast,
    ));
    let resumes_tmpl = Expression::new_template_literal(SPAN, quasis_res, exprs_res, ast);

    let has_attr_call = CallExpression::boxed(
        SPAN,
        Expression::from(MemberExpression::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "l", ast),
            IdentifierName::new(SPAN, "hasAttribute", ast),
            false,
            ast,
        )),
        None,
        {
            let mut a = ArenaVec::new_in(ast);
            a.push(Argument::from(resumes_tmpl));
            a
        },
        true,
        ast,
    );
    let has_attr_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(has_attr_call), ast);
    let mut l_res_params = ArenaVec::new_in(ast);
    l_res_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "l", ast),
        ast,
    ));
    let l_res_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            l_res_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(has_attr_chain),
        ast,
    );

    let p_some_res = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "p", ast),
        IdentifierName::new(SPAN, "some", ast),
        false,
        ast,
    );
    let mut some_res_args = ArenaVec::new_in(ast);
    some_res_args.push(Argument::from(l_res_arrow));
    let call_some_res =
        Expression::new_call_expression(SPAN, p_some_res, None, some_res_args, false, ast);
    let not_some_res =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, call_some_res, ast);
    let re3_and =
        Expression::new_logical_expression(SPAN, call_re3, LogicalOperator::And, not_some_res, ast);
    let hover_or =
        Expression::new_logical_expression(SPAN, e_type_po, LogicalOperator::Or, re3_and, ast);

    let u_for_each = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "u", ast),
        IdentifierName::new(SPAN, "forEach", ast),
        false,
        ast,
    );
    let mut fe_args = ArenaVec::new_in(ast);
    fe_args.push(Argument::from(Expression::new_identifier(SPAN, "uG", ast)));
    let call_fe = Expression::new_call_expression(SPAN, u_for_each, None, fe_args, false, ast);
    stmts.push(Statement::new_if_statement(
        SPAN,
        hover_or,
        Statement::new_return_statement(SPAN, Some(call_fe), ast),
        None,
        ast,
    ));

    // 7. e.cancelable && e.preventDefault();
    let e_cancelable = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "cancelable", ast),
        false,
        ast,
    );
    let prevent_default = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "preventDefault", ast),
        false,
        ast,
    );
    let call_prevent = Expression::new_call_expression(
        SPAN,
        prevent_default,
        None,
        ArenaVec::new_in(ast),
        false,
        ast,
    );
    // e.cancelable && e.type !== 'keydown' && e.preventDefault()
    let not_keydown = Expression::new_binary_expression(
        SPAN,
        member(ast, ident(ast, "e"), "type"),
        BinaryOperator::StrictInequality,
        Expression::new_string_literal(SPAN, "keydown", None, ast),
        ast,
    );
    let cancelable_not_keydown = Expression::new_logical_expression(
        SPAN,
        e_cancelable,
        LogicalOperator::And,
        not_keydown,
        ast,
    );
    let cancel_and = Expression::new_logical_expression(
        SPAN,
        cancelable_not_keydown,
        LogicalOperator::And,
        call_prevent,
        ast,
    );
    stmts.push(Statement::new_expression_statement(SPAN, cancel_and, ast));

    // 8. e.stopImmediatePropagation();
    let stop_imm = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "stopImmediatePropagation", ast),
        false,
        ast,
    );
    let call_stop_imm =
        Expression::new_call_expression(SPAN, stop_imm, None, ArenaVec::new_in(ast), false, ast);
    stmts.push(Statement::new_expression_statement(
        SPAN,
        call_stop_imm,
        ast,
    ));

    // 9. B.push({ e, t: e.target, h: p.find((l) => l.localName?.includes('-')) });
    // find arrow: (l) => l.localName?.includes('-')
    let l_local_name = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "l", ast),
        IdentifierName::new(SPAN, "localName", ast),
        false,
        ast,
    );
    let l_includes_member = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::from(l_local_name),
        IdentifierName::new(SPAN, "includes", ast),
        true,
        ast,
    );
    let mut l_dash_args = ArenaVec::new_in(ast);
    l_dash_args.push(Argument::from(Expression::new_string_literal(
        SPAN, "-", None, ast,
    )));
    let l_find_call = CallExpression::boxed(
        SPAN,
        Expression::from(l_includes_member),
        None,
        l_dash_args,
        false,
        ast,
    );
    let l_find_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(l_find_call), ast);
    let mut l_find_params = ArenaVec::new_in(ast);
    l_find_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "l", ast),
        ast,
    ));
    let l_find_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            l_find_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(l_find_chain),
        ast,
    );
    let p_find = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "p", ast),
        IdentifierName::new(SPAN, "find", ast),
        false,
        ast,
    );
    let mut find_args = ArenaVec::new_in(ast);
    find_args.push(Argument::from(l_find_arrow));
    let call_find = Expression::new_call_expression(SPAN, p_find, None, find_args, false, ast);

    let mut b_obj_props = ArenaVec::new_in(ast);
    // e (shorthand)
    b_obj_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "e", ast),
        Expression::new_identifier(SPAN, "e", ast),
        false,
        true,
        false,
        ast,
    ));
    // t: p[0] || e.target  (composedPath()[0] is the real target; e.target is retargeted to the shadow host)
    b_obj_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "t", ast),
        Expression::new_logical_expression(
            SPAN,
            Expression::new_computed_member_expression(
                SPAN,
                Expression::new_identifier(SPAN, "p", ast),
                Expression::new_numeric_literal(SPAN, 0.0, None, NumberBase::Decimal, ast),
                false,
                ast,
            ),
            LogicalOperator::Or,
            member(ast, ident(ast, "e"), "target"),
            ast,
        ),
        false,
        false,
        false,
        ast,
    ));
    // h: p.find(...)
    b_obj_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "h", ast),
        call_find,
        false,
        false,
        false,
        ast,
    ));
    let b_obj = Expression::new_object_expression(SPAN, b_obj_props, ast);

    let b_push = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "B", ast),
        IdentifierName::new(SPAN, "push", ast),
        false,
        ast,
    );
    let mut push_args = ArenaVec::new_in(ast);
    push_args.push(Argument::from(b_obj));
    let call_b_push = Expression::new_call_expression(SPAN, b_push, None, push_args, false, ast);
    stmts.push(Statement::new_expression_statement(SPAN, call_b_push, ast));

    // 10. await Promise.all(u.map(uG));
    let u_map_ug = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "u", ast),
        IdentifierName::new(SPAN, "map", ast),
        false,
        ast,
    );
    let mut map_ug_args = ArenaVec::new_in(ast);
    map_ug_args.push(Argument::from(Expression::new_identifier(SPAN, "uG", ast)));
    let call_map_ug =
        Expression::new_call_expression(SPAN, u_map_ug, None, map_ug_args, false, ast);

    let prom_all = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "Promise", ast),
        IdentifierName::new(SPAN, "all", ast),
        false,
        ast,
    );
    let mut all_args = ArenaVec::new_in(ast);
    all_args.push(Argument::from(call_map_ug));
    let call_all = Expression::new_call_expression(SPAN, prom_all, None, all_args, false, ast);
    let await_all = Expression::new_await_expression(SPAN, call_all, ast);
    stmts.push(Statement::new_expression_statement(SPAN, await_all, ast));

    // 11. for (const { e: o, t, h } of B.splice(0)) { ... }
    let mut for_props = ArenaVec::new_in(ast);
    // e: o
    for_props.push(BindingProperty::new(
        SPAN,
        PropertyKey::new_static_identifier(SPAN, "e", ast),
        BindingPattern::new_binding_identifier(SPAN, "o", ast),
        false,
        false,
        ast,
    ));
    // t (shorthand)
    for_props.push(BindingProperty::new(
        SPAN,
        PropertyKey::new_static_identifier(SPAN, "t", ast),
        BindingPattern::new_binding_identifier(SPAN, "t", ast),
        true,
        false,
        ast,
    ));
    // h (shorthand)
    for_props.push(BindingProperty::new(
        SPAN,
        PropertyKey::new_static_identifier(SPAN, "h", ast),
        BindingPattern::new_binding_identifier(SPAN, "h", ast),
        true,
        false,
        ast,
    ));
    let obj_pat = BindingPattern::new_object_pattern(SPAN, for_props, None, ast);
    let mut for_decls = ArenaVec::new_in(ast);
    for_decls.push(VariableDeclarator::new(
        SPAN, obj_pat, None, None, false, ast,
    ));
    let for_left = ForStatementLeft::VariableDeclaration(VariableDeclaration::boxed(
        SPAN,
        VariableDeclarationKind::Const,
        for_decls,
        false,
        ast,
    ));

    let b_splice = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "B", ast),
        IdentifierName::new(SPAN, "splice", ast),
        false,
        ast,
    );
    let mut splice_args = ArenaVec::new_in(ast);
    splice_args.push(Argument::from(Expression::new_numeric_literal(
        SPAN,
        0.0,
        None,
        NumberBase::Decimal,
        ast,
    )));
    let call_splice =
        Expression::new_call_expression(SPAN, b_splice, None, splice_args, false, ast);

    // Inside for body:
    let mut for_body_stmts = ArenaVec::new_in(ast);
    // let v;
    let mut v_decls = ArenaVec::new_in(ast);
    v_decls.push(VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "v", ast),
        None,
        None,
        false,
        ast,
    ));
    for_body_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Let,
        v_decls,
        false,
        ast,
    ));

    // try { v = new o.constructor(o.type, o); } catch { v = new CustomEvent(o.type, o); }
    let o_ctor = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "o", ast),
        IdentifierName::new(SPAN, "constructor", ast),
        false,
        ast,
    );
    let mut new_o_args = ArenaVec::new_in(ast);
    new_o_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "o", ast),
        IdentifierName::new(SPAN, "type", ast),
        false,
        ast,
    )));
    new_o_args.push(Argument::from(Expression::new_identifier(SPAN, "o", ast)));
    let new_o = Expression::new_new_expression(SPAN, o_ctor, None, new_o_args, ast);
    let assign_v1 = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_assignment_target_identifier(SPAN, "v", ast),
        new_o,
        ast,
    );
    let mut try_stmts = ArenaVec::new_in(ast);
    try_stmts.push(Statement::new_expression_statement(SPAN, assign_v1, ast));
    let try_block = BlockStatement::boxed(SPAN, try_stmts, ast);

    let mut new_ce_args = ArenaVec::new_in(ast);
    new_ce_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "o", ast),
        IdentifierName::new(SPAN, "type", ast),
        false,
        ast,
    )));
    new_ce_args.push(Argument::from(Expression::new_identifier(SPAN, "o", ast)));
    let new_ce = Expression::new_new_expression(
        SPAN,
        Expression::new_identifier(SPAN, "CustomEvent", ast),
        None,
        new_ce_args,
        ast,
    );
    let assign_v2 = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        AssignmentTarget::new_assignment_target_identifier(SPAN, "v", ast),
        new_ce,
        ast,
    );
    let mut catch_stmts = ArenaVec::new_in(ast);
    catch_stmts.push(Statement::new_expression_statement(SPAN, assign_v2, ast));
    let catch_block = BlockStatement::boxed(SPAN, catch_stmts, ast);
    let catch_clause = CatchClause::boxed(SPAN, None, catch_block, ast);

    for_body_stmts.push(Statement::new_try_statement(
        SPAN,
        try_block,
        Some(catch_clause),
        None,
        ast,
    ));

    // v[R] = 1;
    let v_r = AssignmentTarget::new_computed_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "v", ast),
        Expression::new_identifier(SPAN, "R", ast),
        false,
        ast,
    );
    let assign_vr = Expression::new_assignment_expression(
        SPAN,
        AssignmentOperator::Assign,
        v_r,
        Expression::new_numeric_literal(SPAN, 1.0, None, NumberBase::Decimal, ast),
        ast,
    );
    for_body_stmts.push(Statement::new_expression_statement(SPAN, assign_vr, ast));

    // (t?.isConnected ? t : h)?.dispatchEvent(v);
    let t_chain = Expression::new_chain_expression(
        SPAN,
        ChainElement::new_static_member_expression(
            SPAN,
            Expression::new_identifier(SPAN, "t", ast),
            IdentifierName::new(SPAN, "isConnected", ast),
            true,
            ast,
        ),
        ast,
    );
    let cond_th = Expression::new_conditional_expression(
        SPAN,
        t_chain,
        Expression::new_identifier(SPAN, "t", ast),
        Expression::new_identifier(SPAN, "h", ast),
        ast,
    );
    let paren_th = Expression::new_parenthesized_expression(SPAN, cond_th, ast);
    let disp_member = MemberExpression::new_static_member_expression(
        SPAN,
        paren_th,
        IdentifierName::new(SPAN, "dispatchEvent", ast),
        false,
        ast,
    );
    let mut disp_args = ArenaVec::new_in(ast);
    disp_args.push(Argument::from(Expression::new_identifier(SPAN, "v", ast)));
    let disp_call = CallExpression::boxed(
        SPAN,
        Expression::from(disp_member),
        None,
        disp_args,
        true,
        ast,
    );
    let disp_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(disp_call), ast);
    for_body_stmts.push(Statement::new_expression_statement(SPAN, disp_chain, ast));

    let for_stmt = Statement::new_for_of_statement(
        SPAN,
        false,
        for_left,
        call_splice,
        Statement::new_block_statement(SPAN, for_body_stmts, ast),
        ast,
    );
    stmts.push(for_stmt);

    let body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), stmts, ast);
    let mut hi_params = ArenaVec::new_in(ast);
    hi_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "e", ast),
        ast,
    ));
    let arrow_hi = Expression::new_arrow_function_expression(
        SPAN,
        true, // async = true
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            hi_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::FunctionBody(body),
        ast,
    );

    let decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "hI", ast),
        None,
        Some(arrow_hi),
        false,
        ast,
    );
    let mut decls = ArenaVec::new_in(ast);
    decls.push(decl);
    Statement::new_variable_declaration(SPAN, VariableDeclarationKind::Const, decls, false, ast)
}

// events.forEach((t) => { W.addEventListener(t, hI, true); });
fn build_events_listener_stmt<'a>(ast: &AstBuilder<'a>, events: &[String]) -> Statement<'a> {
    let mut elem_vec = ArenaVec::new_in(ast);
    for evt in events {
        elem_vec.push(ArrayExpressionElement::from(
            Expression::new_string_literal(SPAN, ast.allocator().alloc_str(evt), None, ast),
        ));
    }
    let arr = Expression::new_array_expression(SPAN, elem_vec, ast);
    let fe_member = Expression::new_static_member_expression(
        SPAN,
        arr,
        IdentifierName::new(SPAN, "forEach", ast),
        false,
        ast,
    );

    // (t) => { W.addEventListener(t, hI, true); }
    let add_ev_member = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "W", ast),
        IdentifierName::new(SPAN, "addEventListener", ast),
        false,
        ast,
    );
    let mut add_args = ArenaVec::new_in(ast);
    add_args.push(Argument::from(Expression::new_identifier(SPAN, "t", ast)));
    add_args.push(Argument::from(Expression::new_identifier(SPAN, "hI", ast)));
    add_args.push(Argument::from(Expression::new_boolean_literal(
        SPAN, true, ast,
    )));
    let add_call = Expression::new_call_expression(SPAN, add_ev_member, None, add_args, false, ast);

    let mut arrow_stmts = ArenaVec::new_in(ast);
    arrow_stmts.push(Statement::new_expression_statement(SPAN, add_call, ast));
    let arrow_body = FunctionBody::boxed(SPAN, ArenaVec::new_in(ast), arrow_stmts, ast);

    let mut t_params = ArenaVec::new_in(ast);
    t_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "t", ast),
        ast,
    ));
    let arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            t_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::FunctionBody(arrow_body),
        ast,
    );

    let mut fe_args = ArenaVec::new_in(ast);
    fe_args.push(Argument::from(arrow));
    let fe_call = Expression::new_call_expression(SPAN, fe_member, None, fe_args, false, ast);
    Statement::new_expression_statement(SPAN, fe_call, ast)
}

// if (__IDLE_HYDRATION__) { ... }
fn build_idle_hydration_stmt<'a>(ast: &AstBuilder<'a>, timeout: u32) -> Statement<'a> {
    let mut stmts = ArenaVec::new_in(ast);

    // const q = W.requestIdleCallback || ((c) => setTimeout(c, 50));
    let w_ric = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "W", ast),
        IdentifierName::new(SPAN, "requestIdleCallback", ast),
        false,
        ast,
    );
    let set_timeout = Expression::new_identifier(SPAN, "setTimeout", ast);
    let mut st_args = ArenaVec::new_in(ast);
    st_args.push(Argument::from(Expression::new_identifier(SPAN, "c", ast)));
    st_args.push(Argument::from(Expression::new_numeric_literal(
        SPAN,
        50.0,
        None,
        NumberBase::Decimal,
        ast,
    )));
    let call_st = Expression::new_call_expression(SPAN, set_timeout, None, st_args, false, ast);

    let mut c_params = ArenaVec::new_in(ast);
    c_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "c", ast),
        ast,
    ));
    let fallback_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            c_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(call_st),
        ast,
    );
    let paren_fallback = Expression::new_parenthesized_expression(SPAN, fallback_arrow, ast);
    let q_init =
        Expression::new_logical_expression(SPAN, w_ric, LogicalOperator::Or, paren_fallback, ast);
    let q_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "q", ast),
        None,
        Some(q_init),
        false,
        ast,
    );
    let mut q_decls = ArenaVec::new_in(ast);
    q_decls.push(q_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        q_decls,
        false,
        ast,
    ));

    // const s = (r) => [...r.querySelectorAll('*')].flatMap((e) => (e.shadowRoot ? [e, ...s(e.shadowRoot)] : e));
    // Arrow flatMap: (e) => (e.shadowRoot ? [e, ...s(e.shadowRoot)] : e)
    let e_sr = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "shadowRoot", ast),
        false,
        ast,
    );
    let s_ident = Expression::new_identifier(SPAN, "s", ast);
    let mut s_args = ArenaVec::new_in(ast);
    s_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "shadowRoot", ast),
        false,
        ast,
    )));
    let call_s = Expression::new_call_expression(SPAN, s_ident, None, s_args, false, ast);
    let mut cons_elems = ArenaVec::new_in(ast);
    cons_elems.push(ArrayExpressionElement::from(Expression::new_identifier(
        SPAN, "e", ast,
    )));
    cons_elems.push(ArrayExpressionElement::SpreadElement(SpreadElement::boxed(
        SPAN, call_s, ast,
    )));
    let cons_arr = Expression::new_array_expression(SPAN, cons_elems, ast);
    let cond_sr = Expression::new_conditional_expression(
        SPAN,
        e_sr,
        cons_arr,
        Expression::new_identifier(SPAN, "e", ast),
        ast,
    );
    let paren_cond_sr = Expression::new_parenthesized_expression(SPAN, cond_sr, ast);

    let mut e_params = ArenaVec::new_in(ast);
    e_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "e", ast),
        ast,
    ));
    let fm_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            e_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(paren_cond_sr),
        ast,
    );

    let r_qsa = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "r", ast),
        IdentifierName::new(SPAN, "querySelectorAll", ast),
        false,
        ast,
    );
    let mut qsa_args = ArenaVec::new_in(ast);
    qsa_args.push(Argument::from(Expression::new_string_literal(
        SPAN, "*", None, ast,
    )));
    let call_qsa = Expression::new_call_expression(SPAN, r_qsa, None, qsa_args, false, ast);
    let mut qsa_spread_elems = ArenaVec::new_in(ast);
    qsa_spread_elems.push(ArrayExpressionElement::SpreadElement(SpreadElement::boxed(
        SPAN, call_qsa, ast,
    )));
    let qsa_arr = Expression::new_array_expression(SPAN, qsa_spread_elems, ast);
    let fm_member = Expression::new_static_member_expression(
        SPAN,
        qsa_arr,
        IdentifierName::new(SPAN, "flatMap", ast),
        false,
        ast,
    );
    let mut fm_args = ArenaVec::new_in(ast);
    fm_args.push(Argument::from(fm_arrow));
    let call_fm = Expression::new_call_expression(SPAN, fm_member, None, fm_args, false, ast);

    let mut r_params = ArenaVec::new_in(ast);
    r_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "r", ast),
        ast,
    ));
    let s_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            r_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(call_fm),
        ast,
    );
    let s_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "s", ast),
        None,
        Some(s_arrow),
        false,
        ast,
    );
    let mut s_decls = ArenaVec::new_in(ast);
    s_decls.push(s_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        s_decls,
        false,
        ast,
    ));

    // const f = () => { const t = s(D).find((e) => e.localName?.includes('-') && !C.get(e.localName)); if (t) uG(t.localName).then(() => q(f, { timeout: <timeout> })); };
    let mut f_stmts = ArenaVec::new_in(ast);
    // Arrow for find: (e) => e.localName?.includes('-') && !C.get(e.localName)
    let e_ln_obj = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "localName", ast),
        false,
        ast,
    );
    let e_ln_inc_member = MemberExpression::new_static_member_expression(
        SPAN,
        Expression::from(e_ln_obj),
        IdentifierName::new(SPAN, "includes", ast),
        true,
        ast,
    );
    let mut e_dash_args = ArenaVec::new_in(ast);
    e_dash_args.push(Argument::from(Expression::new_string_literal(
        SPAN, "-", None, ast,
    )));
    let e_ln_inc = CallExpression::boxed(
        SPAN,
        Expression::from(e_ln_inc_member),
        None,
        e_dash_args,
        false,
        ast,
    );
    let e_ln_chain =
        Expression::new_chain_expression(SPAN, ChainElement::CallExpression(e_ln_inc), ast);
    let c_get_ln = Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "C", ast),
        IdentifierName::new(SPAN, "get", ast),
        false,
        ast,
    );
    let mut get_ln_args = ArenaVec::new_in(ast);
    get_ln_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "e", ast),
        IdentifierName::new(SPAN, "localName", ast),
        false,
        ast,
    )));
    let call_c_get_ln =
        Expression::new_call_expression(SPAN, c_get_ln, None, get_ln_args, false, ast);
    let not_c_get_ln =
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, call_c_get_ln, ast);
    let find_ln_and = Expression::new_logical_expression(
        SPAN,
        e_ln_chain,
        LogicalOperator::And,
        not_c_get_ln,
        ast,
    );
    // && M[e.localName] && !(e.localName in L)
    let find_ln_and = Expression::new_logical_expression(
        SPAN,
        find_ln_and,
        LogicalOperator::And,
        computed(
            ast,
            ident(ast, "M"),
            member(ast, ident(ast, "e"), "localName"),
        ),
        ast,
    );
    let ln_in_l = Expression::new_binary_expression(
        SPAN,
        member(ast, ident(ast, "e"), "localName"),
        BinaryOperator::In,
        ident(ast, "L"),
        ast,
    );
    let find_ln_and = Expression::new_logical_expression(
        SPAN,
        find_ln_and,
        LogicalOperator::And,
        Expression::new_unary_expression(SPAN, UnaryOperator::LogicalNot, ln_in_l, ast),
        ast,
    );

    let mut ef_params = ArenaVec::new_in(ast);
    ef_params.push(FormalParameter::new_plain(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "e", ast),
        ast,
    ));
    let ef_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            ef_params,
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(find_ln_and),
        ast,
    );

    let s_ident2 = Expression::new_identifier(SPAN, "s", ast);
    let mut sd_args = ArenaVec::new_in(ast);
    sd_args.push(Argument::from(Expression::new_identifier(SPAN, "D", ast)));
    let call_sd = Expression::new_call_expression(SPAN, s_ident2, None, sd_args, false, ast);
    let find_member = Expression::new_static_member_expression(
        SPAN,
        call_sd,
        IdentifierName::new(SPAN, "find", ast),
        false,
        ast,
    );
    let mut find_args = ArenaVec::new_in(ast);
    find_args.push(Argument::from(ef_arrow));
    let call_find_sd =
        Expression::new_call_expression(SPAN, find_member, None, find_args, false, ast);

    let t_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "t", ast),
        None,
        Some(call_find_sd),
        false,
        ast,
    );
    let mut t_decls = ArenaVec::new_in(ast);
    t_decls.push(t_decl);
    f_stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        t_decls,
        false,
        ast,
    ));

    // if (t) uG(t.localName).then(() => q(f, { timeout: <timeout> }));
    let mut timeout_props = ArenaVec::new_in(ast);
    timeout_props.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "timeout", ast),
        Expression::new_numeric_literal(SPAN, timeout as f64, None, NumberBase::Decimal, ast),
        false,
        false,
        false,
        ast,
    ));
    let timeout_obj = Expression::new_object_expression(SPAN, timeout_props, ast);

    let q_ident = Expression::new_identifier(SPAN, "q", ast);
    let mut q_args = ArenaVec::new_in(ast);
    q_args.push(Argument::from(Expression::new_identifier(SPAN, "f", ast)));
    q_args.push(Argument::from(timeout_obj));
    let call_q = Expression::new_call_expression(SPAN, q_ident, None, q_args, false, ast);

    let then_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::from(call_q),
        ast,
    );

    let ug_ident = Expression::new_identifier(SPAN, "uG", ast);
    let mut ug_args = ArenaVec::new_in(ast);
    ug_args.push(Argument::from(Expression::new_static_member_expression(
        SPAN,
        Expression::new_identifier(SPAN, "t", ast),
        IdentifierName::new(SPAN, "localName", ast),
        false,
        ast,
    )));
    let call_ug = Expression::new_call_expression(SPAN, ug_ident, None, ug_args, false, ast);

    let then_member = Expression::new_static_member_expression(
        SPAN,
        call_ug,
        IdentifierName::new(SPAN, "then", ast),
        false,
        ast,
    );
    let mut then_args = ArenaVec::new_in(ast);
    then_args.push(Argument::from(then_arrow));
    let call_then = Expression::new_call_expression(SPAN, then_member, None, then_args, false, ast);

    f_stmts.push(Statement::new_if_statement(
        SPAN,
        Expression::new_identifier(SPAN, "t", ast),
        Statement::new_expression_statement(SPAN, call_then, ast),
        None,
        ast,
    ));

    let f_arrow = Expression::new_arrow_function_expression(
        SPAN,
        false,
        None,
        FormalParameters::boxed(
            SPAN,
            FormalParameterKind::ArrowFormalParameters,
            ArenaVec::new_in(ast),
            None,
            ast,
        ),
        None,
        ArrowFunctionBody::FunctionBody(FunctionBody::boxed(
            SPAN,
            ArenaVec::new_in(ast),
            f_stmts,
            ast,
        )),
        ast,
    );
    let f_decl = VariableDeclarator::new(
        SPAN,
        BindingPattern::new_binding_identifier(SPAN, "f", ast),
        None,
        Some(f_arrow),
        false,
        ast,
    );
    let mut f_decls = ArenaVec::new_in(ast);
    f_decls.push(f_decl);
    stmts.push(Statement::new_variable_declaration(
        SPAN,
        VariableDeclarationKind::Const,
        f_decls,
        false,
        ast,
    ));

    // q(f, { timeout: <timeout> });
    let mut timeout_props2 = ArenaVec::new_in(ast);
    timeout_props2.push(ObjectPropertyKind::new_object_property(
        SPAN,
        PropertyKind::Init,
        PropertyKey::new_static_identifier(SPAN, "timeout", ast),
        Expression::new_numeric_literal(SPAN, timeout as f64, None, NumberBase::Decimal, ast),
        false,
        false,
        false,
        ast,
    ));
    let timeout_obj2 = Expression::new_object_expression(SPAN, timeout_props2, ast);
    let q_ident2 = Expression::new_identifier(SPAN, "q", ast);
    let mut q_args2 = ArenaVec::new_in(ast);
    q_args2.push(Argument::from(Expression::new_identifier(SPAN, "f", ast)));
    q_args2.push(Argument::from(timeout_obj2));
    let call_q2 = Expression::new_call_expression(SPAN, q_ident2, None, q_args2, false, ast);
    stmts.push(Statement::new_expression_statement(SPAN, call_q2, ast));

    Statement::new_block_statement(SPAN, stmts, ast)
}
